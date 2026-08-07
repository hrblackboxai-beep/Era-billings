const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');
const { jwt: jwtConfig } = require('../config/config');

async function logLogin(username, success, req) {
  try {
    await db.run(
      `INSERT INTO login_logs (id, username, success, ip, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), username, success ? 1 : 0, req.ip || null, req.headers['user-agent'] || null]
    );
  } catch (err) {
    console.error('Login log error:', err.message);
  }
}

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const employee = await db.get(
      `SELECT * FROM employees WHERE username = ? AND is_deleted = 0`,
      [username]
    );

    if (!employee) {
      await logLogin(username, false, req);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = bcrypt.compareSync(password, employee.password);
    if (!validPassword) {
      await logLogin(username, false, req);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: employee.id, 
        username: employee.username, 
        role: employee.role 
      },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );

    await logLogin(username, true, req);

    res.json({
      success: true,
      token,
      user: {
        id: employee.id,
        username: employee.username,
        name: employee.name,
        role: employee.role,
        email: employee.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Recent login attempts (admin only)
router.get('/login-logs', authMiddleware, authMiddleware.requireRole('admin'), async (req, res) => {
  try {
    const logs = await db.all(
      `SELECT username, success, ip, created_at FROM login_logs ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Login logs error:', error);
    res.status(500).json({ error: 'Failed to get login logs' });
  }
});

// Register new employee (admin only)
router.post('/register', authMiddleware, authMiddleware.requireRole('admin'), async (req, res) => {
  try {
    const { username, password, name, email, phone, role, salary } = req.body;

    // Check if username exists
    const existing = await db.get(
      `SELECT id FROM employees WHERE username = ?`,
      [username]
    );

    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const id = uuidv4();

    await db.run(
      `INSERT INTO employees (id, username, password, name, email, phone, role, salary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, username, hashedPassword, name, email, phone, role || 'cashier', salary || 0]
    );

    res.json({ success: true, message: 'Employee registered successfully' });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get current user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const employee = await db.get(
      `SELECT id, username, name, email, phone, role, salary, created_at 
       FROM employees WHERE id = ?`,
      [req.user.id]
    );

    if (!employee) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, user: employee });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

module.exports = router;
