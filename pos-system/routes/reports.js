const express = require('express');
const router = express.Router();
const db = require('../database/database');
const authMiddleware = require('../middleware/auth');

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

// Orders Report: sales by table/zone, average order value and kitchen prep time
router.get('/orders', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    let dateOnFilter = '';
    const params = [];
    if (startDate && endDate) {
      dateFilter = 'AND DATE(created_at) BETWEEN ? AND ?';
      dateOnFilter = 'AND DATE(o.created_at) BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    const summary = await db.get(
      `SELECT
        COUNT(*) as totalOrders,
        COALESCE(SUM(total_amount), 0) as totalRevenue,
        COALESCE(AVG(total_amount), 0) as averageOrderValue
       FROM orders
       WHERE is_deleted = 0 AND status = 'closed' ${dateFilter}`,
      params
    );

    const byTable = await db.all(
      `SELECT
        COALESCE(table_number, 'Walk-in') as tableNumber,
        COUNT(*) as orderCount,
        SUM(total_amount) as revenue
       FROM orders
       WHERE is_deleted = 0 AND status = 'closed' ${dateFilter}
       GROUP BY table_number
       ORDER BY revenue DESC`,
      params
    );

    const byZone = await db.all(
      `SELECT
        t.zone,
        COUNT(o.id) as orderCount,
        COALESCE(SUM(o.total_amount), 0) as revenue
       FROM tables t
       LEFT JOIN orders o
         ON o.table_id = t.id AND o.status = 'closed' AND o.is_deleted = 0 ${dateOnFilter}
       GROUP BY t.zone
       ORDER BY revenue DESC`,
      params
    );

    const prepTime = await db.get(
      `SELECT
        COUNT(*) as completedTickets,
        COALESCE(AVG((julianday(prepared_at) - julianday(created_at)) * 24 * 60), 0) as avgMinutes
       FROM kitchen_orders
       WHERE status = 'completed' AND prepared_at IS NOT NULL`
    );

    const kitchenVolume = await db.all(
      `SELECT
        station,
        COUNT(*) as ticketCount,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
       FROM kitchen_orders
       GROUP BY station
       ORDER BY ticketCount DESC`
    );

    res.json({
      success: true,
      report: {
        period: { startDate, endDate },
        summary,
        byTable,
        byZone,
        prepTime,
        kitchenVolume
      }
    });
  } catch (error) {
    console.error('Orders report error:', error);
    res.status(500).json({ error: 'Failed to generate orders report' });
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
