const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');

// Process payment
router.post('/process', authMiddleware, async (req, res) => {
  try {
    const { billId, amount, paymentMethod, transactionId, referenceNumber, notes } = req.body;

    const paymentId = uuidv4();
    
    await db.run(
      `INSERT INTO payments (id, bill_id, amount, payment_method, transaction_id, reference_number, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [paymentId, billId, amount, paymentMethod, transactionId, referenceNumber, notes]
    );

    // Update bill status
    await db.run(
      `UPDATE bills SET payment_status = 'paid', paid_amount = COALESCE(paid_amount, 0) + ? WHERE id = ?`,
      [amount, billId]
    );

    res.json({ success: true, paymentId, message: 'Payment processed successfully' });
  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// Get payments for a bill
router.get('/bill/:billId', authMiddleware, async (req, res) => {
  try {
    const payments = await db.all(
      `SELECT * FROM payments WHERE bill_id = ? ORDER BY created_at`,
      [req.params.billId]
    );

    res.json({ success: true, payments });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

// Split bill payment
router.post('/split', authMiddleware, async (req, res) => {
  try {
    const { billId, splits } = req.body;
    // splits: [{ amount: 100, paymentMethod: 'cash' }, { amount: 200, paymentMethod: 'card' }]

    const bill = await db.get(`SELECT * FROM bills WHERE id = ?`, [billId]);
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const totalSplitAmount = splits.reduce((sum, split) => sum + split.amount, 0);
    if (totalSplitAmount !== bill.total_amount) {
      return res.status(400).json({ 
        error: 'Split amounts must equal bill total',
        expected: bill.total_amount,
        got: totalSplitAmount
      });
    }

    for (const split of splits) {
      const paymentId = uuidv4();
      await db.run(
        `INSERT INTO payments (id, bill_id, amount, payment_method)
         VALUES (?, ?, ?, ?)`,
        [paymentId, billId, split.amount, split.paymentMethod]
      );
    }

    await db.run(
      `UPDATE bills SET payment_status = 'paid', paid_amount = ?, split_info = ? WHERE id = ?`,
      [totalSplitAmount, JSON.stringify(splits), billId]
    );

    res.json({ success: true, message: 'Split payment processed successfully' });
  } catch (error) {
    console.error('Split payment error:', error);
    res.status(500).json({ error: 'Failed to process split payment' });
  }
});

module.exports = router;
