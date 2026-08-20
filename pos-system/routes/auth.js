const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validation');
const config = require('../config');

// Login endpoint
router.post('/login',
  [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  validate,
  async (req, res) => {
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
      config.jwtSecret,
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
router.post('/register', 
  authMiddleware,
  [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('name').notEmpty().withMessage('Name is required'),
    body('role').optional(),
    body('email').optional().isEmail().withMessage('Valid email is required'),
    body('phone').optional()
  ],
  validate,
  async (req, res) => {
    try {
      const { username, password, name, email, phone, role, salary } = req.body;
      
      // Verify admin token - already done by authMiddleware
      if (req.user.role !== 'admin') {
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
