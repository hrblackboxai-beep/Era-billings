const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');

// Middleware to verify token
const authMiddleware = (req, res, next) => {
  const jwt = require('jsonwebtoken');
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'pos-secret-key-offline');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

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
      splitInfo 
    } = req.body;

    // Calculate totals
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
      : discountAmount;
    
    const totalAmount = subtotal - finalDiscountAmount + totalTax;
    const changeAmount = paidAmount - totalAmount;

    // Generate bill number
    const prefix = (await db.get(`SELECT value FROM settings WHERE key = 'invoice_prefix'`))?.value || 'INV';
    const count = await db.get(`SELECT COUNT(*) as count FROM bills WHERE DATE(created_at) = DATE('now')`);
    const billNumber = `${prefix}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${(count.count + 1).toString().padStart(4, '0')}`;

    const billId = uuidv4();

    // Start transaction-like operation
    await db.run(
      `INSERT INTO bills (
        id, bill_number, customer_id, employee_id, subtotal, 
        discount_amount, discount_percentage, tax_amount, total_amount,
        paid_amount, change_amount, payment_method, notes, split_info
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        billId, billNumber, customerId, req.user.id, subtotal,
        finalDiscountAmount, discountPercentage, totalTax, totalAmount,
        paidAmount, changeAmount, paymentMethod, notes, 
        splitInfo ? JSON.stringify(splitInfo) : null
      ]
    );

    // Insert bill items and update stock
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

      // Update stock
      await db.run(
        `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?`,
        [item.quantity, item.productId]
      );

      // Check for low stock alert
      const product = await db.get(
        `SELECT * FROM products WHERE id = ?`,
        [item.productId]
      );

      if (product && product.stock_quantity <= product.reorder_level) {
        console.log(`Low stock alert: ${product.name} - Current stock: ${product.stock_quantity}`);
      }
    }

    // Update customer loyalty points
    if (customerId) {
      const pointsEarned = Math.floor(totalAmount / 100) * 10;
      await db.run(
        `UPDATE customers SET loyalty_points = loyalty_points + ?, total_purchases = total_purchases + ? WHERE id = ?`,
        [pointsEarned, totalAmount, customerId]
      );

      // Record loyalty transaction
      const loyaltyId = uuidv4();
      await db.run(
        `INSERT INTO loyalty_transactions (id, customer_id, points, transaction_type, bill_id, description)
         VALUES (?, ?, ?, 'earned', ?, 'Points earned on purchase')`,
        [loyaltyId, customerId, pointsEarned, billId]
      );
    }

    // Record payment
    const paymentId = uuidv4();
    await db.run(
      `INSERT INTO payments (id, bill_id, amount, payment_method)
       VALUES (?, ?, ?, ?)`,
      [paymentId, billId, paidAmount, paymentMethod]
    );

    // Create kitchen order if applicable
    const hasKitchenItems = items.some(item => item.sendToKitchen);
    if (hasKitchenItems) {
      const kitchenOrderId = uuidv4();
      const orderNumber = `KOT-${Date.now()}`;
      const kitchenItems = items.filter(item => item.sendToKitchen);

      await db.run(
        `INSERT INTO kitchen_orders (id, bill_id, order_number, items, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [kitchenOrderId, billId, orderNumber, JSON.stringify(kitchenItems)]
      );

      // Emit socket event for kitchen
      const io = require('../server').io;
      io.emit('order-created', {
        orderId: kitchenOrderId,
        orderNumber,
        items: kitchenItems,
        billNumber
      });
    }

    // Get complete bill details
    const bill = await db.get(`SELECT * FROM bills WHERE id = ?`, [billId]);
    const billItems = await db.all(`SELECT * FROM bill_items WHERE bill_id = ?`, [billId]);

    res.json({
      success: true,
      bill: {
        ...bill,
        items: billItems
      },
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
