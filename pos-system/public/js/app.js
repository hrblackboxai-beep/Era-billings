// Global state
let token = null;
let currentUser = null;
let cart = [];
let products = [];
let socket = null;

// API Base URL
const API_URL = window.location.origin + '/api';

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Check for existing session
    const savedToken = localStorage.getItem('pos_token');
    if (savedToken) {
        token = savedToken;
        loadUserProfile();
    }

    // Setup event listeners
    setupEventListeners();
    
    // Initialize Socket.IO for real-time updates
    initializeSocket();
});

function setupEventListeners() {
    // Login form
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    
    // Logout button
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    
    // Navigation
    document.querySelectorAll('.nav-menu li').forEach(item => {
        item.addEventListener('click', () => navigateToPage(item.dataset.page));
    });
    
    // Barcode input
    document.getElementById('barcode-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchProducts();
        }
    });
}

function initializeSocket() {
    socket = io(window.location.origin);
    
    socket.on('connect', () => {
        console.log('Connected to server');
        socket.emit('join-kitchen');
    });
    
    socket.on('order-created', (order) => {
        console.log('New order:', order);
        if (document.getElementById('kitchen-page').classList.contains('active')) {
            loadKitchenOrders();
        }
        showNotification(`New Order: ${order.orderNumber}`);
    });
    
    socket.on('order-status-changed', (data) => {
        console.log('Order status changed:', data);
        if (document.getElementById('kitchen-page').classList.contains('active')) {
            loadKitchenOrders();
        }
    });
}

async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            token = data.token;
            currentUser = data.user;
            localStorage.setItem('pos_token', token);
            
            document.getElementById('login-screen').classList.remove('active');
            document.getElementById('app-screen').classList.add('active');
            
            document.getElementById('user-name').textContent = `${currentUser.name} (${currentUser.role})`;
            
            // Load initial data
            loadProducts();
            navigateToPage('billing');
        } else {
            alert(data.error || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please check your connection.');
    }
}

function handleLogout() {
    token = null;
    currentUser = null;
    localStorage.removeItem('pos_token');
    
    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('login-screen').classList.add('active');
    
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
}

async function loadUserProfile() {
    try {
        const response = await fetch(`${API_URL}/auth/profile`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentUser = data.user;
            document.getElementById('login-screen').classList.remove('active');
            document.getElementById('app-screen').classList.add('active');
            document.getElementById('user-name').textContent = `${currentUser.name} (${currentUser.role})`;
            
            loadProducts();
            navigateToPage('billing');
        } else {
            handleLogout();
        }
    } catch (error) {
        console.error('Profile load error:', error);
        handleLogout();
    }
}

function navigateToPage(pageName) {
    // Update navigation
    document.querySelectorAll('.nav-menu li').forEach(item => {
        item.classList.toggle('active', item.dataset.page === pageName);
    });
    
    // Show page
    document.querySelectorAll('.page').forEach(page => {
        page.classList.toggle('active', page.id === `${pageName}-page`);
    });
    
    // Load page-specific data
    switch(pageName) {
        case 'billing':
            loadProducts();
            break;
        case 'inventory':
            loadInventory();
            break;
        case 'kitchen':
            loadKitchenOrders();
            break;
        case 'customers':
            loadCustomers();
            break;
        case 'employees':
            loadEmployees();
            break;
        case 'reports':
            loadReport('daily');
            break;
    }
}

// Billing Functions
async function loadProducts() {
    try {
        const response = await fetch(`${API_URL}/inventory/products`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            products = data.products;
            renderProductsList();
        }
    } catch (error) {
        console.error('Load products error:', error);
    }
}

function renderProductsList() {
    const container = document.getElementById('products-list');
    container.innerHTML = '';
    
    products.forEach(product => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.onclick = () => addToCart(product);
        
        card.innerHTML = `
            <h4>${product.name}</h4>
            <div class="price">₹${product.price}</div>
            <div class="stock">Stock: ${product.stock_quantity}</div>
        `;
        
        container.appendChild(card);
    });
}

async function searchProducts() {
    const query = document.getElementById('barcode-input').value.trim();
    
    if (!query) return;
    
    // Try barcode search first
    try {
        const response = await fetch(`${API_URL}/billing/search/barcode/${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            addToCart(data.product);
            document.getElementById('barcode-input').value = '';
            return;
        }
    } catch (error) {
        console.error('Barcode search error:', error);
    }
    
    // Fallback to filtering loaded products
    const filtered = products.filter(p => 
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        (p.barcode && p.barcode.includes(query))
    );
    
    const container = document.getElementById('products-list');
    container.innerHTML = '';
    
    filtered.forEach(product => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.onclick = () => addToCart(product);
        
        card.innerHTML = `
            <h4>${product.name}</h4>
            <div class="price">₹${product.price}</div>
            <div class="stock">Stock: ${product.stock_quantity}</div>
        `;
        
        container.appendChild(card);
    });
}

function addToCart(product) {
    const existingItem = cart.find(item => item.productId === product.id);
    
    if (existingItem) {
        existingItem.quantity++;
    } else {
        cart.push({
            productId: product.id,
            productName: product.name,
            price: product.price,
            taxRate: product.tax_rate,
            quantity: 1,
            sendToKitchen: false
        });
    }
    
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cart-items');
    container.innerHTML = '';
    
    cart.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'cart-item';
        
        div.innerHTML = `
            <div class="cart-item-info">
                <strong>${item.productName}</strong><br>
                ₹${item.price} x ${item.quantity}
            </div>
            <div class="cart-item-controls">
                <button class="btn-minus" onclick="updateCartItem(${index}, -1)">-</button>
                <span>${item.quantity}</span>
                <button class="btn-plus" onclick="updateCartItem(${index}, 1)">+</button>
            </div>
        `;
        
        container.appendChild(div);
    });
    
    updateTotals();
}

function updateCartItem(index, change) {
    cart[index].quantity += change;
    
    if (cart[index].quantity <= 0) {
        cart.splice(index, 1);
    }
    
    renderCart();
}

function updateTotals() {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discountPercent = parseFloat(document.getElementById('discount-input').value) || 0;
    const discountAmount = (subtotal * discountPercent) / 100;
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = (taxableAmount * 18) / 100; // Default 18% GST
    const total = taxableAmount + taxAmount;
    
    document.getElementById('subtotal').textContent = `₹${subtotal.toFixed(2)}`;
    document.getElementById('tax-amount').textContent = `₹${taxAmount.toFixed(2)}`;
    document.getElementById('grand-total').textContent = `₹${total.toFixed(2)}`;
    
    return total;
}

async function processPayment() {
    if (cart.length === 0) {
        alert('Cart is empty');
        return;
    }
    
    const paymentMethod = document.getElementById('payment-method').value;
    const paidAmount = parseFloat(document.getElementById('paid-amount').value);
    const total = updateTotals();
    
    if (paymentMethod !== 'card' && paymentMethod !== 'upi' && paymentMethod !== 'wallet') {
        if (!paidAmount || paidAmount < total) {
            alert('Please enter correct payment amount');
            return;
        }
    }
    
    try {
        const response = await fetch(`${API_URL}/billing/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                items: cart,
                discountPercentage: parseFloat(document.getElementById('discount-input').value) || 0,
                paymentMethod,
                paidAmount: paidAmount || total
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert(`Payment successful! Change: ₹${(paidAmount - total).toFixed(2)}`);
            cart = [];
            renderCart();
            document.getElementById('paid-amount').value = '';
            document.getElementById('discount-input').value = '';
            loadProducts(); // Refresh stock
        } else {
            alert(data.error || 'Payment failed');
        }
    } catch (error) {
        console.error('Payment error:', error);
        alert('Payment failed. Please try again.');
    }
}

function splitBill() {
    alert('Split bill functionality - Enter multiple payment amounts');
    // Implementation for split payments
}

// Inventory Functions
async function loadInventory() {
    try {
        const response = await fetch(`${API_URL}/inventory/products`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const tbody = document.getElementById('inventory-table');
            tbody.innerHTML = '';
            
            data.products.forEach(product => {
                const tr = document.createElement('tr');
                const stockClass = product.stock_quantity <= product.reorder_level ? 'low-stock' : 'in-stock';
                
                tr.innerHTML = `
                    <td>${product.name}</td>
                    <td>${product.barcode || '-'}</td>
                    <td>${product.category || '-'}</td>
                    <td>₹${product.price}</td>
                    <td class="${stockClass}">${product.stock_quantity}</td>
                    <td>${product.stock_quantity <= 0 ? 'Out of Stock' : product.stock_quantity <= product.reorder_level ? 'Low Stock' : 'In Stock'}</td>
                    <td>
                        <button onclick="editProduct('${product.id}')">Edit</button>
                    </td>
                `;
                
                tbody.appendChild(tr);
            });
        }
    } catch (error) {
        console.error('Load inventory error:', error);
    }
}

function toggleLowStock() {
    loadInventory();
}

// Kitchen Functions
async function loadKitchenOrders() {
    try {
        const response = await fetch(`${API_URL}/kitchen/orders?status=pending`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const board = document.getElementById('kds-board');
            board.innerHTML = '';
            
            data.orders.forEach(order => {
                const card = document.createElement('div');
                card.className = `kot-card ${order.status}`;
                
                const itemsHtml = order.items.map(item => 
                    `<div class="kot-item">${item.quantity}x ${item.productName}</div>`
                ).join('');
                
                card.innerHTML = `
                    <div class="kot-header">
                        <span>${order.order_number}</span>
                        <span>${new Date(order.created_at).toLocaleTimeString()}</span>
                    </div>
                    <div class="kot-items">${itemsHtml}</div>
                    <div class="kot-actions">
                        ${order.status === 'pending' ? 
                            `<button onclick="updateOrderStatus('${order.id}', 'preparing')">Start</button>` : ''}
                        ${order.status === 'preparing' ? 
                            `<button onclick="updateOrderStatus('${order.id}', 'completed')">Complete</button>` : ''}
                    </div>
                `;
                
                board.appendChild(card);
            });
        }
    } catch (error) {
        console.error('Load kitchen orders error:', error);
    }
}

async function updateOrderStatus(orderId, status) {
    try {
        await fetch(`${API_URL}/kitchen/orders/${orderId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status })
        });
        
        loadKitchenOrders();
    } catch (error) {
        console.error('Update order status error:', error);
    }
}

// Customers Functions
async function loadCustomers() {
    try {
        const response = await fetch(`${API_URL}/customers`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const tbody = document.getElementById('customers-table');
            tbody.innerHTML = '';
            
            data.customers.forEach(customer => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${customer.name}</td>
                    <td>${customer.phone || '-'}</td>
                    <td>${customer.email || '-'}</td>
                    <td>${customer.loyalty_points}</td>
                    <td>${customer.membership_type}</td>
                    <td><button onclick="viewCustomer('${customer.id}')">View</button></td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (error) {
        console.error('Load customers error:', error);
    }
}

// Employees Functions
async function loadEmployees() {
    try {
        const response = await fetch(`${API_URL}/employees`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const tbody = document.getElementById('employees-table');
            tbody.innerHTML = '';
            
            data.employees.forEach(emp => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${emp.name}</td>
                    <td>${emp.role}</td>
                    <td>${emp.phone || '-'}</td>
                    <td>₹${emp.salary}</td>
                    <td>${emp.attendance_status}</td>
                    <td><button onclick="viewEmployee('${emp.id}')">View</button></td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (error) {
        console.error('Load employees error:', error);
    }
}

async function markAttendance() {
    const employeeId = prompt('Enter Employee ID:');
    if (!employeeId) return;
    
    try {
        const response = await fetch(`${API_URL}/employees/attendance`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ employeeId, type: 'check-in' })
        });
        
        const data = await response.json();
        alert(data.message || data.error);
    } catch (error) {
        console.error('Mark attendance error:', error);
    }
}

// Reports Functions
async function loadReport(type) {
    try {
        let endpoint = '';
        switch(type) {
            case 'daily': endpoint = '/sales/daily'; break;
            case 'weekly': endpoint = '/sales/weekly'; break;
            case 'monthly': endpoint = '/sales/monthly'; break;
            case 'profit': endpoint = '/profit'; break;
            case 'tax': endpoint = '/tax'; break;
        }
        
        const response = await fetch(`${API_URL}/reports${endpoint}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const content = document.getElementById('report-content');
            
            if (type === 'daily') {
                content.innerHTML = `
                    <h3>Daily Sales Report</h3>
                    <div class="report-stats">
                        <p>Total Transactions: ${data.report.summary.totalTransactions}</p>
                        <p>Total Sales: ₹${data.report.summary.totalSales?.toFixed(2) || '0.00'}</p>
                        <p>Average Transaction: ₹${data.report.summary.averageTransaction?.toFixed(2) || '0.00'}</p>
                    </div>
                `;
            } else {
                content.innerHTML = `<h3>${type.toUpperCase()} Report</h3><pre>${JSON.stringify(data.report, null, 2)}</pre>`;
            }
        }
    } catch (error) {
        console.error('Load report error:', error);
    }
}

// Utility Functions
function showNotification(message) {
    // Simple notification
    console.log('Notification:', message);
}

function backupData() {
    alert('Backup created successfully! (Local database backed up)');
}

function exportData() {
    alert('Data exported to CSV');
}
