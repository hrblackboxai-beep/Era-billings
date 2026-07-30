from flask import Flask, render_template, request, jsonify, redirect, url_for, flash, session
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from datetime import datetime, timedelta
from functools import wraps
import json
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///pos.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# ==================== DATABASE MODELS ====================

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    role = db.Column(db.String(20), default='employee')  # admin, manager, employee
    email = db.Column(db.String(120))
    phone = db.Column(db.String(20))
    salary = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Customer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), unique=True)
    email = db.Column(db.String(120))
    loyalty_points = db.Column(db.Integer, default=0)
    membership_type = db.Column(db.String(20), default='regular')  # regular, silver, gold, platinum
    birthday = db.Column(db.Date)
    total_purchases = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    description = db.Column(db.Text)

class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    barcode = db.Column(db.String(50), unique=True)
    category_id = db.Column(db.Integer, db.ForeignKey('category.id'))
    price = db.Column(db.Float, nullable=False)
    cost_price = db.Column(db.Float, default=0.0)
    stock_quantity = db.Column(db.Integer, default=0)
    min_stock_level = db.Column(db.Integer, default=10)
    gst_rate = db.Column(db.Float, default=18.0)  # GST percentage
    is_active = db.Column(db.Boolean, default=True)
    category = db.relationship('Category', backref='products')

class Sale(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    invoice_number = db.Column(db.String(50), unique=True, nullable=False)
    customer_id = db.Column(db.Integer, db.ForeignKey('customer.id'), nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    subtotal = db.Column(db.Float, nullable=False)
    discount = db.Column(db.Float, default=0.0)
    tax_amount = db.Column(db.Float, default=0.0)
    total_amount = db.Column(db.Float, nullable=False)
    payment_method = db.Column(db.String(20), nullable=False)  # cash, card, upi, wallet
    payment_status = db.Column(db.String(20), default='completed')
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    customer = db.relationship('Customer', backref='sales')
    user = db.relationship('User', backref='sales')

class SaleItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sale_id = db.Column(db.Integer, db.ForeignKey('sale.id'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('product.id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    price = db.Column(db.Float, nullable=False)
    discount = db.Column(db.Float, default=0.0)
    tax_amount = db.Column(db.Float, default=0.0)
    total_amount = db.Column(db.Float, nullable=False)
    sale = db.relationship('Sale', backref='items')
    product = db.relationship('Product', backref='sale_items')

class Purchase(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    invoice_number = db.Column(db.String(50), unique=True)
    supplier_name = db.Column(db.String(100))
    total_amount = db.Column(db.Float, nullable=False)
    payment_status = db.Column(db.String(20), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class PurchaseItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    purchase_id = db.Column(db.Integer, db.ForeignKey('purchase.id'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('product.id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    cost_price = db.Column(db.Float, nullable=False)
    total_amount = db.Column(db.Float, nullable=False)
    purchase = db.relationship('Purchase', backref='items')
    product = db.relationship('Product', backref='purchase_items')

class KitchenOrder(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    order_number = db.Column(db.String(50), unique=True, nullable=False)
    sale_id = db.Column(db.Integer, db.ForeignKey('sale.id'), nullable=True)
    table_number = db.Column(db.String(20))
    status = db.Column(db.String(20), default='pending')  # pending, preparing, ready, served
    items = db.Column(db.Text)  # JSON string of items
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Attendance(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    check_in = db.Column(db.DateTime)
    check_out = db.Column(db.DateTime)
    status = db.Column(db.String(20), default='present')  # present, absent, leave
    user = db.relationship('User', backref='attendance')

class Waste(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('product.id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    product = db.relationship('Product', backref='waste_records')

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# ==================== HELPER FUNCTIONS ====================

def generate_invoice_number():
    """Generate unique invoice number"""
    last_sale = Sale.query.order_by(Sale.created_at.desc()).first()
    if last_sale:
        last_num = int(last_sale.invoice_number.split('-')[1])
        new_num = last_num + 1
    else:
        new_num = 1
    return f"INV-{new_num:06d}"

def generate_order_number():
    """Generate unique kitchen order number"""
    last_order = KitchenOrder.query.order_by(KitchenOrder.created_at.desc()).first()
    if last_order:
        last_num = int(last_order.order_number.split('-')[1])
        new_num = last_num + 1
    else:
        new_num = 1
    return f"KOT-{new_num:04d}"

# ==================== ROUTES ====================

@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        
        if user and user.password == password:  # In production, use password hashing
            login_user(user)
            return redirect(url_for('dashboard'))
        flash('Invalid username or password', 'error')
    
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/dashboard')
@login_required
def dashboard():
    today = datetime.now().date()
    today_sales = Sale.query.filter(db.func.date(Sale.created_at) == today).all()
    today_revenue = sum(s.total_amount for s in today_sales)
    
    low_stock_products = Product.query.filter(Product.stock_quantity <= Product.min_stock_level).all()
    pending_orders = KitchenOrder.query.filter_by(status='pending').count()
    
    return render_template('dashboard.html', 
                         today_sales=len(today_sales),
                         today_revenue=today_revenue,
                         low_stock_count=len(low_stock_products),
                         pending_orders=pending_orders)

@app.route('/billing')
@login_required
def billing():
    products = Product.query.filter_by(is_active=True).all()
    customers = Customer.query.all()
    return render_template('billing.html', products=products, customers=customers)

@app.route('/api/products')
@login_required
def get_products():
    products = Product.query.filter_by(is_active=True).all()
    return jsonify([{
        'id': p.id,
        'name': p.name,
        'barcode': p.barcode,
        'price': p.price,
        'stock': p.stock_quantity,
        'gst_rate': p.gst_rate
    } for p in products])

@app.route('/api/create_sale', methods=['POST'])
@login_required
def create_sale():
    data = request.json
    items = data.get('items', [])
    customer_id = data.get('customer_id')
    payment_method = data.get('payment_method', 'cash')
    discount = float(data.get('discount', 0))
    
    if not items:
        return jsonify({'error': 'No items in sale'}), 400
    
    # Calculate totals
    subtotal = sum(item['price'] * item['quantity'] for item in items)
    tax_amount = sum(item.get('tax', 0) for item in items)
    total_amount = subtotal + tax_amount - discount
    
    # Create sale
    sale = Sale(
        invoice_number=generate_invoice_number(),
        customer_id=customer_id,
        user_id=current_user.id,
        subtotal=subtotal,
        discount=discount,
        tax_amount=tax_amount,
        total_amount=total_amount,
        payment_method=payment_method
    )
    db.session.add(sale)
    db.session.flush()
    
    # Create sale items and update stock
    for item in items:
        product = Product.query.get(item['id'])
        if product:
            product.stock_quantity -= item['quantity']
            
            sale_item = SaleItem(
                sale_id=sale.id,
                product_id=product.id,
                quantity=item['quantity'],
                price=product.price,
                discount=item.get('discount', 0),
                tax_amount=item.get('tax', 0),
                total_amount=item['price'] * item['quantity']
            )
            db.session.add(sale_item)
    
    # Update customer loyalty points
    if customer_id:
        customer = Customer.query.get(customer_id)
        if customer:
            points_earned = int(total_amount / 10)  # 1 point per 10 rupees
            customer.loyalty_points += points_earned
            customer.total_purchases += total_amount
    
    db.session.commit()
    
    # Create kitchen order if applicable
    kitchen_items = [item for item in items if item.get('is_kitchen_item', False)]
    if kitchen_items:
        kitchen_order = KitchenOrder(
            order_number=generate_order_number(),
            sale_id=sale.id,
            status='pending',
            items=json.dumps(kitchen_items)
        )
        db.session.add(kitchen_order)
        db.session.commit()
    
    return jsonify({
        'success': True,
        'invoice_number': sale.invoice_number,
        'sale_id': sale.id
    })

@app.route('/inventory')
@login_required
def inventory():
    products = Product.query.all()
    categories = Category.query.all()
    return render_template('inventory.html', products=products, categories=categories)

@app.route('/api/product', methods=['POST'])
@login_required
def add_product():
    data = request.json
    product = Product(
        name=data['name'],
        barcode=data.get('barcode'),
        category_id=data.get('category_id'),
        price=float(data['price']),
        cost_price=float(data.get('cost_price', 0)),
        stock_quantity=int(data.get('stock_quantity', 0)),
        min_stock_level=int(data.get('min_stock_level', 10)),
        gst_rate=float(data.get('gst_rate', 18))
    )
    db.session.add(product)
    db.session.commit()
    return jsonify({'success': True, 'id': product.id})

@app.route('/customers')
@login_required
def customers():
    customers = Customer.query.all()
    return render_template('customers.html', customers=customers)

@app.route('/api/customer', methods=['POST'])
@login_required
def add_customer():
    data = request.json
    customer = Customer(
        name=data['name'],
        phone=data.get('phone'),
        email=data.get('email'),
        membership_type=data.get('membership_type', 'regular'),
        birthday=datetime.strptime(data['birthday'], '%Y-%m-%d').date() if data.get('birthday') else None
    )
    db.session.add(customer)
    db.session.commit()
    return jsonify({'success': True, 'id': customer.id})

@app.route('/kitchen')
@login_required
def kitchen():
    orders = KitchenOrder.query.order_by(KitchenOrder.created_at.desc()).all()
    return render_template('kitchen.html', orders=orders)

@app.route('/api/kitchen_order/<int:order_id>/status', methods=['POST'])
@login_required
def update_kitchen_order(order_id):
    data = request.json
    order = KitchenOrder.query.get_or_404(order_id)
    order.status = data['status']
    order.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True})

@app.route('/reports')
@login_required
def reports():
    return render_template('reports.html')

@app.route('/api/reports/sales')
@login_required
def get_sales_report():
    period = request.args.get('period', 'daily')
    today = datetime.now()
    
    if period == 'daily':
        start_date = today.replace(hour=0, minute=0, second=0)
        end_date = today.replace(hour=23, minute=59, second=59)
    elif period == 'weekly':
        start_date = today - timedelta(days=today.weekday())
        start_date = start_date.replace(hour=0, minute=0, second=0)
        end_date = today
    elif period == 'monthly':
        start_date = today.replace(day=1, hour=0, minute=0, second=0)
        end_date = today
    else:
        start_date = today - timedelta(days=30)
        end_date = today
    
    sales = Sale.query.filter(
        Sale.created_at >= start_date,
        Sale.created_at <= end_date
    ).all()
    
    total_sales = len(sales)
    total_revenue = sum(s.total_amount for s in sales)
    total_discount = sum(s.discount for s in sales)
    total_tax = sum(s.tax_amount for s in sales)
    
    # Calculate profit
    total_cost = 0
    for sale in sales:
        for item in sale.items:
            product = Product.query.get(item.product_id)
            if product:
                total_cost += product.cost_price * item.quantity
    
    profit = total_revenue - total_cost
    
    return jsonify({
        'period': period,
        'total_sales': total_sales,
        'total_revenue': total_revenue,
        'total_discount': total_discount,
        'total_tax': total_tax,
        'total_cost': total_cost,
        'profit': profit,
        'sales': [{
            'invoice_number': s.invoice_number,
            'total_amount': s.total_amount,
            'payment_method': s.payment_method,
            'created_at': s.created_at.isoformat()
        } for s in sales]
    })

@app.route('/employees')
@login_required
def employees():
    users = User.query.all()
    return render_template('employees.html', users=users)

@app.route('/api/attendance', methods=['POST'])
@login_required
def mark_attendance():
    data = request.json
    user_id = data.get('user_id', current_user.id)
    today = datetime.now().date()
    
    attendance = Attendance.query.filter_by(user_id=user_id, date=today).first()
    
    if not attendance:
        attendance = Attendance(
            user_id=user_id,
            date=today,
            check_in=datetime.utcnow()
        )
        db.session.add(attendance)
    else:
        attendance.check_out = datetime.utcnow()
    
    db.session.commit()
    return jsonify({'success': True})

# Initialize database
with app.app_context():
    db.create_all()
    
    # Create default admin user if not exists
    admin = User.query.filter_by(username='admin').first()
    if not admin:
        admin = User(
            username='admin',
            password='admin123',  # Change in production
            role='admin',
            email='admin@pos.com'
        )
        db.session.add(admin)
        db.session.commit()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
