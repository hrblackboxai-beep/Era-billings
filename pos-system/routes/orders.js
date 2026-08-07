const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');
const billingService = require('../services/billingService');
const kitchenService = require('../services/kitchenService');
const socketService = require('../services/socketService');

const ACTIVE_STATUSES = ['open', 'sent', 'served'];
const ALL_STATUSES = [...ACTIVE_STATUSES, 'closed', 'void'];

function parseOrderItems(order) {
  try {
    return JSON.parse(order.items || '[]');
  } catch (err) {
    return [];
  }
}

function getIO() {
  return socketService.get();
}

async function orderSummary(order) {
  const kots = await db.all(
    `SELECT id, status FROM kitchen_orders WHERE order_id = ?`,
    [order.id]
  );

  let kitchenStatus = 'none';
  const liveKots = kots.filter(k => k.status !== 'cancelled');
  if (liveKots.length > 0) {
    kitchenStatus = liveKots.every(k => k.status === 'completed')
      ? 'completed'
      : (liveKots.some(k => k.status === 'preparing') ? 'preparing' : 'pending');
  }

  return {
    ...order,
    items: parseOrderItems(order),
    kitchenStatus,
    kotCount: kots.length
  };
}

// Get all orders
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status } = req.query;

    let query = `SELECT * FROM orders WHERE is_deleted = 0`;
    const params = [];

    if (status && ALL_STATUSES.includes(status)) {
      query += ` AND status = ?`;
      params.push(status);
    } else if (status === 'active') {
      query += ` AND status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})`;
      params.push(...ACTIVE_STATUSES);
    }

    query += ` ORDER BY created_at DESC`;

    const orders = await db.all(query, params);
    const enriched = await Promise.all(orders.map(orderSummary));

    res.json({ success: true, orders: enriched });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to get orders' });
  }
});

// Get single order
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const order = await db.get(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`, [req.params.id]);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const kots = await db.all(
      `SELECT * FROM kitchen_orders WHERE order_id = ? ORDER BY created_at DESC`,
      [order.id]
    );

    const summary = await orderSummary(order);
    res.json({ success: true, order: { ...summary, kots } });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to get order' });
  }
});

// Create a new table order. Items marked sendToKitchen are sent to the kitchen immediately.
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { tableId, tableNumber, customerId, customerName, items = [], notes } = req.body;

    if (!tableId) {
      return res.status(400).json({ error: 'A table must be selected for a table order' });
    }
    if (items.length === 0) {
      return res.status(400).json({ error: 'Add at least one item to the order' });
    }

    const table = await db.get(`SELECT * FROM tables WHERE id = ? AND is_deleted = 0`, [tableId]);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const existingOrder = await db.get(
      `SELECT id, order_number FROM orders
       WHERE table_id = ? AND is_deleted = 0 AND status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})`,
      [tableId, ...ACTIVE_STATUSES]
    );
    if (existingOrder) {
      return res.status(400).json({
        error: `Table already has an open order (${existingOrder.order_number}). Add items to that order instead.`
      });
    }

    const orderId = uuidv4();
    const orderNumber = `ORD-${Date.now()}`;
    const { totalAmount } = billingService.computeTotals(items, 0, 0);
    const hasKitchenItems = items.some(item => item.sendToKitchen);

    await db.run(
      `INSERT INTO orders (
        id, order_number, table_id, table_number, customer_id, customer_name,
        items, status, kitchen_status, notes, total_amount, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId, orderNumber, table.id, table.table_number, customerId || null, customerName || null,
        JSON.stringify(items),
        hasKitchenItems ? 'sent' : 'open',
        hasKitchenItems ? 'pending' : 'none',
        notes || null, totalAmount, req.user.id
      ]
    );

    // Mark the table occupied
    await db.run(`UPDATE tables SET status = 'occupied', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [tableId]);

    // Send kitchen items to the KDS (one ticket per station)
    const tickets = await kitchenService.createKitchenTicket({
      sourceRefId: orderId,
      orderId,
      tableNumber: table.table_number,
      items,
      note: notes
    });

    getIO().emit('order-updated', { orderId, status: hasKitchenItems ? 'sent' : 'open' });
    getIO().emit('tables-changed');

    const created = await db.get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    const firstTicket = tickets[0] || null;
    res.json({
      success: true,
      order: await orderSummary(created),
      kitchenOrder: firstTicket ? { id: firstTicket.kotId, orderNumber: firstTicket.orderNumber, items: firstTicket.kitchenItems, station: firstTicket.station } : null,
      kitchenOrders: tickets.map(t => ({ id: t.kotId, orderNumber: t.orderNumber, station: t.station })),
      message: tickets.length > 0 ? `Order created and sent to kitchen (${tickets.length} ticket${tickets.length > 1 ? 's' : ''})` : 'Order created'
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Add items to an existing order. New kitchen items generate a fresh KOT.
router.put('/:id/items', authMiddleware, async (req, res) => {
  try {
    const { items = [], notes } = req.body;

    if (items.length === 0) {
      return res.status(400).json({ error: 'Add at least one item to the order' });
    }

    const order = await db.get(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.status === 'closed' || order.status === 'void') {
      return res.status(400).json({ error: `Order is ${order.status} and cannot accept items` });
    }

    const currentItems = parseOrderItems(order);

    // Merge the new items into the order (combine duplicates by product)
    const merged = [...currentItems];
    for (const item of items) {
      const existing = merged.find(i => i.productId === item.productId && !i.voided && i.sendToKitchen === !!item.sendToKitchen);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        // Re-activate a previously voided line for the same product
        const voidedLine = merged.find(i => i.productId === item.productId && i.voided && i.sendToKitchen === !!item.sendToKitchen);
        if (voidedLine) {
          voidedLine.voided = false;
          voidedLine.voidReason = null;
          voidedLine.quantity = item.quantity;
        } else {
          merged.push({
            productId: item.productId,
            productName: item.productName,
            price: item.price,
            taxRate: item.taxRate || 18,
            quantity: item.quantity,
            sendToKitchen: !!item.sendToKitchen
          });
        }
      }
    }

    const { totalAmount } = billingService.computeTotals(merged.filter(i => !i.voided), 0, 0);
    const hasKitchenItems = items.some(item => item.sendToKitchen);

    await db.run(
      `UPDATE orders SET
        items = ?, total_amount = ?, notes = COALESCE(?, notes),
        status = CASE WHEN ? THEN 'sent' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(merged), totalAmount, notes, hasKitchenItems ? 1 : 0, order.id]
    );

    // New KOT(s) for the freshly added kitchen items (one per station)
    const tickets = hasKitchenItems
      ? await kitchenService.createKitchenTicket({
          sourceRefId: order.id,
          orderId: order.id,
          tableNumber: order.table_number,
          items,
          note: notes
        })
      : [];

    getIO().emit('order-updated', { orderId: order.id, status: hasKitchenItems ? 'sent' : order.status });

    const updated = await db.get(`SELECT * FROM orders WHERE id = ?`, [order.id]);
    const firstTicket = tickets[0] || null;
    res.json({
      success: true,
      order: await orderSummary(updated),
      kitchenOrder: firstTicket ? { id: firstTicket.kotId, orderNumber: firstTicket.orderNumber, items: firstTicket.kitchenItems, station: firstTicket.station } : null,
      kitchenOrders: tickets.map(t => ({ id: t.kotId, orderNumber: t.orderNumber, station: t.station })),
      message: tickets.length > 0 ? `Items added and sent to kitchen (${tickets.length} ticket${tickets.length > 1 ? 's' : ''})` : 'Items added to order'
    });
  } catch (error) {
    console.error('Add order items error:', error);
    res.status(500).json({ error: 'Failed to add items to order' });
  }
});

// Reduce quantity or void a line item on an order. Kitchen items that were
// already sent have the voided quantity reflected on their pending KOTs.
router.put('/:id/items/:productId', authMiddleware, async (req, res) => {
  try {
    const { quantity, reason } = req.body;

    const order = await db.get(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.status === 'closed' || order.status === 'void') {
      return res.status(400).json({ error: `Order is ${order.status} and cannot be edited` });
    }

    const items = parseOrderItems(order);
    const line = items.find(i => i.productId === req.params.productId && !i.voided);
    if (!line) {
      return res.status(404).json({ error: 'Item not found on this order' });
    }

    const targetQty = quantity === undefined || quantity === null ? 0 : Number(quantity);
    if (isNaN(targetQty) || targetQty < 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }
    if (targetQty > line.quantity) {
      return res.status(400).json({ error: 'Quantity can only be reduced or voided' });
    }

    const voidQty = line.quantity - targetQty;
    if (voidQty === 0) {
      return res.json({ success: true, message: 'No change', order: await orderSummary(order) });
    }

    if (targetQty === 0) {
      line.voided = true;
      line.voidReason = reason || 'Voided';
    } else {
      line.quantity = targetQty;
    }

    if (line.sendToKitchen && voidQty > 0) {
      await kitchenService.markItemVoidedInKot(order.id, line.productId, voidQty, reason);
    }

    const { totalAmount } = billingService.computeTotals(items.filter(i => !i.voided), 0, 0);
    await db.run(
      `UPDATE orders SET items = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [JSON.stringify(items), totalAmount, order.id]
    );

    getIO().emit('order-updated', { orderId: order.id, status: order.status });

    const updated = await db.get(`SELECT * FROM orders WHERE id = ?`, [order.id]);
    res.json({
      success: true,
      message: targetQty === 0 ? 'Item voided' : 'Item quantity updated',
      order: await orderSummary(updated)
    });
  } catch (error) {
    console.error('Update order item error:', error);
    res.status(500).json({ error: 'Failed to update order item' });
  }
});

// Update order status: served, closed (after checkout), or void
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    if (!ALL_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid order status' });
    }

    const order = await db.get(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (status === 'closed' && !order.bill_id) {
      return res.status(400).json({ error: 'This order has no bill yet. Use checkout to bill it.' });
    }

    if (status === 'void') {
      // Cancel any live kitchen tickets and free the table
      await db.run(
        `UPDATE kitchen_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE order_id = ? AND status != 'completed'`,
        [order.id]
      );
      if (order.table_id) {
        await db.run(`UPDATE tables SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [order.table_id]);
      }
    }

    await db.run(
      `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, order.id]
    );

    getIO().emit('order-updated', { orderId: order.id, status });
    getIO().emit('tables-changed');

    res.json({ success: true, message: `Order marked as ${status}` });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// Move an active order (and its kitchen tickets) to another table.
router.put('/:id/transfer', authMiddleware, async (req, res) => {
  try {
    const { targetTableId } = req.body;

    const order = await db.get(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.status === 'closed' || order.status === 'void') {
      return res.status(400).json({ error: `Order is ${order.status} and cannot be transferred` });
    }
    if (!targetTableId) {
      return res.status(400).json({ error: 'Target table is required' });
    }

    const target = await db.get(`SELECT * FROM tables WHERE id = ? AND is_deleted = 0`, [targetTableId]);
    if (!target) {
      return res.status(404).json({ error: 'Target table not found' });
    }
    if (target.id === order.table_id) {
      return res.status(400).json({ error: 'Order is already on this table' });
    }

    const existingOrder = await db.get(
      `SELECT id, order_number FROM orders
       WHERE table_id = ? AND is_deleted = 0 AND status NOT IN ('closed', 'void')`,
      [targetTableId]
    );
    if (existingOrder) {
      return res.status(400).json({ error: `Target table already has open order ${existingOrder.order_number}` });
    }

    // Free the old table (only if it was occupied by this order)
    if (order.table_id) {
      await db.run(`UPDATE tables SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [order.table_id]);
    }
    await db.run(`UPDATE tables SET status = 'occupied', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [targetTableId]);

    await db.run(
      `UPDATE orders SET table_id = ?, table_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [target.id, target.table_number, order.id]
    );

    // Update the table number on linked kitchen tickets
    await db.run(`UPDATE kitchen_orders SET table_number = ? WHERE order_id = ?`, [target.table_number, order.id]);

    getIO().emit('order-updated', { orderId: order.id, status: order.status });
    getIO().emit('tables-changed');

    const updated = await db.get(`SELECT * FROM orders WHERE id = ?`, [order.id]);
    res.json({
      success: true,
      message: `Order moved to ${target.table_number}`,
      order: await orderSummary(updated)
    });
  } catch (error) {
    console.error('Transfer order error:', error);
    res.status(500).json({ error: 'Failed to transfer order' });
  }
});

// Split an order: move selected non-kitchen items to a new order (walk-in or
// another table). Items already sent to the kitchen stay on the source order.
router.post('/:id/split', authMiddleware, async (req, res) => {
  try {
    const { targetTableId, items = [] } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Select at least one item to move' });
    }

    const order = await db.get(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.status === 'closed' || order.status === 'void') {
      return res.status(400).json({ error: `Order is ${order.status} and cannot be split` });
    }

    const currentItems = parseOrderItems(order);
    const remaining = [];
    const moved = [];
    const requestQty = new Map();
    for (const item of items) {
      if (item && item.productId && item.quantity > 0) {
        requestQty.set(item.productId, (requestQty.get(item.productId) || 0) + item.quantity);
      }
    }

    // Group lines by product, preferring non-kitchen lines as split candidates.
    const kitchenLines = [];
    const nonKitchenLines = [];

    for (const line of currentItems) {
      if (line.voided) {
        remaining.push(line);
      } else if (line.sendToKitchen) {
        kitchenLines.push(line);
      } else {
        nonKitchenLines.push(line);
      }
    }

    for (const line of nonKitchenLines) {
      const wanted = requestQty.get(line.productId) || 0;
      if (wanted > 0) {
        const qty = Math.min(line.quantity, wanted);
        moved.push({ ...line, quantity: qty });
        requestQty.set(line.productId, wanted - qty);
        if (qty < line.quantity) {
          remaining.push({ ...line, quantity: line.quantity - qty });
        }
      } else {
        remaining.push(line);
      }
    }

    // Only items the user asked to move that had NO non-kitchen line are blocked.
    const blockedRequest = items.find(item => {
      const remainingQty = requestQty.get(item.productId) || 0;
      return remainingQty > 0 && kitchenLines.some(k => k.productId === item.productId);
    });

    if (blockedRequest) {
      const kitchenLine = kitchenLines.find(k => k.productId === blockedRequest.productId);
      return res.status(400).json({
        error: `"${(kitchenLine && kitchenLine.productName) || blockedRequest.productName || 'Item'}" was already sent to the kitchen and cannot be split`
      });
    }

    remaining.push(...kitchenLines);

    if (moved.length === 0) {
      return res.status(400).json({ error: 'No movable items selected' });
    }

    // Create the split order (open, no kitchen items)
    const newOrderId = uuidv4();
    const orderNumber = `ORD-${Date.now()}`;
    const { totalAmount } = billingService.computeTotals(moved, 0, 0);

    let newTableId = null;
    let newTableNumber = null;
    if (targetTableId) {
      const target = await db.get(`SELECT * FROM tables WHERE id = ? AND is_deleted = 0`, [targetTableId]);
      if (!target) {
        return res.status(404).json({ error: 'Target table not found' });
      }
      const existingOrder = await db.get(
        `SELECT id FROM orders WHERE table_id = ? AND is_deleted = 0 AND status NOT IN ('closed', 'void')`,
        [targetTableId]
      );
      if (existingOrder) {
        return res.status(400).json({ error: 'Target table already has an open order' });
      }
      await db.run(`UPDATE tables SET status = 'occupied', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [targetTableId]);
      newTableId = target.id;
      newTableNumber = target.table_number;
    }

    await db.run(
      `INSERT INTO orders (
        id, order_number, table_id, table_number, customer_id, customer_name,
        items, status, kitchen_status, notes, total_amount, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'none', ?, ?, ?)`,
      [
        newOrderId, orderNumber, newTableId, newTableNumber, null, order.customer_name,
        JSON.stringify(moved), null, totalAmount, req.user.id
      ]
    );

    // Update the source order
    const sourceTotal = billingService.computeTotals(remaining.filter(i => !i.voided), 0, 0).totalAmount;
    await db.run(
      `UPDATE orders SET items = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [JSON.stringify(remaining), sourceTotal, order.id]
    );

    getIO().emit('order-updated', { orderId: order.id, status: order.status });
    getIO().emit('order-updated', { orderId: newOrderId, status: 'open' });
    getIO().emit('tables-changed');

    const updatedSource = await db.get(`SELECT * FROM orders WHERE id = ?`, [order.id]);
    const splitOrder = await db.get(`SELECT * FROM orders WHERE id = ?`, [newOrderId]);

    res.json({
      success: true,
      message: `Moved ${moved.length} item(s) to a new order`,
      order: await orderSummary(updatedSource),
      splitOrder: await orderSummary(splitOrder)
    });
  } catch (error) {
    console.error('Split order error:', error);
    res.status(500).json({ error: 'Failed to split order' });
  }
});

// Checkout an order: creates the bill, closes the order and frees the table.
router.post('/:id/checkout', authMiddleware, async (req, res) => {
  try {
    const order = await db.get(`SELECT * FROM orders WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.status === 'closed') {
      return res.status(400).json({ error: 'This order is already billed' });
    }
    if (order.status === 'void') {
      return res.status(400).json({ error: 'Voided orders cannot be billed' });
    }

    const items = parseOrderItems(order).filter(i => !i.voided);
    if (items.length === 0) {
      return res.status(400).json({ error: 'Order has no items to bill' });
    }

    const { paymentMethod, paidAmount, discountPercentage = 0, notes, splitInfo, customerId } = req.body;

    const bill = await billingService.createBill({
      customerId: customerId || order.customer_id || null,
      items,
      discountPercentage,
      paymentMethod,
      paidAmount,
      notes: notes || order.notes,
      splitInfo,
      tableId: order.table_id,
      tableNumber: order.table_number,
      orderId: order.id,
      createKitchenOrders: false,
      employeeId: req.user.id
    });

    await db.run(
      `UPDATE orders SET status = 'closed', bill_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [bill.id, order.id]
    );

    // Free the table
    if (order.table_id) {
      await db.run(`UPDATE tables SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [order.table_id]);
    }

    getIO().emit('order-updated', { orderId: order.id, status: 'closed' });
    getIO().emit('tables-changed');

    res.json({ success: true, bill, message: 'Order billed successfully' });
  } catch (error) {
    console.error('Checkout order error:', error);
    res.status(500).json({ error: 'Failed to checkout order' });
  }
});

module.exports = router;
