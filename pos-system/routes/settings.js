const express = require('express');
const router = express.Router();
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');

// Get all settings
router.get('/', authMiddleware, async (req, res) => {
  try {
    const rows = await db.all(`SELECT key, value FROM settings`);
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// Update settings (bulk upsert)
router.put('/', authMiddleware, async (req, res) => {
  try {
    const updates = req.body;

    if (typeof updates !== 'object' || updates === null) {
      return res.status(400).json({ error: 'Invalid settings payload' });
    }

    const allowedKeys = [
      'company_name',
      'gst_number',
      'gst_rate',
      'currency',
      'invoice_prefix',
      'low_stock_threshold',
      'loyalty_points_per_100'
    ];

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedKeys.includes(key)) continue;
      if (typeof value !== 'string' && typeof value !== 'number') continue;

      await db.run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [key, String(value)]
      );
    }

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

module.exports = router;
