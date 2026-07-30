const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/database');

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
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = bcrypt.compareSync(password, employee.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: employee.id, 
        username: employee.username, 
        role: employee.role 
      },
      process.env.JWT_SECRET || 'pos-secret-key-offline',
      { expiresIn: '8h' }
    );

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

// Register new employee (admin only)
router.post('/register', async (req, res) => {
  try {
    const { username, password, name, email, phone, role, salary } = req.body;
    
    // Verify admin token
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'pos-secret-key-offline');
    const admin = await db.get(`SELECT * FROM employees WHERE id = ?`, [decoded.id]);
    
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

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
router.get('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'pos-secret-key-offline');
    const employee = await db.get(
      `SELECT id, username, name, email, phone, role, salary, created_at 
       FROM employees WHERE id = ?`,
      [decoded.id]
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
