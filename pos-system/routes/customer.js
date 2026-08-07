const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');

// Get all customers
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { search, membershipType } = req.query;
    
    let query = `SELECT * FROM customers WHERE is_deleted = 0`;
    const params = [];

    if (search) {
      query += ` AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (membershipType) {
      query += ` AND membership_type = ?`;
      params.push(membershipType);
    }

    query += ` ORDER BY name ASC`;

    const customers = await db.all(query, params);
    res.json({ success: true, customers });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: 'Failed to get customers' });
  }
});

// Get customer by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const customer = await db.get(`SELECT * FROM customers WHERE id = ?`, [req.params.id]);
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const purchaseHistory = await db.all(
      `SELECT * FROM bills WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );

    const loyaltyTransactions = await db.all(
      `SELECT * FROM loyalty_transactions WHERE customer_id = ? ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({
      success: true,
      customer: { ...customer, purchaseHistory, loyaltyTransactions }
    });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: 'Failed to get customer' });
  }
});

// Create customer
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, email, phone, address, birthday, notes } = req.body;
    const id = uuidv4();

    await db.run(
      `INSERT INTO customers (id, name, email, phone, address, birthday, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, phone, address, birthday, notes]
    );

    res.json({ success: true, message: 'Customer created successfully' });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// Update customer
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, email, phone, address, membershipType, birthday, notes } = req.body;

    await db.run(
      `UPDATE customers SET
        name = ?, email = ?, phone = ?, address = ?,
        membership_type = ?, birthday = ?, notes = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, email, phone, address, membershipType, birthday, notes, req.params.id]
    );

    res.json({ success: true, message: 'Customer updated successfully' });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// Delete customer
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await db.run(
      `UPDATE customers SET is_deleted = 1 WHERE id = ?`,
      [req.params.id]
    );

    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

// Redeem loyalty points
router.post('/:id/redeem-points', authMiddleware, async (req, res) => {
  try {
    const { points, description } = req.body;
    const customer = await db.get(`SELECT * FROM customers WHERE id = ?`, [req.params.id]);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    if (customer.loyalty_points < points) {
      return res.status(400).json({ error: 'Insufficient loyalty points' });
    }

    await db.run(
      `UPDATE customers SET loyalty_points = loyalty_points - ? WHERE id = ?`,
      [points, req.params.id]
    );

    const id = uuidv4();
    await db.run(
      `INSERT INTO loyalty_transactions (id, customer_id, points, transaction_type, description)
       VALUES (?, ?, ?, 'redeemed', ?)`,
      [id, req.params.id, -points, description || 'Points redeemed']
    );

    res.json({ success: true, message: 'Points redeemed successfully' });
  } catch (error) {
    console.error('Redeem points error:', error);
    res.status(500).json({ error: 'Failed to redeem points' });
  }
});

// Get birthday customers for current month
router.get('/birthdays/current-month', authMiddleware, async (req, res) => {
  try {
    const currentMonth = new Date().getMonth() + 1;
    const customers = await db.all(
      `SELECT * FROM customers WHERE strftime('%m', birthday) = ? AND is_deleted = 0`,
      [currentMonth.toString().padStart(2, '0')]
    );

    res.json({ success: true, customers });
  } catch (error) {
    console.error('Get birthday customers error:', error);
    res.status(500).json({ error: 'Failed to get birthday customers' });
  }
});

module.exports = router;
