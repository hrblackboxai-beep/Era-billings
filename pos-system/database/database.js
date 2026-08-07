const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Initialize SQL.js (SQLite compiled to WebAssembly - works offline)
let db = null;
const DB_PATH = path.join(__dirname, 'pos.db');

async function initializeDatabase() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  try {
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
      console.log('Database loaded from disk');
    } else {
      db = new SQL.Database();
      console.log('Creating new database');
    }
  } catch (err) {
    console.error('Error loading database:', err);
    db = new SQL.Database();
  }

  // Create all tables
  const tables = [
    // Users/Employees table
    `CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      salary DECIMAL(10,2),
      attendance_status TEXT DEFAULT 'absent',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0,
      sync_status TEXT DEFAULT 'synced',
      last_synced_at TIMESTAMP
    )`,

    // Products/Inventory table
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      barcode TEXT UNIQUE,
      price DECIMAL(10,2) NOT NULL,
      cost_price DECIMAL(10,2),
      tax_rate DECIMAL(5,2) DEFAULT 18,
      stock_quantity INTEGER DEFAULT 0,
      reorder_level INTEGER DEFAULT 10,
      unit TEXT DEFAULT 'pcs',
      supplier_id TEXT,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0,
      sync_status TEXT DEFAULT 'synced',
      last_synced_at TIMESTAMP
    )`,

    // Categories table
    `CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      parent_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Customers table
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT UNIQUE,
      address TEXT,
      loyalty_points INTEGER DEFAULT 0,
      membership_type TEXT DEFAULT 'regular',
      total_purchases DECIMAL(10,2) DEFAULT 0,
      birthday DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0,
      sync_status TEXT DEFAULT 'synced',
      last_synced_at TIMESTAMP
    )`,

    // Suppliers table
    `CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_person TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      gst_number TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Bills/Invoices table
    `CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      bill_number TEXT UNIQUE NOT NULL,
      customer_id TEXT,
      employee_id TEXT,
      subtotal DECIMAL(10,2),
      discount_amount DECIMAL(10,2) DEFAULT 0,
      discount_percentage DECIMAL(5,2) DEFAULT 0,
      tax_amount DECIMAL(10,2),
      total_amount DECIMAL(10,2) NOT NULL,
      paid_amount DECIMAL(10,2),
      change_amount DECIMAL(10,2),
      payment_method TEXT,
      payment_status TEXT DEFAULT 'paid',
      status TEXT DEFAULT 'completed',
      notes TEXT,
      split_info TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      device_id TEXT,
      is_deleted INTEGER DEFAULT 0,
      sync_status TEXT DEFAULT 'pending',
      last_synced_at TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`,

    // Bill items table
    `CREATE TABLE IF NOT EXISTS bill_items (
      id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      discount DECIMAL(10,2) DEFAULT 0,
      tax_rate DECIMAL(5,2) DEFAULT 18,
      tax_amount DECIMAL(10,2),
      total_amount DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bill_id) REFERENCES bills(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`,

    // Payments table
    `CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT DEFAULT 'completed',
      transaction_id TEXT,
      reference_number TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bill_id) REFERENCES bills(id)
    )`,

    // Kitchen Order Tickets table
    `CREATE TABLE IF NOT EXISTS kitchen_orders (
      id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL,
      order_id TEXT,
      table_number TEXT,
      notes TEXT,
      order_number TEXT NOT NULL,
      station TEXT DEFAULT 'main',
      items TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'normal',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      prepared_at TIMESTAMP,
      FOREIGN KEY (bill_id) REFERENCES bills(id)
    )`,

    // Restaurant tables table
    `CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      table_number TEXT NOT NULL,
      capacity INTEGER DEFAULT 2,
      zone TEXT DEFAULT 'main',
      status TEXT DEFAULT 'available',
      is_deleted INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Table orders table (active restaurant orders, pre-checkout)
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL,
      table_id TEXT,
      table_number TEXT,
      customer_id TEXT,
      customer_name TEXT,
      items TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      kitchen_status TEXT DEFAULT 'none',
      notes TEXT,
      total_amount DECIMAL(10,2) DEFAULT 0,
      created_by TEXT,
      bill_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0
    )`,

    // Purchase orders table
    `CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      supplier_id TEXT NOT NULL,
      total_amount DECIMAL(10,2),
      status TEXT DEFAULT 'pending',
      expected_date DATE,
      received_date DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    )`,

    // Waste tracking table
    `CREATE TABLE IF NOT EXISTS waste_records (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      reason TEXT,
      recorded_by TEXT,
      cost DECIMAL(10,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (recorded_by) REFERENCES employees(id)
    )`,

    // Attendance table
    `CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      date DATE NOT NULL,
      check_in TIMESTAMP,
      check_out TIMESTAMP,
      status TEXT DEFAULT 'present',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`,

    // Loyalty transactions
    `CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      points INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      bill_id TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (bill_id) REFERENCES bills(id)
    )`,

    // Sync log for offline-first architecture
    `CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      old_data TEXT,
      new_data TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      synced INTEGER DEFAULT 0,
      sync_attempted_at TIMESTAMP
    )`,

    // Branches table (for multi-branch support)
    `CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      gst_number TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Settings table
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Login audit log
    `CREATE TABLE IF NOT EXISTS login_logs (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      success INTEGER NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  tables.forEach(tableSQL => {
    try {
      db.run(tableSQL);
    } catch (err) {
      console.error('Error creating table:', err.message);
    }
  });

  migrateSchema();

  console.log('All tables created successfully');
  insertDefaultData();
  saveDatabase();
  
  return db;
}

// Add missing columns to tables that already exist on disk (CREATE TABLE IF NOT EXISTS
// cannot alter existing tables). Runs idempotently on every startup.
function migrateSchema() {
  const additions = {
    kitchen_orders: [
      ['order_id', 'TEXT'],
      ['table_number', 'TEXT'],
      ['notes', 'TEXT']
    ],
    bills: [
      ['table_id', 'TEXT'],
      ['table_number', 'TEXT']
    ],
    products: [
      ['station', "TEXT DEFAULT 'main'"]
    ]
  };

  Object.entries(additions).forEach(([tableName, columns]) => {
    let existing = [];
    try {
      const info = db.exec(`PRAGMA table_info(${tableName})`)[0];
      existing = info ? info.values.map(row => row[1]) : [];
    } catch (err) {
      console.error(`Error reading schema for ${tableName}:`, err.message);
      return;
    }

    columns.forEach(([name, definition]) => {
      if (!existing.includes(name)) {
        try {
          db.run(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`);
          console.log(`Schema migration: added ${tableName}.${name}`);
        } catch (err) {
          console.error(`Error adding column ${tableName}.${name}:`, err.message);
        }
      }
    });
  });
}

// Insert default data
function insertDefaultData() {
  const bcrypt = require('bcryptjs');
  
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  const adminId = uuidv4();
  
  try {
    db.run(
      `INSERT OR IGNORE INTO employees (id, username, password, role, name, email) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [adminId, 'admin', hashedPassword, 'admin', 'System Administrator', 'admin@pos.com']
    );
    console.log('Default admin user created (username: admin, password: admin123)');
  } catch (err) {
    console.error('Error inserting admin:', err);
  }

  // Default settings
  const settings = [
    ['gst_rate', '18'],
    ['currency', 'INR'],
    ['company_name', 'My Store'],
    ['invoice_prefix', 'INV'],
    ['low_stock_threshold', '10'],
    ['loyalty_points_per_100', '10']
  ];

  settings.forEach(([key, value]) => {
    try {
      db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
    } catch (err) {
      console.error(`Error inserting setting ${key}:`, err);
    }
  });

  // Sample products so the app is usable on first run
  try {
    const count = db.exec(`SELECT COUNT(*) as count FROM products WHERE is_deleted = 0`)[0];
    const productCount = count && count.values && count.values[0] ? count.values[0][0] : 0;

    if (productCount === 0) {
      const sampleProducts = [
        ['Burger', 'Food', '1001', 150, 80, 5, 50, 10, 'pcs', 'grill'],
        ['Margherita Pizza', 'Food', '1002', 300, 150, 18, 30, 10, 'pcs', 'grill'],
        ['Coke 250ml', 'Beverage', '1003', 40, 20, 18, 100, 25, 'pcs', 'bar'],
        ['French Fries', 'Food', '1004', 80, 40, 5, 60, 15, 'pcs', 'grill'],
        ['Vanilla Ice Cream', 'Dessert', '1005', 60, 30, 18, 40, 10, 'pcs', 'dessert'],
        ['Green Salad', 'Food', '1006', 120, 60, 5, 25, 8, 'pcs', 'main']
      ];

      sampleProducts.forEach(([name, category, barcode, price, costPrice, taxRate, stock, reorder, unit, station]) => {
        try {
          db.run(
            `INSERT OR IGNORE INTO products
             (id, name, category, barcode, price, cost_price, tax_rate, stock_quantity, reorder_level, unit, station)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), name, category, barcode, price, costPrice, taxRate, stock, reorder, unit, station]
          );
        } catch (err) {
          console.error(`Error seeding product ${name}:`, err);
        }
      });

      // Sample customer
      db.run(
        `INSERT OR IGNORE INTO customers (id, name, phone, email, membership_type, loyalty_points)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), 'John Doe', '9876543210', 'john@example.com', 'gold', 150]
      );

      console.log('Sample products and customer seeded');
    }
  } catch (err) {
    console.error('Error seeding sample data:', err);
  }

  seedTables();
  seedSampleOrders();

  saveDatabase();
}

// Seed default restaurant tables so table management is usable on first run
function seedTables() {
  try {
    const count = db.exec(`SELECT COUNT(*) as count FROM tables WHERE is_deleted = 0`)[0];
    const tableCount = count && count.values && count.values[0] ? count.values[0][0] : 0;

    if (tableCount > 0) return;

    const zones = ['Main Hall', 'Main Hall', 'Terrace', 'Private'];
    for (let i = 1; i <= 12; i++) {
      const capacity = i % 3 === 0 ? 6 : (i % 2 === 0 ? 4 : 2);
      db.run(
        `INSERT OR IGNORE INTO tables (id, table_number, capacity, zone, status)
         VALUES (?, ?, ?, ?, 'available')`,
        [uuidv4(), `T${i}`, capacity, zones[Math.min(Math.floor((i - 1) / 3), 3)]]
      );
    }

    // Leave a couple of tables occupied/reserved for the demo
    const allTables = db.exec(`SELECT id FROM tables WHERE is_deleted = 0 ORDER BY table_number LIMIT 4`)[0];
    const ids = allTables ? allTables.values.map(row => row[0]) : [];
    if (ids.length >= 3) {
      db.run(`UPDATE tables SET status = 'occupied' WHERE id = ?`, [ids[0]]);
      db.run(`UPDATE tables SET status = 'occupied' WHERE id = ?`, [ids[1]]);
      db.run(`UPDATE tables SET status = 'reserved' WHERE id = ?`, [ids[2]]);
    }

    console.log('Default tables seeded');
  } catch (err) {
    console.error('Error seeding tables:', err);
  }
}

// Seed a couple of live table orders so the orders/kitchen views have data
function seedSampleOrders() {
  try {
    const count = db.exec(`SELECT COUNT(*) as count FROM orders WHERE is_deleted = 0`)[0];
    const orderCount = count && count.values && count.values[0] ? count.values[0][0] : 0;

    if (orderCount > 0) return;

    const productRows = db.exec(
      `SELECT id, name, price, tax_rate FROM products WHERE is_deleted = 0 AND is_active = 1 ORDER BY name LIMIT 5`
    )[0];
    if (!productRows || !productRows.values.length) return;

    const tableRows = db.exec(`SELECT id, table_number FROM tables WHERE status = 'occupied' ORDER BY table_number LIMIT 2`)[0];
    if (!tableRows || !tableRows.values.length) return;

    const products = productRows.values.map(row => ({
      id: row[0], name: row[1], price: row[2], taxRate: row[3] || 18
    }));

    const demoOrders = [
      { items: [0, 1, 2] },
      { items: [1, 3] }
    ];

    demoOrders.forEach((spec, idx) => {
      const table = tableRows.values[idx];
      if (!table) return;
      const orderId = uuidv4();
      const orderNumber = `ORD-${Date.now() + idx}`;

      const orderItems = spec.items.map((pi, qi) => ({
        productId: products[pi].id,
        productName: products[pi].name,
        price: products[pi].price,
        taxRate: products[pi].taxRate,
        quantity: (qi % 2) + 1,
        sendToKitchen: true
      }));

      const total = orderItems.reduce((sum, it) => sum + it.price * it.quantity, 0);

      db.run(
        `INSERT INTO orders (id, order_number, table_id, table_number, items, status, kitchen_status, total_amount)
         VALUES (?, ?, ?, ?, ?, 'sent', 'pending', ?)`,
        [orderId, orderNumber, table[0], table[1], JSON.stringify(orderItems), total]
      );

      const kotId = uuidv4();
      const kotNumber = `KOT-${Date.now() + idx}`;
      db.run(
        `INSERT INTO kitchen_orders (id, bill_id, order_id, table_number, order_number, items, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [kotId, orderId, orderId, table[1], kotNumber, JSON.stringify(orderItems)]
      );
    });

    console.log('Sample orders seeded');
  } catch (err) {
    console.error('Error seeding sample orders:', err);
  }
}

// Save database to disk
function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Coerce undefined values to null so sql.js never fails on bind
function cleanParams(params) {
  return (params || []).map(p => (p === undefined ? null : p));
}

// Helper function to run queries
function run(query, params = []) {
  try {
    db.run(query, cleanParams(params));
    saveDatabase();
    return Promise.resolve({ changes: db.getRowsModified() });
  } catch (err) {
    return Promise.reject(err);
  }
}

// Helper function to get all rows
function all(query, params = []) {
  try {
    const stmt = db.prepare(query);
    stmt.bind(cleanParams(params));
    const results = [];
    
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    
    return Promise.resolve(results);
  } catch (err) {
    return Promise.reject(err);
  }
}

// Helper function to get single row
function get(query, params = []) {
  try {
    const stmt = db.prepare(query);
    stmt.bind(cleanParams(params));
    
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    
    return Promise.resolve(result);
  } catch (err) {
    return Promise.reject(err);
  }
}

// Log changes for sync
async function logSyncChange(tableName, recordId, operation, newData, oldData = null) {
  await run(
    `INSERT INTO sync_log (table_name, record_id, operation, new_data, old_data) 
     VALUES (?, ?, ?, ?, ?)`,
    [tableName, recordId, operation, JSON.stringify(newData), oldData ? JSON.stringify(oldData) : null]
  );
}

module.exports = {
  getDb: () => db,
  initializeDatabase,
  run,
  all,
  get,
  logSyncChange,
  saveDatabase
};
