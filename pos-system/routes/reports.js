const express = require('express');
const router = express.Router();
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

// Daily Sales Report
router.get('/sales/daily', authMiddleware, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const sales = await db.get(
      `SELECT 
        COUNT(*) as totalTransactions,
        SUM(total_amount) as totalSales,
        SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END) as cashSales,
        SUM(CASE WHEN payment_method = 'card' THEN total_amount ELSE 0 END) as cardSales,
        SUM(CASE WHEN payment_method = 'upi' THEN total_amount ELSE 0 END) as upiSales,
        SUM(CASE WHEN payment_method = 'wallet' THEN total_amount ELSE 0 END) as walletSales,
        AVG(total_amount) as averageTransaction
       FROM bills 
       WHERE DATE(created_at) = ? AND status != 'voided'`,
      [targetDate]
    );

    const topProducts = await db.all(
      `SELECT p.name, SUM(bi.quantity) as quantitySold, SUM(bi.total_amount) as revenue
       FROM bill_items bi
       JOIN bills b ON bi.bill_id = b.id
       JOIN products p ON bi.product_id = p.id
       WHERE DATE(b.created_at) = ? AND b.status != 'voided'
       GROUP BY bi.product_id
       ORDER BY quantitySold DESC
       LIMIT 10`,
      [targetDate]
    );

    res.json({
      success: true,
      report: {
        date: targetDate,
        summary: sales,
        topProducts
      }
    });
  } catch (error) {
    console.error('Daily sales report error:', error);
    res.status(500).json({ error: 'Failed to generate daily sales report' });
  }
});

// Weekly Sales Report
router.get('/sales/weekly', authMiddleware, async (req, res) => {
  try {
    const weeklyData = await db.all(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as transactions,
        SUM(total_amount) as totalSales
       FROM bills 
       WHERE DATE(created_at) >= DATE('now', '-7 days') AND status != 'voided'
       GROUP BY DATE(created_at)
       ORDER BY date`
    );

    res.json({ success: true, report: { period: 'weekly', data: weeklyData } });
  } catch (error) {
    console.error('Weekly sales report error:', error);
    res.status(500).json({ error: 'Failed to generate weekly sales report' });
  }
});

// Monthly Sales Report
router.get('/sales/monthly', authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentMonth = month || (new Date().getMonth() + 1).toString().padStart(2, '0');
    const currentYear = year || new Date().getFullYear().toString();

    const monthlyData = await db.all(
      `SELECT 
        strftime('%Y-%m-%d', created_at) as date,
        COUNT(*) as transactions,
        SUM(total_amount) as totalSales
       FROM bills 
       WHERE strftime('%Y-%m', created_at) = ? AND status != 'voided'
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [`${currentYear}-${currentMonth}`]
    );

    const monthSummary = await db.get(
      `SELECT 
        COUNT(*) as totalTransactions,
        SUM(total_amount) as totalSales,
        SUM(subtotal) as totalSubtotal,
        SUM(discount_amount) as totalDiscounts,
        SUM(tax_amount) as totalTax
       FROM bills 
       WHERE strftime('%Y-%m', created_at) = ? AND status != 'voided'`,
      [`${currentYear}-${currentMonth}`]
    );

    res.json({
      success: true,
      report: {
        period: 'monthly',
        month: `${currentYear}-${currentMonth}`,
        summary: monthSummary,
        dailyBreakdown: monthlyData
      }
    });
  } catch (error) {
    console.error('Monthly sales report error:', error);
    res.status(500).json({ error: 'Failed to generate monthly sales report' });
  }
});

// Profit Report
router.get('/profit', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = '';
    const params = [];
    
    if (startDate && endDate) {
      dateFilter = `AND DATE(created_at) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    const profitData = await db.get(
      `SELECT 
        SUM(total_amount) as revenue,
        (SELECT SUM(bi.quantity * p.cost_price) 
         FROM bill_items bi 
         JOIN bills b ON bi.bill_id = b.id 
         JOIN products p ON bi.product_id = p.id 
         WHERE b.status != 'voided' ${dateFilter}) as costOfGoodsSold
       FROM bills 
       WHERE status != 'voided' ${dateFilter}`,
      [...params, ...params]
    );

    const profit = profitData.revenue - (profitData.costOfGoodsSold || 0);
    const profitMargin = profitData.revenue > 0 ? (profit / profitData.revenue) * 100 : 0;

    res.json({
      success: true,
      report: {
        revenue: profitData.revenue,
        costOfGoodsSold: profitData.costOfGoodsSold || 0,
        profit,
        profitMargin: profitMargin.toFixed(2)
      }
    });
  } catch (error) {
    console.error('Profit report error:', error);
    res.status(500).json({ error: 'Failed to generate profit report' });
  }
});

// Tax Report (GST)
router.get('/tax', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = '';
    const params = [];
    
    if (startDate && endDate) {
      dateFilter = `AND DATE(b.created_at) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    const taxData = await db.all(
      `SELECT 
        bi.tax_rate as taxRate,
        SUM(bi.tax_amount) as totalTax,
        SUM(bi.total_amount) as taxableAmount
       FROM bill_items bi
       JOIN bills b ON bi.bill_id = b.id
       WHERE b.status != 'voided' ${dateFilter}
       GROUP BY bi.tax_rate`,
      [...params, ...params]
    );

    const totalTax = taxData.reduce((sum, item) => sum + item.totalTax, 0);

    res.json({
      success: true,
      report: {
        period: { startDate, endDate },
        taxBreakdown: taxData,
        totalTaxCollected: totalTax
      }
    });
  } catch (error) {
    console.error('Tax report error:', error);
    res.status(500).json({ error: 'Failed to generate tax report' });
  }
});

// Inventory Report
router.get('/inventory', authMiddleware, async (req, res) => {
  try {
    const lowStock = await db.all(
      `SELECT * FROM products 
       WHERE stock_quantity <= reorder_level AND is_deleted = 0 AND is_active = 1
       ORDER BY stock_quantity ASC`
    );

    const outOfStock = await db.all(
      `SELECT * FROM products 
       WHERE stock_quantity = 0 AND is_deleted = 0 AND is_active = 1`
    );

    const totalValue = await db.get(
      `SELECT SUM(stock_quantity * cost_price) as value FROM products 
       WHERE is_deleted = 0 AND is_active = 1`
    );

    res.json({
      success: true,
      report: {
        lowStockItems: lowStock,
        outOfStockItems: outOfStock,
        totalInventoryValue: totalValue.value || 0
      }
    });
  } catch (error) {
    console.error('Inventory report error:', error);
    res.status(500).json({ error: 'Failed to generate inventory report' });
  }
});

module.exports = router;
