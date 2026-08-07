const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');
const socketService = require('./socketService');

// Resolve the kitchen station for items that do not carry one, using the product table.
async function resolveStations(items) {
  const missing = items.filter(item => !item.station);
  const stations = {};
  if (missing.length > 0) {
    const ids = [...new Set(missing.map(item => item.productId))];
    for (const id of ids) {
      const product = await db.get(`SELECT station FROM products WHERE id = ?`, [id]);
      stations[id] = (product && product.station) || 'main';
    }
  }
  return stations;
}

// Create Kitchen Order Ticket(s) for the given kitchen-bound items.
// Items are grouped by kitchen station so each station gets its own ticket.
// sourceRefId is used for the kitchen_orders.bill_id column. For orders created
// before checkout, this holds the order id as a placeholder; it is replaced with
// the real bill id when the order is checked out.
async function createKitchenTicket({ sourceRefId, orderId, tableNumber, items, note, station = 'main' }) {
  const kitchenItems = (items || []).filter(item => item.sendToKitchen);
  if (kitchenItems.length === 0) {
    return [];
  }

  const stations = await resolveStations(kitchenItems);
  const stationOf = (item) => item.station || stations[item.productId] || station || 'main';

  const grouped = {};
  for (const item of kitchenItems) {
    const s = stationOf(item);
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(item);
  }

  const tickets = [];
  let counter = 1;
  for (const [stationName, stationItems] of Object.entries(grouped)) {
    const kotId = uuidv4();
    const orderNumber = `KOT-${Date.now()}-${counter++}`;

    await db.run(
      `INSERT INTO kitchen_orders (id, bill_id, order_id, table_number, notes, order_number, station, items, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [kotId, sourceRefId, orderId || null, tableNumber || null, note || null, orderNumber, stationName, JSON.stringify(stationItems)]
    );

    socketService.emit('order-created', {
      orderId: kotId,
      orderNumber,
      items: stationItems,
      tableNumber: tableNumber || null,
      billNumber: null,
      station: stationName
    });

    tickets.push({ kotId, orderNumber, kitchenItems: stationItems, station: stationName });
  }

  return tickets;
}

// Recompute the kitchen status of an order based on its linked KOTs.
async function updateOrderKitchenStatus(orderId) {
  if (!orderId) return;

  const kots = await db.all(
    `SELECT status FROM kitchen_orders WHERE order_id = ? AND status != 'cancelled'`,
    [orderId]
  );

  if (kots.length === 0) {
    await db.run(
      `UPDATE orders SET kitchen_status = 'none', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [orderId]
    );
    return;
  }

  const kitchenStatus = kots.every(k => k.status === 'completed')
    ? 'completed'
    : (kots.some(k => k.status === 'preparing') ? 'preparing' : 'pending');

  await db.run(
    `UPDATE orders SET kitchen_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [kitchenStatus, orderId]
  );
}

// Attach a real bill id to all KOTs belonging to an order (run at checkout).
async function linkOrderKitsToBill(orderId, billId) {
  if (!orderId) return;
  await db.run(
    `UPDATE kitchen_orders SET bill_id = ? WHERE order_id = ?`,
    [billId, orderId]
  );
}

// Reflect a voided quantity on live (pending/preparing) KOTs for an order.
// Items whose quantity hits zero are flagged voided so the KDS can show them.
async function markItemVoidedInKot(orderId, productId, voidQty, reason) {
  if (!orderId || !productId || !voidQty) return;

  const kots = await db.all(
    `SELECT id, order_number, items FROM kitchen_orders
     WHERE order_id = ? AND status IN ('pending', 'preparing')`,
    [orderId]
  );

  for (const kot of kots) {
    let items = [];
    try {
      items = JSON.parse(kot.items || '[]');
    } catch (err) {
      items = [];
    }

    let changed = false;
    for (const item of items) {
      if (item.productId === productId && voidQty > 0) {
        const removed = Math.min(item.quantity, voidQty);
        item.quantity -= removed;
        voidQty -= removed;
        if (item.quantity <= 0) {
          item.voided = true;
          item.voidReason = reason || 'Voided';
        }
        changed = true;
        if (voidQty <= 0) break;
      }
    }

    if (changed) {
      await db.run(
        `UPDATE kitchen_orders SET items = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(items), kot.id]
      );
      socketService.emit('order-status-changed', {
        orderId: kot.id,
        status: 'voided-item',
        orderNumber: kot.order_number,
        tableNumber: null
      });
    }
  }
}

module.exports = {
  createKitchenTicket,
  updateOrderKitchenStatus,
  linkOrderKitsToBill,
  markItemVoidedInKot
};
