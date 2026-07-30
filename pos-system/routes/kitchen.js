const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');

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

// Get all kitchen orders
router.get('/orders', authMiddleware, async (req, res) => {
  try {
    const { status, station } = req.query;
    
    let query = `SELECT * FROM kitchen_orders WHERE 1=1`;
    const params = [];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (station) {
      query += ` AND station = ?`;
      params.push(station);
    }

    query += ` ORDER BY created_at DESC`;

    const orders = await db.all(query, params);
    
    // Parse items JSON
    const parsedOrders = orders.map(order => ({
      ...order,
      items: JSON.parse(order.items)
    }));

    res.json({ success: true, orders: parsedOrders });
  } catch (error) {
    console.error('Get kitchen orders error:', error);
    res.status(500).json({ error: 'Failed to get kitchen orders' });
  }
});

// Update order status
router.put('/orders/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    
    await db.run(
      `UPDATE kitchen_orders SET status = ?, updated_at = CURRENT_TIMESTAMP ${
        status === 'completed' ? ', prepared_at = CURRENT_TIMESTAMP' : ''
      } WHERE id = ?`,
      [status, req.params.id]
    );

    // Emit socket event for status update
    const io = require('../server').io;
    const order = await db.get(`SELECT * FROM kitchen_orders WHERE id = ?`, [req.params.id]);
    io.emit('order-status-changed', {
      orderId: req.params.id,
      status,
      orderNumber: order.order_number
    });

    res.json({ success: true, message: 'Order status updated' });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// Get pending orders count
router.get('/stats/pending', authMiddleware, async (req, res) => {
  try {
    const stats = await db.get(
      `SELECT COUNT(*) as count FROM kitchen_orders WHERE status = 'pending'`
    );
    res.json({ success: true, count: stats.count });
  } catch (error) {
    console.error('Get pending count error:', error);
    res.status(500).json({ error: 'Failed to get pending count' });
  }
});

module.exports = router;
