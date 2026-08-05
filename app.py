from flask import Flask, render_template, request, jsonify, send_from_directory
import sqlite3
import os
import json
from datetime import datetime, timedelta
import random

app = Flask(__name__)
DB_NAME = "pos_system.db"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    
    # Products
    c.execute('''CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        barcode TEXT UNIQUE,
        price REAL NOT NULL,
        cost REAL NOT NULL,
        stock INTEGER DEFAULT 0,
        category TEXT,
        gst_rate REAL DEFAULT 18.0,
        min_stock_level INTEGER DEFAULT 10
    )''')
    
    # Customers
    c.execute('''CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT UNIQUE,
        email TEXT,
        loyalty_points INTEGER DEFAULT 0,
        membership_type TEXT DEFAULT 'Regular',
        dob DATE,
        total_spent REAL DEFAULT 0.0
    )''')
    
    # Employees
    c.execute('''CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT,
        salary REAL,
        joined_date DATE,
        is_active INTEGER DEFAULT 1
    )''')
    
    # Bills
    c.execute('''CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_number TEXT UNIQUE,
        customer_id INTEGER,
        total_amount REAL,
        tax_amount REAL,
        discount REAL,
        net_amount REAL,
        payment_method TEXT,
        status TEXT DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sync_status TEXT DEFAULT 'pending',
        items_json TEXT
    )''')
    
    # Kitchen Orders
    c.execute('''CREATE TABLE IF NOT EXISTS kitchen_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id INTEGER,
        item_name TEXT,
        quantity INTEGER,
        status TEXT DEFAULT 'pending',
        station TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    
    # Inventory Logs
    c.execute('''CREATE TABLE IF NOT EXISTS inventory_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        type TEXT,
        quantity INTEGER,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    
    # Seed Data if empty
    c.execute("SELECT count(*) FROM products")
    if c.fetchone()[0] == 0:
        products = [
            ('Burger', '1001', 150.0, 80.0, 50, 'Food', 5.0, 20),
            ('Pizza', '1002', 300.0, 150.0, 30, 'Food', 18.0, 10),
            ('Coke', '1003', 40.0, 20.0, 100, 'Beverage', 18.0, 50),
            ('Fries', '1004', 80.0, 40.0, 60, 'Food', 5.0, 25),
            ('Ice Cream', '1005', 60.0, 30.0, 40, 'Dessert', 18.0, 20)
        ]
        c.executemany("INSERT INTO products (name, barcode, price, cost, stock, category, gst_rate, min_stock_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", products)
        
        c.execute("INSERT INTO customers (name, phone, loyalty_points, membership_type) VALUES (?, ?, ?, ?)", 
                  ('John Doe', '9876543210', 150, 'Gold'))
        
        c.execute("INSERT INTO employees (name, role, salary, joined_date) VALUES (?, ?, ?, ?)", 
                  ('Alice Manager', 'Manager', 45000.0, '2023-01-01'))

    conn.commit()
    conn.close()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/products', methods=['GET'])
def get_products():
    conn = get_db()
    products = conn.execute("SELECT * FROM products").fetchall()
    conn.close()
    return jsonify([dict(p) for p in products])

@app.route('/api/bill', methods=['POST'])
def create_bill():
    data = request.json
    conn = get_db()
    c = conn.cursor()
    
    bill_num = f"BILL-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    total = data.get('total', 0)
    tax = data.get('tax', 0)
    discount = data.get('discount', 0)
    net = total - discount
    items = json.dumps(data.get('items', []))
    
    c.execute("INSERT INTO bills (bill_number, total_amount, tax_amount, discount, net_amount, payment_method, items_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
              (bill_num, total, tax, discount, net, data.get('payment_method', 'Cash'), items))
    
    # Update stock
    for item in data.get('items', []):
        c.execute("UPDATE products SET stock = stock - ? WHERE id = ?", (item['qty'], item['id']))
    
    # Create Kitchen Orders if applicable
    for item in data.get('items', []):
        if item.get('category') in ['Food', 'Beverage']:
            c.execute("INSERT INTO kitchen_orders (bill_id, item_name, quantity, station) VALUES ((SELECT last_insert_rowid()), ?, ?, 'Kitchen')", 
                      (item['name'], item['qty']))
    
    conn.commit()
    bill_id = c.lastrowid
    conn.close()
    return jsonify({"success": True, "bill_id": bill_id, "bill_number": bill_num})

@app.route('/api/dashboard', methods=['GET'])
def get_dashboard():
    conn = get_db()
    today = datetime.now().strftime('%Y-%m-%d')
    
    sales_today = conn.execute("SELECT SUM(net_amount) FROM bills WHERE date(created_at) = ?", (today,)).fetchone()[0] or 0
    orders_today = conn.execute("SELECT COUNT(*) FROM bills WHERE date(created_at) = ?", (today,)).fetchone()[0] or 0
    low_stock = conn.execute("SELECT COUNT(*) FROM products WHERE stock <= min_stock_level").fetchone()[0] or 0
    pending_kot = conn.execute("SELECT COUNT(*) FROM kitchen_orders WHERE status = 'pending'").fetchone()[0] or 0
    
    # Chart Data (Last 7 days)
    dates = [(datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(6, -1, -1)]
    chart_data = []
    for d in dates:
        val = conn.execute("SELECT SUM(net_amount) FROM bills WHERE date(created_at) = ?", (d,)).fetchone()[0] or 0
        chart_data.append(val)
    
    conn.close()
    return jsonify({
        "sales_today": sales_today,
        "orders_today": orders_today,
        "low_stock": low_stock,
        "pending_kot": pending_kot,
        "chart_labels": dates,
        "chart_data": chart_data
    })

@app.route('/api/kitchen', methods=['GET'])
def get_kitchen_orders():
    conn = get_db()
    orders = conn.execute("SELECT * FROM kitchen_orders WHERE status != 'completed' ORDER BY created_at").fetchall()
    conn.close()
    return jsonify([dict(o) for o in orders])

@app.route('/api/kitchen/<int:id>', methods=['PUT'])
def update_kitchen_order(id):
    conn = get_db()
    conn.execute("UPDATE kitchen_orders SET status = ? WHERE id = ?", (request.json.get('status'), id))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

if __name__ == '__main__':
    if not os.path.exists(DB_NAME):
        init_db()
    else:
        # Check if tables exist, if not init
        conn = get_db()
        try:
            conn.execute("SELECT 1 FROM products LIMIT 1")
        except:
            init_db()
        conn.close()
    
    app.run(debug=True, port=5000)
