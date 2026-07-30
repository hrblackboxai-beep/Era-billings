const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

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
    )`
  ];

  tables.forEach(tableSQL => {
    try {
      db.run(tableSQL);
    } catch (err) {
      console.error('Error creating table:', err.message);
    }
  });

  console.log('All tables created successfully');
  insertDefaultData();
  saveDatabase();
  
  return db;
}

// Insert default data
function insertDefaultData() {
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');
  
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
  
  saveDatabase();
}

// Save database to disk
function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Helper function to run queries
function run(query, params = []) {
  try {
    db.run(query, params);
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
    stmt.bind(params);
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
    stmt.bind(params);
    
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
