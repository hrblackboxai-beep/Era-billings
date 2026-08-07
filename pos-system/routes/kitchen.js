const express = require('express');
const router = express.Router();
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');
const kitchenService = require('../services/kitchenService');
const socketService = require('../services/socketService');

// Get all kitchen orders
router.get('/orders', authMiddleware, async (req, res) => {
  try {
    const { status, station } = req.query;
    
    let query = `SELECT * FROM kitchen_orders WHERE 1=1`;
    const params = [];

    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        query += ` AND status = ?`;
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        query += ` AND status IN (${statuses.map(() => '?').join(', ')})`;
        params.push(...statuses);
      }
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

// Get a single kitchen order ticket
router.get('/orders/:id', authMiddleware, async (req, res) => {
  try {
    const order = await db.get(`SELECT * FROM kitchen_orders WHERE id = ?`, [req.params.id]);
    if (!order) {
      return res.status(404).json({ error: 'Kitchen order not found' });
    }
    res.json({
      success: true,
      order: {
        ...order,
        items: JSON.parse(order.items || '[]')
      }
    });
  } catch (error) {
    console.error('Get kitchen order error:', error);
    res.status(500).json({ error: 'Failed to get kitchen order' });
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
    const order = await db.get(`SELECT * FROM kitchen_orders WHERE id = ?`, [req.params.id]);

    // Keep the parent table order's kitchen status in sync
    if (order && order.order_id) {
      await kitchenService.updateOrderKitchenStatus(order.order_id);
    }

    socketService.emit('order-status-changed', {
      orderId: req.params.id,
      status,
      orderNumber: order ? order.order_number : null,
      tableNumber: order ? order.table_number : null
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
