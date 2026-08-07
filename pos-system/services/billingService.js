const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');
const kitchenService = require('./kitchenService');

// Compute totals shared by the billing and orders routes.
function computeTotals(items, discountPercentage, discountAmount) {
  let subtotal = 0;
  let totalTax = 0;

  items.forEach(item => {
    const itemTotal = item.price * item.quantity;
    const taxAmount = (itemTotal * (item.taxRate || 18)) / 100;
    subtotal += itemTotal;
    totalTax += taxAmount;
  });

  const finalDiscountAmount = discountPercentage > 0
    ? (subtotal * discountPercentage) / 100
    : (discountAmount || 0);

  const totalAmount = subtotal - finalDiscountAmount + totalTax;

  return { subtotal, totalTax, finalDiscountAmount, totalAmount };
}

// Create a bill and all of its side effects (stock, loyalty, payments, KOTs).
// Options:
//   - tableId / tableNumber: table the bill is charged to
//   - orderId: when checking out a table order, its KOTs are linked to this bill
//     and no new KOTs are created
//   - createKitchenOrders: create KOTs for sendToKitchen items (direct checkout)
//   - splitInfo: [{ amount, paymentMethod }] records one payment per split
async function createBill({
  customerId,
  items = [],
  discountPercentage = 0,
  discountAmount = 0,
  paymentMethod,
  paidAmount,
  notes,
  splitInfo,
  tableId,
  tableNumber,
  orderId,
  createKitchenOrders = true,
  employeeId
}) {
  const { subtotal, totalTax, finalDiscountAmount, totalAmount } = computeTotals(
    items, discountPercentage, discountAmount
  );
  const paid = paidAmount != null && !isNaN(paidAmount) ? paidAmount : totalAmount;
  const changeAmount = paid - totalAmount;

  const prefix = (await db.get(`SELECT value FROM settings WHERE key = 'invoice_prefix'`))?.value || 'INV';
  const count = await db.get(`SELECT COUNT(*) as count FROM bills WHERE DATE(created_at) = DATE('now')`);
  const billNumber = `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${(count.count + 1).toString().padStart(4, '0')}`;

  const billId = uuidv4();

  await db.run(
    `INSERT INTO bills (
      id, bill_number, customer_id, employee_id, subtotal,
      discount_amount, discount_percentage, tax_amount, total_amount,
      paid_amount, change_amount, payment_method, notes, split_info,
      table_id, table_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      billId, billNumber, customerId, employeeId, subtotal,
      finalDiscountAmount, discountPercentage, totalTax, totalAmount,
      paid, changeAmount, paymentMethod, notes,
      splitInfo ? JSON.stringify(splitInfo) : null,
      tableId || null, tableNumber || null
    ]
  );

  for (const item of items) {
    const itemId = uuidv4();
    const itemTotal = item.price * item.quantity;
    const taxAmount = (itemTotal * (item.taxRate || 18)) / 100;

    await db.run(
      `INSERT INTO bill_items (
        id, bill_id, product_id, product_name, quantity, price,
        tax_rate, tax_amount, total_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId, billId, item.productId, item.productName,
        item.quantity, item.price, item.taxRate || 18, taxAmount, itemTotal + taxAmount
      ]
    );

    await db.run(
      `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?`,
      [item.quantity, item.productId]
    );

    const product = await db.get(`SELECT * FROM products WHERE id = ?`, [item.productId]);
    if (product && product.stock_quantity <= product.reorder_level) {
      console.log(`Low stock alert: ${product.name} - Current stock: ${product.stock_quantity}`);
    }
  }

  if (customerId) {
    const pointsEarned = Math.floor(totalAmount / 100) * 10;
    await db.run(
      `UPDATE customers SET loyalty_points = loyalty_points + ?, total_purchases = total_purchases + ? WHERE id = ?`,
      [pointsEarned, totalAmount, customerId]
    );

    const loyaltyId = uuidv4();
    await db.run(
      `INSERT INTO loyalty_transactions (id, customer_id, points, transaction_type, bill_id, description)
       VALUES (?, ?, ?, 'earned', ?, 'Points earned on purchase')`,
      [loyaltyId, customerId, pointsEarned, billId]
    );
  }

  // Record payments (single, or one per split entry)
  if (splitInfo && Array.isArray(splitInfo) && splitInfo.length) {
    for (const split of splitInfo) {
      const paymentId = uuidv4();
      await db.run(
        `INSERT INTO payments (id, bill_id, amount, payment_method)
         VALUES (?, ?, ?, ?)`,
        [paymentId, billId, split.amount, split.paymentMethod]
      );
    }
    await db.run(
      `UPDATE bills SET payment_status = 'paid', paid_amount = ? WHERE id = ?`,
      [totalAmount, billId]
    );
  } else {
    const paymentId = uuidv4();
    await db.run(
      `INSERT INTO payments (id, bill_id, amount, payment_method)
       VALUES (?, ?, ?, ?)`,
      [paymentId, billId, paid, paymentMethod]
    );
  }

  // Kitchen orders: either link existing KOTs (order checkout) or create new ones
  if (orderId) {
    await kitchenService.linkOrderKitsToBill(orderId, billId);
  } else if (createKitchenOrders) {
    await kitchenService.createKitchenTicket({
      sourceRefId: billId,
      orderId: null,
      tableNumber,
      items,
      note: notes
    });
  }

  const bill = await db.get(`SELECT * FROM bills WHERE id = ?`, [billId]);
  const billItems = await db.all(`SELECT * FROM bill_items WHERE bill_id = ?`, [billId]);

  return { ...bill, items: billItems };
}

module.exports = { createBill, computeTotals };
