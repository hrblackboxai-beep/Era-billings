const express = require('express');
const router = express.Router();
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');
const billingService = require('../services/billingService');
const socketService = require('../services/socketService');

// Create bill (checkout)
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const {
      customerId,
      items,
      discountPercentage = 0,
      discountAmount = 0,
      paymentMethod,
      paidAmount,
      notes,
      splitInfo,
      tableId,
      tableNumber,
      orderId
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Bill must contain at least one item' });
    }

    const bill = await billingService.createBill({
      customerId,
      items,
      discountPercentage,
      discountAmount,
      paymentMethod,
      paidAmount,
      notes,
      splitInfo,
      tableId,
      tableNumber,
      orderId,
      createKitchenOrders: !orderId,
      employeeId: req.user.id
    });

    // If this bill belongs to a table order, close the order and free the table
    if (orderId) {
      await db.run(
        `UPDATE orders SET status = 'closed', bill_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [bill.id, orderId]
      );
      if (tableId) {
        await db.run(`UPDATE tables SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [tableId]);
      }
      socketService.emit('order-updated', { orderId, status: 'closed' });
      socketService.emit('tables-changed');
    }

    res.json({
      success: true,
      bill,
      message: 'Bill created successfully'
    });
  } catch (error) {
    console.error('Create bill error:', error);
    res.status(500).json({ error: 'Failed to create bill' });
  }
});

// Get all bills
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { date, status, customerId } = req.query;

    let query = `SELECT * FROM bills WHERE is_deleted = 0`;
    const params = [];

    if (date) {
      query += ` AND DATE(created_at) = ?`;
      params.push(date);
    }

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (customerId) {
      query += ` AND customer_id = ?`;
      params.push(customerId);
    }

    query += ` ORDER BY created_at DESC`;

    const bills = await db.all(query, params);
    res.json({ success: true, bills });
  } catch (error) {
    console.error('Get bills error:', error);
    res.status(500).json({ error: 'Failed to get bills' });
  }
});

// Get single bill with items
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const bill = await db.get(`SELECT * FROM bills WHERE id = ?`, [req.params.id]);

    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const items = await db.all(`SELECT * FROM bill_items WHERE bill_id = ?`, [req.params.id]);
    const customer = bill.customer_id
      ? await db.get(`SELECT * FROM customers WHERE id = ?`, [bill.customer_id])
      : null;

    res.json({
      success: true,
      bill: { ...bill, items, customer }
    });
  } catch (error) {
    console.error('Get bill error:', error);
    res.status(500).json({ error: 'Failed to get bill' });
  }
});

// Void/cancel bill
router.put('/:id/void', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;

    // Get bill items to restore stock
    const items = await db.all(`SELECT * FROM bill_items WHERE bill_id = ?`, [req.params.id]);

    await db.run(
      `UPDATE bills SET status = 'voided', notes = ? WHERE id = ?`,
      [reason, req.params.id]
    );

    // Restore stock
    for (const item of items) {
      await db.run(
        `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?`,
        [item.quantity, item.product_id]
      );
    }

    res.json({ success: true, message: 'Bill voided successfully' });
  } catch (error) {
    console.error('Void bill error:', error);
    res.status(500).json({ error: 'Failed to void bill' });
  }
});

// Search products by barcode
router.get('/search/barcode/:barcode', authMiddleware, async (req, res) => {
  try {
    const product = await db.get(
      `SELECT * FROM products WHERE barcode = ? AND is_active = 1`,
      [req.params.barcode]
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ success: true, product });
  } catch (error) {
    console.error('Search barcode error:', error);
    res.status(500).json({ error: 'Failed to search product' });
  }
});

module.exports = router;
