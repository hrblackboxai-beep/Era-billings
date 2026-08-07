const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');

// Get all products
router.get('/products', authMiddleware, async (req, res) => {
  try {
    const { category, search, lowStock } = req.query;
    
    let query = `SELECT * FROM products WHERE is_deleted = 0 AND is_active = 1`;
    const params = [];

    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }

    if (search) {
      query += ` AND (name LIKE ? OR barcode LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (lowStock === 'true') {
      query += ` AND stock_quantity <= reorder_level`;
    }

    query += ` ORDER BY name ASC`;

    const products = await db.all(query, params);
    res.json({ success: true, products });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Failed to get products' });
  }
});

// Get single product
router.get('/products/:id', authMiddleware, async (req, res) => {
  try {
    const product = await db.get(
      `SELECT * FROM products WHERE id = ?`,
      [req.params.id]
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ success: true, product });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Failed to get product' });
  }
});

// Create product
router.post('/products', authMiddleware, async (req, res) => {
  try {
    const {
      name, description, category, barcode, price, costPrice,
      taxRate, stockQuantity, reorderLevel, unit, supplierId, imageUrl, station
    } = req.body;

    const id = uuidv4();

    await db.run(
      `INSERT INTO products (
        id, name, description, category, barcode, price, cost_price,
        tax_rate, stock_quantity, reorder_level, unit, supplier_id, image_url, station
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, name, description, category, barcode, price, costPrice,
        taxRate || 18, stockQuantity || 0, reorderLevel || 10, 
        unit || 'pcs', supplierId, imageUrl, station || 'main'
      ]
    );

    res.json({ success: true, message: 'Product created successfully' });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Update product
router.put('/products/:id', authMiddleware, async (req, res) => {
  try {
    const {
      name, description, category, barcode, price, costPrice,
      taxRate, stockQuantity, reorderLevel, unit, supplierId, imageUrl, station
    } = req.body;

    await db.run(
      `UPDATE products SET
        name = ?, description = ?, category = ?, barcode = ?,
        price = ?, cost_price = ?, tax_rate = ?, stock_quantity = ?,
        reorder_level = ?, unit = ?, supplier_id = ?, image_url = ?, station = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        name, description, category, barcode, price, costPrice,
        taxRate, stockQuantity, reorderLevel, unit, supplierId, imageUrl,
        station || 'main', req.params.id
      ]
    );

    res.json({ success: true, message: 'Product updated successfully' });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete product (soft delete)
router.delete('/products/:id', authMiddleware, async (req, res) => {
  try {
    await db.run(
      `UPDATE products SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.params.id]
    );

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Get categories
router.get('/categories', authMiddleware, async (req, res) => {
  try {
    const categories = await db.all(`SELECT * FROM categories ORDER BY name`);
    res.json({ success: true, categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

// Create category
router.post('/categories', authMiddleware, async (req, res) => {
  try {
    const { name, description, parentId } = req.body;
    const id = uuidv4();

    await db.run(
      `INSERT INTO categories (id, name, description, parent_id) VALUES (?, ?, ?, ?)`,
      [id, name, description, parentId]
    );

    res.json({ success: true, message: 'Category created successfully' });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Record waste
router.post('/waste', authMiddleware, async (req, res) => {
  try {
    const { productId, quantity, reason, recordedBy } = req.body;

    const product = await db.get(`SELECT * FROM products WHERE id = ?`, [productId]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const cost = (product.cost_price || product.price) * quantity;
    const id = uuidv4();

    await db.run(
      `INSERT INTO waste_records (id, product_id, quantity, reason, recorded_by, cost)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, productId, quantity, reason, recordedBy || req.user.id, cost]
    );

    // Reduce stock
    await db.run(
      `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?`,
      [quantity, productId]
    );

    res.json({ success: true, message: 'Waste recorded successfully' });
  } catch (error) {
    console.error('Record waste error:', error);
    res.status(500).json({ error: 'Failed to record waste' });
  }
});

// Get waste records
router.get('/waste', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = `SELECT w.*, p.name as product_name FROM waste_records w 
                 JOIN products p ON w.product_id = p.id WHERE 1=1`;
    const params = [];

    if (startDate) {
      query += ` AND DATE(w.created_at) >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND DATE(w.created_at) <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY w.created_at DESC`;

    const records = await db.all(query, params);
    res.json({ success: true, records });
  } catch (error) {
    console.error('Get waste records error:', error);
    res.status(500).json({ error: 'Failed to get waste records' });
  }
});

// Create purchase order
router.post('/purchase-orders', authMiddleware, async (req, res) => {
  try {
    const { supplierId, items, expectedDate, notes } = req.body;

    const id = uuidv4();
    const orderNumber = `PO-${Date.now()}`;
    let totalAmount = 0;

    items.forEach(item => {
      totalAmount += item.price * item.quantity;
    });

    await db.run(
      `INSERT INTO purchase_orders (id, order_number, supplier_id, total_amount, expected_date, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, orderNumber, supplierId, totalAmount, expectedDate, notes]
    );

    for (const item of items) {
      const itemId = uuidv4();
      await db.run(
        `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, price, total_amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [itemId, id, item.productId, item.quantity, item.price, item.price * item.quantity]
      );
    }

    res.json({ success: true, message: 'Purchase order created successfully' });
  } catch (error) {
    console.error('Create purchase order error:', error);
    res.status(500).json({ error: 'Failed to create purchase order' });
  }
});

// Receive purchase order (update stock)
router.put('/purchase-orders/:id/receive', authMiddleware, async (req, res) => {
  try {
    const items = await db.all(
      `SELECT * FROM purchase_order_items WHERE purchase_order_id = ?`,
      [req.params.id]
    );

    for (const item of items) {
      await db.run(
        `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?`,
        [item.quantity, item.product_id]
      );
      await db.run(
        `UPDATE purchase_order_items SET received_quantity = quantity WHERE id = ?`,
        [item.id]
      );
    }

    await db.run(
      `UPDATE purchase_orders SET status = 'received', received_date = CURRENT_DATE WHERE id = ?`,
      [req.params.id]
    );

    res.json({ success: true, message: 'Purchase order received successfully' });
  } catch (error) {
    console.error('Receive purchase order error:', error);
    res.status(500).json({ error: 'Failed to receive purchase order' });
  }
});

module.exports = router;
