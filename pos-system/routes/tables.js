const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');
const socketService = require('../services/socketService');

const VALID_STATUSES = ['available', 'occupied', 'reserved', 'maintenance'];

// Get all tables
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, zone } = req.query;

    let query = `SELECT * FROM tables WHERE is_deleted = 0`;
    const params = [];

    if (status && VALID_STATUSES.includes(status)) {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (zone) {
      query += ` AND zone = ?`;
      params.push(zone);
    }

    query += ` ORDER BY table_number ASC`;

    const tables = await db.all(query, params);

    // Attach the active order for occupied tables
    const enriched = await Promise.all(tables.map(async table => {
      const activeOrder = await db.get(
        `SELECT id, order_number, status, total_amount FROM orders
         WHERE table_id = ? AND is_deleted = 0 AND status NOT IN ('closed', 'void')
         ORDER BY created_at DESC LIMIT 1`,
        [table.id]
      );
      return { ...table, activeOrder: activeOrder || null };
    }));

    res.json({ success: true, tables: enriched });
  } catch (error) {
    console.error('Get tables error:', error);
    res.status(500).json({ error: 'Failed to get tables' });
  }
});

// Get single table
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const table = await db.get(`SELECT * FROM tables WHERE id = ? AND is_deleted = 0`, [req.params.id]);

    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const activeOrder = await db.get(
      `SELECT * FROM orders WHERE table_id = ? AND is_deleted = 0 AND status NOT IN ('closed', 'void')
       ORDER BY created_at DESC LIMIT 1`,
      [table.id]
    );

    res.json({ success: true, table: { ...table, activeOrder: activeOrder || null } });
  } catch (error) {
    console.error('Get table error:', error);
    res.status(500).json({ error: 'Failed to get table' });
  }
});

// Create table
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { tableNumber, capacity, zone, status } = req.body;

    if (!tableNumber) {
      return res.status(400).json({ error: 'Table number is required' });
    }

    const existing = await db.get(`SELECT id FROM tables WHERE table_number = ? AND is_deleted = 0`, [tableNumber]);
    if (existing) {
      return res.status(400).json({ error: `Table "${tableNumber}" already exists` });
    }

    const id = uuidv4();

    await db.run(
      `INSERT INTO tables (id, table_number, capacity, zone, status)
       VALUES (?, ?, ?, ?, ?)`,
      [id, tableNumber, capacity || 2, zone || 'main', status || 'available']
    );

    socketService.emit('tables-changed');

    res.json({ success: true, message: 'Table created successfully', id });
  } catch (error) {
    console.error('Create table error:', error);
    res.status(500).json({ error: 'Failed to create table' });
  }
});

// Update table
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { tableNumber, capacity, zone, status } = req.body;

    if (!tableNumber) {
      return res.status(400).json({ error: 'Table number is required' });
    }

    const table = await db.get(`SELECT * FROM tables WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid table status' });
    }

    await db.run(
      `UPDATE tables SET
        table_number = ?, capacity = ?, zone = ?, status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [tableNumber, capacity, zone, status, req.params.id]
    );

    socketService.emit('tables-changed');

    res.json({ success: true, message: 'Table updated successfully' });
  } catch (error) {
    console.error('Update table error:', error);
    res.status(500).json({ error: 'Failed to update table' });
  }
});

// Update table status only
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid table status' });
    }

    const table = await db.get(`SELECT * FROM tables WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Refuse to clear an occupied table that still has a live order
    if (status !== 'occupied' && table.status === 'occupied') {
      const activeOrder = await db.get(
        `SELECT id, order_number FROM orders
         WHERE table_id = ? AND is_deleted = 0 AND status NOT IN ('closed', 'void')`,
        [table.id]
      );
      if (activeOrder) {
        return res.status(400).json({
          error: `Close order ${activeOrder.order_number} first before changing this table's status`
        });
      }
    }

    await db.run(
      `UPDATE tables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, req.params.id]
    );

    socketService.emit('tables-changed');

    res.json({ success: true, message: 'Table status updated successfully' });
  } catch (error) {
    console.error('Update table status error:', error);
    res.status(500).json({ error: 'Failed to update table status' });
  }
});

// Delete table (soft delete). Only allowed when not occupied.
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const table = await db.get(`SELECT * FROM tables WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    if (table.status === 'occupied') {
      return res.status(400).json({ error: 'Cannot delete an occupied table. Close its order first.' });
    }

    await db.run(
      `UPDATE tables SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.params.id]
    );

    socketService.emit('tables-changed');

    res.json({ success: true, message: 'Table deleted successfully' });
  } catch (error) {
    console.error('Delete table error:', error);
    res.status(500).json({ error: 'Failed to delete table' });
  }
});

module.exports = router;
