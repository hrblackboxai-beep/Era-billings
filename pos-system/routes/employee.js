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

// Get all employees
router.get('/', authMiddleware, async (req, res) => {
  try {
    const employees = await db.all(
      `SELECT id, username, name, email, phone, role, salary, attendance_status, created_at 
       FROM employees WHERE is_deleted = 0 ORDER BY name`
    );
    res.json({ success: true, employees });
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ error: 'Failed to get employees' });
  }
});

// Mark attendance
router.post('/attendance', authMiddleware, async (req, res) => {
  try {
    const { employeeId, type } = req.body; // type: 'check-in' or 'check-out'
    
    const today = new Date().toISOString().split('T')[0];
    const existing = await db.get(
      `SELECT * FROM attendance WHERE employee_id = ? AND date = ?`,
      [employeeId, today]
    );

    const id = uuidv4();
    
    if (existing) {
      if (type === 'check-in') {
        return res.status(400).json({ error: 'Already checked in today' });
      }
      
      await db.run(
        `UPDATE attendance SET check_out = CURRENT_TIMESTAMP WHERE id = ?`,
        [existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO attendance (id, employee_id, date, check_in, status)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'present')`,
        [id, employeeId, today]
      );
    }

    res.json({ success: true, message: `Attendance marked: ${type}` });
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// Get attendance records
router.get('/attendance', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, employeeId } = req.query;
    
    let query = `SELECT a.*, e.name as employee_name 
                 FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE 1=1`;
    const params = [];

    if (startDate) {
      query += ` AND DATE(a.date) >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND DATE(a.date) <= ?`;
      params.push(endDate);
    }

    if (employeeId) {
      query += ` AND a.employee_id = ?`;
      params.push(employeeId);
    }

    query += ` ORDER BY a.date DESC, a.check_in DESC`;

    const records = await db.all(query, params);
    res.json({ success: true, records });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ error: 'Failed to get attendance' });
  }
});

// Update employee salary
router.put('/:id/salary', authMiddleware, async (req, res) => {
  try {
    const { salary } = req.body;

    await db.run(
      `UPDATE employees SET salary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [salary, req.params.id]
    );

    res.json({ success: true, message: 'Salary updated successfully' });
  } catch (error) {
    console.error('Update salary error:', error);
    res.status(500).json({ error: 'Failed to update salary' });
  }
});

// Get employee performance stats
router.get('/:id/performance', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const employee = await db.get(`SELECT * FROM employees WHERE id = ?`, [req.params.id]);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    let dateFilter = '';
    const params = [];
    
    if (startDate && endDate) {
      dateFilter = `AND DATE(created_at) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    const billsHandled = await db.get(
      `SELECT COUNT(*) as count, SUM(total_amount) as total 
       FROM bills WHERE employee_id = ? ${dateFilter}`,
      [req.params.id, ...params]
    );

    const attendanceStats = await db.get(
      `SELECT COUNT(*) as total_days, 
              SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present_days
       FROM attendance WHERE employee_id = ?`,
      [req.params.id]
    );

    res.json({
      success: true,
      performance: {
        employee,
        billsHandled: billsHandled.count || 0,
        totalSales: billsHandled.total || 0,
        attendanceRate: attendanceStats.present_days / (attendanceStats.total_days || 1) * 100
      }
    });
  } catch (error) {
    console.error('Get performance error:', error);
    res.status(500).json({ error: 'Failed to get performance' });
  }
});

module.exports = router;
