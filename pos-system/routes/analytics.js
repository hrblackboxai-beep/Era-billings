const express = require('express');
const router = express.Router();
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');
const { body, query } = require('express-validator');
const validate = require('../middleware/validation');

// Get dashboard analytics
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Today's sales
    const todaySales = await db.get(
      `SELECT SUM(total_amount) as total, COUNT(*) as count 
       FROM bills 
       WHERE DATE(created_at) = ? AND status != 'voided'`,
      [today]
    );
    
    // This month's sales
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const monthSales = await db.get(
      `SELECT SUM(total_amount) as total, COUNT(*) as count 
       FROM bills 
       WHERE DATE(created_at) >= ? AND status != 'voided'`,
      [monthStart]
    );
    
    // Low stock products
    const lowStock = await db.all(
      `SELECT id, name, stock_quantity, reorder_level 
       FROM products 
       WHERE stock_quantity <= reorder_level AND is_active = 1`
    );
    
    // Recent bills
    const recentBills = await db.all(
      `SELECT * FROM bills 
       WHERE status != 'voided' 
       ORDER BY created_at DESC 
       LIMIT 10`
    );
    
    // Top products
    const topProducts = await db.all(
      `SELECT product_id, product_name, SUM(quantity) as total_sold, SUM(total_amount) as revenue
       FROM bill_items
       GROUP BY product_id
       ORDER BY total_sold DESC
       LIMIT 10`
    );
    
    // Customer count
    const customerCount = await db.get(`SELECT COUNT(*) as count FROM customers WHERE is_deleted = 0`);
    
    // Daily sales for last 7 days
    const dailySales = await db.all(
      `SELECT DATE(created_at) as date, SUM(total_amount) as total, COUNT(*) as count
       FROM bills
       WHERE DATE(created_at) >= DATE('now', '-7 days') AND status != 'voided'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`
    );
    
    res.json({
      success: true,
      data: {
        today: {
          sales: todaySales?.total || 0,
          transactions: todaySales?.count || 0
        },
        month: {
          sales: monthSales?.total || 0,
          transactions: monthSales?.count || 0
        },
        lowStock,
        recentBills,
        topProducts,
        totalCustomers: customerCount?.count || 0,
        dailySales
      }
    });
  } catch (error) {
    console.error('Dashboard analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard analytics' });
  }
});

// Sales report with filters
router.get('/sales', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, interval = 'daily' } = req.query;
    
    let dateFilter = '';
    const params = [];
    
    if (startDate && endDate) {
      dateFilter = 'WHERE DATE(created_at) BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      dateFilter = 'WHERE DATE(created_at) >= ?';
      params.push(startDate);
    }
    
    const groupBy = interval === 'monthly' ? 'strftime(\'%Y-%m\', created_at)' : 'DATE(created_at)';
    
    const salesData = await db.all(
      `SELECT ${groupBy} as period, 
              SUM(total_amount) as total_sales, 
              COUNT(*) as transaction_count,
              AVG(total_amount) as avg_transaction
       FROM bills
       ${dateFilter} AND status != 'voided'
       GROUP BY ${groupBy}
       ORDER BY period DESC`,
      params
    );
    
    res.json({
      success: true,
      data: salesData
    });
  } catch (error) {
    console.error('Sales report error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sales report' });
  }
});

// Inventory analytics
router.get('/inventory', authMiddleware, async (req, res) => {
  try {
    // Stock value
    const stockValue = await db.get(
      `SELECT SUM(stock_quantity * cost_price) as total_value FROM products WHERE is_active = 1`
    );
    
    // Category distribution
    const categoryDistribution = await db.all(
      `SELECT category, COUNT(*) as count, SUM(stock_quantity) as total_stock
       FROM products
       WHERE is_active = 1
       GROUP BY category`
    );
    
    // Fast moving items
    const fastMoving = await db.all(
      `SELECT p.id, p.name, SUM(bi.quantity) as sold_count
       FROM products p
       JOIN bill_items bi ON p.id = bi.product_id
       WHERE p.is_active = 1
       GROUP BY p.id
       ORDER BY sold_count DESC
       LIMIT 10`
    );
    
    // Slow moving items (no sales in last 30 days)
    const slowMoving = await db.all(
      `SELECT p.* FROM products p
       WHERE p.is_active = 1
       AND p.id NOT IN (
         SELECT DISTINCT bi.product_id 
         FROM bill_items bi
         JOIN bills b ON bi.bill_id = b.id
         WHERE DATE(b.created_at) >= DATE('now', '-30 days')
       )
       LIMIT 10`
    );
    
    res.json({
      success: true,
      data: {
        stockValue: stockValue?.total_value || 0,
        categoryDistribution,
        fastMoving,
        slowMoving
      }
    });
  } catch (error) {
    console.error('Inventory analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch inventory analytics' });
  }
});

// Customer analytics
router.get('/customers', authMiddleware, async (req, res) => {
  try {
    // Top customers by spending
    const topCustomers = await db.all(
      `SELECT c.*, SUM(b.total_amount) as total_spent, COUNT(b.id) as visit_count
       FROM customers c
       JOIN bills b ON c.id = b.customer_id
       WHERE b.status != 'voided'
       GROUP BY c.id
       ORDER BY total_spent DESC
       LIMIT 20`
    );
    
    // New customers this month
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const newCustomers = await db.all(
      `SELECT * FROM customers 
       WHERE DATE(created_at) >= ?
       ORDER BY created_at DESC`,
      [monthStart]
    );
    
    // Customer retention (customers with multiple visits)
    const retainedCustomers = await db.get(
      `SELECT COUNT(DISTINCT customer_id) as count
       FROM bills
       WHERE customer_id IS NOT NULL
       GROUP BY customer_id
       HAVING COUNT(*) > 1`
    );
    
    res.json({
      success: true,
      data: {
        topCustomers,
        newCustomers,
        retainedCount: retainedCustomers?.length || 0
      }
    });
  } catch (error) {
    console.error('Customer analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch customer analytics' });
  }
});

// Product performance
router.get('/products', authMiddleware, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const productPerformance = await db.all(
      `SELECT p.*, 
              COALESCE(SUM(bi.quantity), 0) as total_sold,
              COALESCE(SUM(bi.total_amount), 0) as total_revenue,
              COALESCE(AVG(bi.price), 0) as avg_selling_price
       FROM products p
       LEFT JOIN bill_items bi ON p.id = bi.product_id
       LEFT JOIN bills b ON bi.bill_id = b.id AND b.status != 'voided'
       WHERE p.is_active = 1
       GROUP BY p.id
       ORDER BY total_revenue DESC
       LIMIT ?`,
      [parseInt(limit)]
    );
    
    res.json({
      success: true,
      data: productPerformance
    });
  } catch (error) {
    console.error('Product performance error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch product performance' });
  }
});

module.exports = router;
