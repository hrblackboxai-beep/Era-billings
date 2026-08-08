// POS System - Offline First
// Global state
let token = null;
let currentUser = null;
let cart = [];
let products = [];
let customers = [];
let employees = [];
let tables = [];
let orders = [];
let allInventory = [];
let lowStockOnly = false;
let socket = null;
let reportChart = null;
let editingProductId = null;
let editingTableId = null;
let appSettings = {};
let activeOrder = null;
let kitchenStation = 'all';

// API Base URL
const API_URL = window.location.origin + '/api';

// ==================== UTILITIES ====================

function currencySymbol() {
    return (appSettings.currency || 'INR') === 'USD' ? '$' : 'Rs ';
}

function formatMoney(value) {
    const num = Number(value) || 0;
    return `${currencySymbol()}${num.toFixed(2)}`;
}

function formatDateTime(value) {
    if (!value) return '-';
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
        return text.replace(' ', ' ');
    }
    const parsed = new Date(text);
    return isNaN(parsed.getTime()) ? text : parsed.toLocaleString();
}

function apiHeaders(extra = {}) {
    return Object.assign({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    }, extra);
}

const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
};

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `${TOAST_ICONS[type] || TOAST_ICONS.info}<span>${esc(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showLoginError(message) {
    const el = document.getElementById('login-error');
    el.textContent = message;
    el.hidden = false;
}

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    const savedToken = localStorage.getItem('pos_token');
    if (savedToken) {
        token = savedToken;
        loadUserProfile();
    }
    setupEventListeners();
    initializeSocket();
    setInterval(refreshKotTimers, 30000);
});

function setupEventListeners() {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });

    document.querySelectorAll('.nav-menu li').forEach(item => {
        item.addEventListener('click', () => navigateToPage(item.dataset.page));
    });

    const barcodeInput = document.getElementById('barcode-input');
    barcodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchProducts();
    });
    barcodeInput.addEventListener('input', () => {
        const query = barcodeInput.value.trim();
        if (query) filterProductsByQuery(query);
        else renderProductsList();
    });

    document.getElementById('settings-form').addEventListener('submit', saveSettings);
    document.getElementById('product-form').addEventListener('submit', submitProduct);
    document.getElementById('customer-form').addEventListener('submit', submitCustomer);
    document.getElementById('table-form').addEventListener('submit', submitTable);
    document.getElementById('table-select').addEventListener('change', onTableChange);

    document.querySelectorAll('#order-filter-tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#order-filter-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderOrdersPage();
        });
    });

    document.querySelectorAll('#station-tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#station-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            kitchenStation = btn.dataset.station;
            loadKitchenOrders();
        });
    });
}

function initializeSocket() {
    socket = io(window.location.origin);

    socket.on('connect', () => {
        socket.emit('join-kitchen');
    });

    socket.on('order-created', (order) => {
        showToast(`New kitchen order: ${order.orderNumber}`, 'info');
        if (document.getElementById('kitchen-page').classList.contains('active')) {
            loadKitchenOrders();
        }
        if (document.getElementById('orders-page').classList.contains('active')) {
            loadOrders();
        }
    });

    socket.on('order-status-changed', (data) => {
        if (document.getElementById('kitchen-page').classList.contains('active')) {
            loadKitchenOrders();
        }
        if (document.getElementById('orders-page').classList.contains('active')) {
            loadOrders();
        }
    });

    socket.on('order-updated', (data) => {
        if (document.getElementById('orders-page').classList.contains('active')) {
            loadOrders();
        }
        if (activeOrder && data.orderId === activeOrder.id) {
            loadOrderIntoCart(activeOrder.id);
        }
        loadTables();
    });

    socket.on('tables-changed', () => {
        loadTables();
    });
}

// ==================== AUTH ====================

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
        showLoginError('Please enter both username and password.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';
    showLoginError('');

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

            renderUserInfo();
            applyRoleGuards();
            await Promise.all([loadProducts(), loadCustomers(), loadSettings(), loadTables(), loadOrders()]);
            navigateToPage('billing');
        } else {
            showLoginError(data.error || 'Login failed. Check your credentials.');
        }
    } catch (error) {
        console.error('Login error:', error);
        showLoginError('Unable to reach the server. Please try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
}

function handleLogout() {
    token = null;
    currentUser = null;
    cart = [];
    localStorage.removeItem('pos_token');

    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('login-screen').classList.add('active');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('login-error').hidden = true;
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
            renderUserInfo();
            applyRoleGuards();
            await Promise.all([loadProducts(), loadCustomers(), loadSettings(), loadTables(), loadOrders()]);
            navigateToPage('billing');
        } else {
            handleLogout();
        }
    } catch (error) {
        console.error('Profile load error:', error);
        handleLogout();
    }
}

function renderUserInfo() {
    document.getElementById('user-name').textContent = currentUser.name || currentUser.username;
    document.getElementById('user-role').textContent = currentUser.role || '';
    const initial = (currentUser.name || currentUser.username || 'U').charAt(0).toUpperCase();
    document.getElementById('user-avatar').textContent = initial;
}

function applyRoleGuards() {
    const isAdmin = currentUser && currentUser.role === 'admin';
    const adminNav = document.querySelectorAll('.nav-menu li[data-role="admin"]');
    adminNav.forEach(li => {
        li.style.display = isAdmin ? '' : 'none';
        if (!isAdmin && currentPage && li.dataset.page === currentPage) {
            navigateToPage('billing');
        }
    });

    if (isAdmin && currentPage === 'settings') {
        loadLoginLogs();
    }
}

// ==================== NAVIGATION ====================

function navigateToPage(pageName) {
    document.querySelectorAll('.nav-menu li').forEach(item => {
        item.classList.toggle('active', item.dataset.page === pageName);
    });

    document.querySelectorAll('.page').forEach(page => {
        page.classList.toggle('active', page.id === `${pageName}-page`);
    });

    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) sidebar.classList.remove('open');

    switch (pageName) {
        case 'billing':
            loadProducts();
            loadTables();
            break;
        case 'tables':
            loadTables();
            break;
        case 'orders':
            loadOrders();
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
        case 'settings':
            loadSettings();
            if (currentUser && currentUser.role === 'admin') {
                loadLoginLogs();
            }
            break;
    }
}

// ==================== BILLING ====================

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

const CATEGORY_COLORS = {
    food: '#f97316', beverage: '#0ea5e9', dessert: '#ec4899',
    snack: '#eab308', main: '#10b981', default: '#6366f1'
};

function categoryColor(category) {
    const c = (category || '').toLowerCase();
    for (const key of Object.keys(CATEGORY_COLORS)) {
        if (c.includes(key)) return CATEGORY_COLORS[key];
    }
    return CATEGORY_COLORS.default;
}

function productCardHtml(product, disabled = false) {
    const outOfStock = disabled || (product.stock_quantity || 0) <= 0;
    const lowStock = !outOfStock && (product.stock_quantity || 0) <= (product.reorder_level || 0);
    const color = categoryColor(product.category);
    const cat = product.category ? esc(product.category) : '';

    return `
        <div class="product-cat" style="--cat-color:${color}">${cat}</div>
        <div class="product-card-name">${esc(product.name)}</div>
        <div class="price">${formatMoney(product.price)}</div>
        <div class="stock ${lowStock ? 'low' : ''} ${outOfStock ? 'out' : ''}">
            ${outOfStock ? 'Out of stock' : `Stock: ${product.stock_quantity}`}
        </div>
    `;
}

function renderProductsList() {
    const container = document.getElementById('products-list');
    container.innerHTML = '';
    const count = document.getElementById('product-count');

    if (count) count.textContent = `${products.length} item${products.length === 1 ? '' : 's'}`;
    document.getElementById('products-empty').hidden = products.length > 0;

    products.forEach(product => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.onclick = () => addToCart(product);

        const outOfStock = (product.stock_quantity || 0) <= 0;
        card.innerHTML = productCardHtml(product, outOfStock);
        if (outOfStock) card.classList.add('disabled');

        container.appendChild(card);
    });
}

function filterProductsByQuery(query) {
    const q = query.toLowerCase();
    const filtered = products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    );

    const container = document.getElementById('products-list');
    container.innerHTML = '';
    document.getElementById('products-empty').hidden = filtered.length > 0;

    filtered.forEach(product => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.onclick = () => addToCart(product);
        card.innerHTML = productCardHtml(product);
        container.appendChild(card);
    });
}

async function searchProducts() {
    const input = document.getElementById('barcode-input');
    const query = input.value.trim();

    if (!query) return;

    try {
        const response = await fetch(`${API_URL}/billing/search/barcode/${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            addToCart(data.product);
            input.value = '';
            showToast(`${data.product.name} added to bill`);
            renderProductsList();
            return;
        }
    } catch (error) {
        console.error('Barcode search error:', error);
    }

    filterProductsByQuery(query);
}

function clearSearch() {
    document.getElementById('barcode-input').value = '';
    renderProductsList();
}

function addToCart(product) {
    if ((product.stock_quantity || 0) <= 0) {
        showToast(`${product.name} is out of stock`, 'error');
        return;
    }

    const existingItem = cart.find(item => item.productId === product.id);

    if (existingItem) {
        if (existingItem.quantity >= (product.stock_quantity || 0)) {
            showToast('Not enough stock available', 'error');
            return;
        }
        existingItem.quantity++;
    } else {
        cart.push({
            productId: product.id,
            productName: product.name,
            price: Number(product.price) || 0,
            taxRate: Number(product.tax_rate) || 18,
            quantity: 1,
            sendToKitchen: isKitchenCategory(product.category),
            station: product.station || 'main',
            sentQty: 0
        });
    }

    renderCart();
    flashProductCard(product.name);
    updateCartBadge();
}

function flashProductCard(productName) {
    const card = Array.from(document.querySelectorAll('.product-card')).find(
        el => el.querySelector('.product-card-name') && el.querySelector('.product-card-name').textContent.trim() === productName
    );
    if (card) {
        card.classList.remove('just-added');
        void card.offsetWidth;
        card.classList.add('just-added');
    }
}

function isKitchenCategory(category) {
    const c = (category || '').toLowerCase();
    return ['food', 'beverage', 'dessert', 'snack', 'main'].some(kw => c.includes(kw));
}

function renderCart() {
    const container = document.getElementById('cart-items');
    container.innerHTML = '';

    document.getElementById('cart-empty').hidden = cart.length > 0;
    document.getElementById('clear-cart-btn').style.display = cart.length ? '' : 'none';

    cart.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'cart-item';
        if (item.voided) div.classList.add('voided');

        const pendingSend = (item.quantity || 0) - (item.sentQty || 0);
        const locked = activeOrder && (item.sentQty || 0) > 0;

        div.innerHTML = `
            <div class="cart-item-info">
                <strong>${esc(item.productName)}</strong>
                <div class="cart-item-price">${formatMoney(item.price)} x ${item.quantity}</div>
                <div class="cart-item-tags">
                    <label class="kitchen-toggle" title="Send to kitchen display">
                        <input type="checkbox" ${item.sendToKitchen ? 'checked' : ''} onchange="toggleKitchenItem(${index}, this.checked)">
                        <span>Kitchen</span>
                    </label>
                    ${item.sendToKitchen && item.station ? `<span class="kot-station">${esc(item.station)}</span>` : ''}
                    ${pendingSend > 0 ? `<span class="cart-pending-send">+${pendingSend} to send</span>` : ''}
                    ${item.voided ? `<span class="cart-voided-tag">VOIDED${item.voidReason ? ': ' + esc(item.voidReason) : ''}</span>` : ''}
                </div>
            </div>
            <div class="cart-item-controls">
                <button class="btn-minus" onclick="updateCartItem(${index}, -1)" aria-label="Decrease quantity">-</button>
                <span>${item.quantity}</span>
                <button class="btn-plus" onclick="updateCartItem(${index}, 1)" aria-label="Increase quantity">+</button>
                <button class="btn-remove" onclick="removeCartItem(${index})" aria-label="Remove item" title="${locked ? 'Void this item' : 'Remove item'}">&times;</button>
            </div>
        `;

        container.appendChild(div);
    });

    updateTotals();
}

function updateCartItem(index, change) {
    const item = cart[index];
    const product = products.find(p => p.id === item.productId);
    const sentQty = item.sentQty || 0;
    const newQty = item.quantity + change;

    if (newQty <= 0) {
        if (activeOrder && sentQty > 0) {
            voidCartItem(index, sentQty);
            return;
        }
        cart.splice(index, 1);
    } else if (product && newQty > (product.stock_quantity || 0)) {
        cart[index].quantity = product.stock_quantity;
        showToast('Quantity limited to available stock', 'error');
    } else if (activeOrder && newQty < sentQty) {
        voidCartItem(index, sentQty - newQty);
        return;
    } else {
        cart[index].quantity = newQty;
    }

    renderCart();
}

function removeCartItem(index) {
    const item = cart[index];
    if (activeOrder && item && (item.sentQty || 0) > 0) {
        voidCartItem(index, item.sentQty);
        return;
    }
    cart.splice(index, 1);
    renderCart();
}

function voidCartItem(index, quantity) {
    const item = cart[index];
    if (!item) return;

    if (!activeOrder) {
        cart.splice(index, 1);
        renderCart();
        return;
    }

    const reason = prompt(`Void ${quantity} x ${item.productName}? Enter a reason:`, 'Voided by customer');
    if (reason === null) return;

    voidOrderItem(activeOrder.id, item.productId, quantity, reason || 'Voided by customer');
}

async function voidOrderItem(orderId, productId, quantity, reason) {
    const item = cart.find(i => i.productId === productId);
    if (!item) return;
    const targetQty = Math.max((item.quantity || 0) - quantity, 0);

    try {
        const response = await fetch(`${API_URL}/orders/${orderId}/items/${encodeURIComponent(productId)}`, {
            method: 'PUT',
            headers: apiHeaders(),
            body: JSON.stringify({ quantity: targetQty, reason })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to void item');

        showToast(data.message);
        await loadOrderIntoCart(orderId);
        await Promise.all([loadOrders(), loadTables()]);
    } catch (error) {
        console.error('Void item error:', error);
        showToast(error.message || 'Failed to void item', 'error');
    }
}

function toggleKitchenItem(index, checked) {
    if (cart[index]) {
        cart[index].sendToKitchen = checked;
    }
}

function clearCart() {
    if (activeOrder) {
        showToast('Cannot clear an active order. Void it from the Orders page.', 'error');
        return;
    }
    cart = [];
    renderCart();
}

function updateTotals() {
    const live = cart.filter(item => !item.voided);
    const subtotal = live.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discountPercent = parseFloat(document.getElementById('discount-input').value) || 0;
    const discountAmount = (subtotal * Math.min(Math.max(discountPercent, 0), 100)) / 100;
    const taxAmount = live.reduce((sum, item) => {
        const itemTotal = item.price * item.quantity;
        return sum + ((itemTotal * (item.taxRate || 18)) / 100);
    }, 0);
    const total = subtotal - discountAmount + taxAmount;

    document.getElementById('subtotal').textContent = formatMoney(subtotal);
    document.getElementById('tax-amount').textContent = formatMoney(taxAmount);
    document.getElementById('grand-total').textContent = formatMoney(total);

    updateCartBadge();

    return { subtotal, discountAmount, taxAmount, total };
}

function updateCartBadge() {
    const badge = document.getElementById('cart-badge');
    if (!badge) return;
    const count = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
    badge.textContent = count;
    badge.hidden = count === 0;
}

async function processPayment() {
    if (cart.length === 0) {
        showToast('Your bill is empty', 'error');
        return;
    }

    const paymentMethod = document.getElementById('payment-method').value;
    const paidAmount = parseFloat(document.getElementById('paid-amount').value);
    const totals = updateTotals();

    const requiresExactAmount = ['cash'].includes(paymentMethod);
    if (requiresExactAmount) {
        if (isNaN(paidAmount) || paidAmount < totals.total) {
            showToast('Enter an amount that covers the bill total', 'error');
            return;
        }
    }

    const customerId = document.getElementById('customer-select').value || null;
    const discountPercent = parseFloat(document.getElementById('discount-input').value) || 0;
    const btn = document.getElementById('checkout-btn');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
        let data;

        if (activeOrder) {
            await syncOrderWithCart(activeOrder.id);
            const response = await fetch(`${API_URL}/orders/${activeOrder.id}/checkout`, {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({
                    paymentMethod,
                    paidAmount: isNaN(paidAmount) ? totals.total : paidAmount,
                    discountPercentage: discountPercent,
                    customerId
                })
            });
            data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Checkout failed');
        } else {
            const response = await fetch(`${API_URL}/billing/create`, {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({
                    items: cart,
                    customerId,
                    discountPercentage: discountPercent,
                    paymentMethod,
                    paidAmount: isNaN(paidAmount) ? totals.total : paidAmount,
                    notes: '',
                    tableId: document.getElementById('table-select').value || null
                })
            });
            data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Payment failed');
        }

        const change = !isNaN(paidAmount) ? (paidAmount - totals.total) : 0;
        showReceipt(data.bill, change);
        await resetAfterCheckout();
    } catch (error) {
        console.error('Payment error:', error);
        showToast(error.message || 'Payment failed. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Checkout';
    }
}

async function resetAfterCheckout() {
    cart = [];
    activeOrder = null;
    document.getElementById('table-select').value = '';
    document.getElementById('paid-amount').value = '';
    document.getElementById('discount-input').value = '';
    updateOrderBanner();
    renderCart();
    await Promise.all([loadProducts(), loadCustomers(), loadTables(), loadOrders()]);
}

function showReceipt(bill, change) {
    const content = document.getElementById('receipt-content');
    const storeName = appSettings.company_name || 'My Store';

    const itemsHtml = (bill.items || []).map(item => `
        <div class="receipt-row">
            <span>${esc(item.product_name)} x ${item.quantity}</span>
            <span>${formatMoney(item.total_amount)}</span>
        </div>
    `).join('');

    content.innerHTML = `
        <div class="receipt-header">
            <strong>${esc(storeName)}</strong>
            <span>${esc(bill.bill_number || '')}</span>
            <span class="small">${new Date().toLocaleString()}</span>
        </div>
        <div class="receipt-items">${itemsHtml}</div>
        <div class="receipt-totals">
            <div class="receipt-row"><span>Subtotal</span><span>${formatMoney(bill.subtotal)}</span></div>
            ${Number(bill.discount_amount) ? `<div class="receipt-row"><span>Discount</span><span>-${formatMoney(bill.discount_amount)}</span></div>` : ''}
            <div class="receipt-row"><span>Tax</span><span>${formatMoney(bill.tax_amount)}</span></div>
            <div class="receipt-row total"><span>Total</span><span>${formatMoney(bill.total_amount)}</span></div>
            <div class="receipt-row"><span>Paid</span><span>${formatMoney(bill.paid_amount)}</span></div>
            ${change > 0 ? `<div class="receipt-row"><span>Change</span><span>${formatMoney(change)}</span></div>` : ''}
        </div>
        <p class="receipt-footer">Thank you for your business!</p>
    `;

    document.getElementById('receipt-modal').classList.add('active');
    if (change > 0) showToast(`Change due: ${formatMoney(change)}`);
}

function printReceipt() {
    const content = document.getElementById('receipt-content').innerHTML;
    const win = window.open('', '_blank', 'width=400,height=600');
    if (!win) {
        showToast('Pop-up blocked. Allow pop-ups to print.', 'error');
        return;
    }
    win.document.write(`
        <html><head><title>Receipt</title>
        <style>
            body { font-family: monospace; padding: 20px; color: #000; }
            .receipt-header { text-align: center; margin-bottom: 15px; }
            .receipt-row { display: flex; justify-content: space-between; padding: 4px 0; }
            .receipt-row.total { font-weight: bold; border-top: 1px dashed #000; margin-top: 8px; padding-top: 8px; }
            .receipt-footer { text-align: center; margin-top: 20px; }
            .small { font-size: 12px; }
        </style></head><body>${content}</body></html>
    `);
    win.document.close();
    win.print();
}

function closeReceiptModal() {
    document.getElementById('receipt-modal').classList.remove('active');
}

// ==================== SPLIT BILL ====================

function openSplitModal() {
    if (cart.length === 0) {
        showToast('Your bill is empty', 'error');
        return;
    }
    const totals = updateTotals();
    document.getElementById('split-total').textContent = formatMoney(totals.total);
    document.getElementById('split-entries').innerHTML = '';
    addSplitEntry();
    updateSplitAllocated();
    document.getElementById('split-modal').classList.add('active');
}

function addSplitEntry() {
    const container = document.getElementById('split-entries');
    const div = document.createElement('div');
    div.className = 'split-entry';
    div.innerHTML = `
        <select class="split-method">
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="upi">UPI</option>
            <option value="wallet">Wallet</option>
        </select>
        <input type="number" class="split-amount" placeholder="Amount" min="0" step="0.01" oninput="updateSplitAllocated()">
        <button type="button" class="btn-remove" onclick="removeSplitEntry(this)">&times;</button>
    `;
    container.appendChild(div);
    updateSplitAllocated();
}

function removeSplitEntry(btn) {
    btn.closest('.split-entry').remove();
    updateSplitAllocated();
}

function updateSplitAllocated() {
    const total = parseFloat(document.getElementById('split-total').textContent.replace(/[^0-9.-]/g, '')) || 0;
    const amounts = [...document.querySelectorAll('.split-amount')]
        .map(input => parseFloat(input.value) || 0);
    const allocated = amounts.reduce((sum, a) => sum + a, 0);
    document.getElementById('split-allocated').textContent = formatMoney(allocated);
    document.getElementById('split-allocated').classList.toggle('invalid', Math.abs(allocated - total) > 0.01);
}

function closeSplitModal() {
    document.getElementById('split-modal').classList.remove('active');
}

async function confirmSplit() {
    const total = parseFloat(document.getElementById('split-total').textContent.replace(/[^0-9.-]/g, '')) || 0;
    const entries = [...document.querySelectorAll('.split-entry')];
    const splits = entries.map(entry => ({
        amount: parseFloat(entry.querySelector('.split-amount').value) || 0,
        paymentMethod: entry.querySelector('.split-method').value
    })).filter(s => s.amount > 0);

    if (splits.length === 0) {
        showToast('Enter at least one split amount', 'error');
        return;
    }

    const allocated = splits.reduce((sum, s) => sum + s.amount, 0);
    if (Math.abs(allocated - total) > 0.01) {
        showToast('Split amounts must equal the bill total', 'error');
        return;
    }

    const customerId = document.getElementById('customer-select').value || null;
    const discountPercent = parseFloat(document.getElementById('discount-input').value) || 0;

    try {
        let data;

        if (activeOrder) {
            await syncOrderWithCart(activeOrder.id);
            const response = await fetch(`${API_URL}/orders/${activeOrder.id}/checkout`, {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({
                    paymentMethod: splits[0].paymentMethod,
                    paidAmount: total,
                    discountPercentage: discountPercent,
                    customerId,
                    splitInfo: splits
                })
            });
            data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to bill order');
        } else {
            const createRes = await fetch(`${API_URL}/billing/create`, {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({
                    items: cart,
                    customerId,
                    discountPercentage: discountPercent,
                    paymentMethod: splits[0].paymentMethod,
                    paidAmount: total,
                    notes: 'split payment',
                    splitInfo: splits,
                    tableId: document.getElementById('table-select').value || null
                })
            });

            data = await createRes.json();
            if (!createRes.ok) throw new Error(data.error || 'Failed to create bill');
        }

        showToast('Bill split and payment recorded');
        showReceipt(data.bill, 0);
        await resetAfterCheckout();
        closeSplitModal();
    } catch (error) {
        console.error('Split bill error:', error);
        showToast(error.message || 'Failed to process split bill', 'error');
    }
}

// ==================== ORDER MANAGEMENT ====================

function orderStatusLabel(order) {
    const labels = { open: 'Open', sent: 'In Kitchen', served: 'Served', closed: 'Billed', void: 'Void' };
    return labels[order.status] || order.status;
}

function orderStatusClass(order) {
    const classes = { open: 'badge-secondary', sent: 'badge-warning', served: 'badge-info', closed: 'badge-success', void: 'badge-danger' };
    return classes[order.status] || 'badge-secondary';
}

function kitchenStatusLabel(status) {
    return { none: 'None', pending: 'Pending', preparing: 'Preparing', completed: 'Ready' }[status] || status;
}

function kitchenStatusClass(status) {
    return { none: 'badge-secondary', pending: 'badge-warning', preparing: 'badge-info', completed: 'badge-success' }[status] || 'badge-secondary';
}

function tableStatusLabel(status) {
    return { available: 'Available', occupied: 'Occupied', reserved: 'Reserved', maintenance: 'Maintenance' }[status] || status;
}

function tableStatusClass(status) {
    return { available: 'badge-success', occupied: 'badge-danger', reserved: 'badge-warning', maintenance: 'badge-secondary' }[status] || 'badge-secondary';
}

// Items in the cart that have not yet been committed to the order
function getUnsentCartItems() {
    return cart
        .filter(item => !item.voided && (item.quantity || 0) > (item.sentQty || 0))
        .map(item => ({
            productId: item.productId,
            productName: item.productName,
            price: item.price,
            taxRate: item.taxRate || 18,
            quantity: item.quantity - (item.sentQty || 0),
            sendToKitchen: !!item.sendToKitchen,
            station: item.station || 'main'
        }));
}

async function syncOrderWithCart(orderId) {
    const unsent = getUnsentCartItems();
    if (unsent.length === 0) return null;

    const response = await fetch(`${API_URL}/orders/${orderId}/items`, {
        method: 'PUT',
        headers: apiHeaders(),
        body: JSON.stringify({ items: unsent })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to sync order');
    return data;
}

async function sendToKitchen() {
    if (cart.length === 0) {
        showToast('Your cart is empty', 'error');
        return;
    }

    const tableId = document.getElementById('table-select').value;
    if (!tableId) {
        showToast('Select a table to send the order to the kitchen', 'error');
        return;
    }

    const unsent = getUnsentCartItems();
    if (unsent.length === 0) {
        showToast('All items are already sent to the kitchen', 'info');
        return;
    }
    if (!unsent.some(item => item.sendToKitchen)) {
        showToast('Enable "Kitchen" on at least one item to send', 'error');
        return;
    }

    const btn = document.getElementById('send-kitchen-btn');
    btn.disabled = true;

    try {
        let data;

        if (activeOrder) {
            const response = await fetch(`${API_URL}/orders/${activeOrder.id}/items`, {
                method: 'PUT',
                headers: apiHeaders(),
                body: JSON.stringify({ items: unsent })
            });
            data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to send to kitchen');
        } else {
            const response = await fetch(`${API_URL}/orders`, {
                method: 'POST',
                headers: apiHeaders(),
                body: JSON.stringify({ tableId, items: unsent })
            });
            data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to create order');
        }

        if (data.kitchenOrder) {
            showToast(`Sent to kitchen: ${data.kitchenOrder.orderNumber}`);
        } else {
            showToast('Order updated');
        }

        await loadOrderIntoCart(data.order.id);
        await Promise.all([loadTables(), loadOrders()]);
    } catch (error) {
        console.error('Send to kitchen error:', error);
        showToast(error.message || 'Failed to send to kitchen', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function loadOrderIntoCart(orderId) {
    try {
        const response = await fetch(`${API_URL}/orders/${orderId}`, {
            headers: apiHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load order');

        const order = data.order;
        activeOrder = order;

        document.getElementById('table-select').value = order.table_id || '';

        cart = (order.items || []).map(item => ({
            productId: item.productId,
            productName: item.productName,
            price: Number(item.price) || 0,
            taxRate: Number(item.taxRate) || 18,
            quantity: item.quantity,
            sendToKitchen: !!item.sendToKitchen,
            station: item.station || 'main',
            sentQty: item.quantity,
            voided: !!item.voided,
            voidReason: item.voidReason || null
        }));

        updateOrderBanner();
        renderCart();
    } catch (error) {
        console.error('Load order error:', error);
        showToast(error.message || 'Failed to load order', 'error');
    }
}

function updateOrderBanner() {
    const banner = document.getElementById('order-banner');
    if (!activeOrder) {
        banner.hidden = true;
        return;
    }
    banner.hidden = false;
    document.getElementById('order-banner-title').textContent = activeOrder.order_number;
    const badge = document.getElementById('order-banner-status');
    badge.textContent = orderStatusLabel(activeOrder);
    badge.className = `badge ${orderStatusClass(activeOrder)}`;
}

function clearActiveOrder() {
    activeOrder = null;
    updateOrderBanner();
}

function restoreTableSelect() {
    document.getElementById('table-select').value = activeOrder ? (activeOrder.table_id || '') : '';
}

async function onTableChange() {
    const tableId = document.getElementById('table-select').value;

    if (!tableId) {
        if (cart.some(item => (item.sentQty || 0) > 0)) {
            if (!confirm('Switch to walk-in checkout? Items already sent to kitchen will stay on the current order.')) {
                restoreTableSelect();
                return;
            }
        }
        cart = cart.filter(item => (item.sentQty || 0) === 0);
        clearActiveOrder();
        renderCart();
        return;
    }

    // Fetch the live table so we always see its current order
    let liveOrder = null;
    try {
        const response = await fetch(`${API_URL}/tables/${tableId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok && data.table && data.table.activeOrder) {
            liveOrder = data.table.activeOrder;
        }
    } catch (error) {
        console.error('Fetch table error:', error);
    }

    if (liveOrder) {
        if (cart.some(item => (item.sentQty || 0) === 0) && (!activeOrder || activeOrder.id !== liveOrder.id)) {
            if (!confirm(`Load order ${liveOrder.order_number}? Unsent cart items will be discarded.`)) {
                restoreTableSelect();
                return;
            }
        }
        await loadOrderIntoCart(liveOrder.id);
    } else {
        if (cart.some(item => (item.sentQty || 0) === 0)) {
            if (!confirm('Start a new order at this table? Current unsent cart items will be kept for this order.')) {
                restoreTableSelect();
                return;
            }
        }
        clearActiveOrder();
        renderCart();
    }
}

// ==================== TABLES ====================

async function loadTables() {
    try {
        const response = await fetch(`${API_URL}/tables`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            tables = data.tables;
            populateTableSelect();
            if (document.getElementById('tables-page').classList.contains('active')) {
                renderTablesPage();
            }
        }
    } catch (error) {
        console.error('Load tables error:', error);
    }
}

function populateTableSelect() {
    const select = document.getElementById('table-select');
    const current = select.value;
    select.innerHTML = '<option value="">Walk-in (no table)</option>';
    tables.forEach(table => {
        const option = document.createElement('option');
        option.value = table.id;
        option.textContent = `${table.table_number} (${tableStatusLabel(table.status)})`;
        select.appendChild(option);
    });
    if (current && tables.some(t => t.id === current)) {
        select.value = current;
    }
}

function renderTablesPage() {
    const grid = document.getElementById('tables-grid');
    grid.innerHTML = '';
    document.getElementById('tables-empty').hidden = tables.length > 0;

    const counts = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
    tables.forEach(table => {
        if (counts[table.status] != null) counts[table.status]++;
    });

    const stats = [
        { label: 'Available', value: counts.available },
        { label: 'Occupied', value: counts.occupied },
        { label: 'Reserved', value: counts.reserved },
        { label: 'Maintenance', value: counts.maintenance },
        { label: 'Total', value: tables.length }
    ];

    document.getElementById('table-stats').innerHTML = stats.map(s =>
        `<div class="stat-pill"><span>${s.label}</span><strong>${s.value}</strong></div>`
    ).join('');

    tables.forEach(table => {
        const card = document.createElement('div');
        card.className = `table-card ${table.status}`;
        card.onclick = () => viewTable(table.id);

        card.innerHTML = `
            <div class="table-card-top">
                <span class="table-number">${esc(table.table_number)}</span>
                <span class="table-status-badge">${tableStatusLabel(table.status)}</span>
            </div>
            <div class="table-meta">${esc(table.zone || 'main')} | Cap ${table.capacity}</div>
            ${table.activeOrder ? `<div class="table-order">${esc(table.activeOrder.order_number)}</div>` : ''}
        `;

        grid.appendChild(card);
    });
}

function showTableModal(tableId) {
    editingTableId = tableId || null;
    document.getElementById('table-form').reset();
    document.getElementById('table-modal-title').textContent = tableId ? 'Edit Table' : 'Add Table';
    document.getElementById('table-save-btn').textContent = tableId ? 'Save Changes' : 'Save Table';

    if (tableId) {
        const table = tables.find(t => t.id === tableId);
        if (table) {
            document.getElementById('table-id').value = table.id;
            document.getElementById('table-number').value = table.table_number || '';
            document.getElementById('table-capacity').value = table.capacity || 2;
            document.getElementById('table-zone').value = table.zone || '';
            document.getElementById('table-status').value = table.status || 'available';
        }
    }

    document.getElementById('table-modal').classList.add('active');
}

function closeTableModal() {
    document.getElementById('table-modal').classList.remove('active');
    editingTableId = null;
}

async function submitTable(e) {
    e.preventDefault();

    const payload = {
        tableNumber: document.getElementById('table-number').value.trim(),
        capacity: parseInt(document.getElementById('table-capacity').value, 10) || 2,
        zone: document.getElementById('table-zone').value.trim() || 'main',
        status: document.getElementById('table-status').value
    };

    if (!payload.tableNumber) {
        showToast('Table number is required', 'error');
        return;
    }

    const isEdit = !!editingTableId;
    const url = isEdit ? `${API_URL}/tables/${editingTableId}` : `${API_URL}/tables`;
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method,
            headers: apiHeaders(),
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            showToast(isEdit ? 'Table updated' : 'Table added');
            closeTableModal();
            await loadTables();
        } else {
            showToast(data.error || 'Failed to save table', 'error');
        }
    } catch (error) {
        console.error('Save table error:', error);
        showToast('Failed to save table', 'error');
    }
}

async function viewTable(tableId) {
    const table = tables.find(t => t.id === tableId);
    if (!table) return;

    document.getElementById('detail-table-title').textContent = `Table ${table.table_number}`;
    const body = document.getElementById('table-detail-body');
    const order = table.activeOrder;

    let actions = '';
    if (order) {
        actions += `
            <button class="btn btn-primary" onclick="openOrderFromTable('${order.id}')">Open Order</button>
            <button class="btn btn-success" onclick="checkoutOrder('${order.id}')">Checkout</button>
        `;
    } else if (table.status !== 'maintenance') {
        actions += `<button class="btn btn-primary" onclick="startOrderAtTable('${table.id}')">Start Order</button>`;
    }

    if (table.status !== 'occupied') {
        actions += `
            <button class="btn btn-outline" onclick="setTableStatus('${table.id}', 'reserved')">Reserve</button>
            <button class="btn btn-outline" onclick="setTableStatus('${table.id}', 'available')">Available</button>
            <button class="btn btn-outline" onclick="setTableStatus('${table.id}', 'maintenance')">Maintenance</button>
        `;
    }

    actions += `
        <button class="btn btn-outline" onclick="showTableModal('${table.id}')">Edit</button>
        <button class="btn btn-danger" onclick="deleteTable('${table.id}')">Delete</button>
    `;

    body.innerHTML = `
        <div class="detail-grid">
            <div class="detail-item">
                <span class="detail-label">Status</span>
                <span class="badge ${tableStatusClass(table.status)}">${tableStatusLabel(table.status)}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Zone</span>
                <span>${esc(table.zone || 'main')}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Capacity</span>
                <span>${table.capacity} seats</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Active Order</span>
                <span>${order ? esc(order.order_number) : '-'}</span>
            </div>
        </div>
        <div class="table-detail-actions">${actions}</div>
    `;

    document.getElementById('table-detail-modal').classList.add('active');
}

function closeTableDetailModal() {
    document.getElementById('table-detail-modal').classList.remove('active');
}

async function setTableStatus(tableId, status) {
    try {
        const response = await fetch(`${API_URL}/tables/${tableId}/status`, {
            method: 'PUT',
            headers: apiHeaders(),
            body: JSON.stringify({ status })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('Table status updated');
            await loadTables();
            viewTable(tableId);
        } else {
            showToast(data.error || 'Failed to update table status', 'error');
        }
    } catch (error) {
        console.error('Set table status error:', error);
        showToast('Failed to update table status', 'error');
    }
}

async function deleteTable(tableId) {
    const table = tables.find(t => t.id === tableId);
    if (!confirm(`Delete table "${table ? table.table_number : ''}"?`)) return;

    try {
        const response = await fetch(`${API_URL}/tables/${tableId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            showToast('Table deleted');
            closeTableDetailModal();
            await loadTables();
        } else {
            showToast(data.error || 'Failed to delete table', 'error');
        }
    } catch (error) {
        console.error('Delete table error:', error);
        showToast('Failed to delete table', 'error');
    }
}

async function startOrderAtTable(tableId) {
    closeTableDetailModal();
    const table = tables.find(t => t.id === tableId);
    if (!table) return;

    if (table.activeOrder) {
        await loadOrderIntoCart(table.activeOrder.id);
    } else {
        document.getElementById('table-select').value = tableId;
        clearActiveOrder();
        renderCart();
    }
    navigateToPage('billing');
    showToast(`Ordering at ${table.table_number}. Add items, then press "Send to Kitchen".`);
}

async function openOrderFromTable(orderId) {
    closeTableDetailModal();
    await loadOrderIntoCart(orderId);
    navigateToPage('billing');
}

function startNewOrder() {
    const usable = tables.filter(t => t.status === 'available' || t.status === 'reserved');
    if (usable.length === 0) {
        showToast('No available tables. Free one first.', 'error');
        return;
    }
    if (cart.some(item => (item.sentQty || 0) > 0)) {
        if (!confirm('Start a new order? The current order stays on its table.')) return;
    }
    cart = [];
    navigateToPage('billing');
    document.getElementById('table-select').value = '';
    clearActiveOrder();
    renderCart();
    document.getElementById('table-select').focus();
    showToast('Select a table, add items, then press "Send to Kitchen"');
}

// ==================== ORDERS ====================

async function loadOrders() {
    try {
        const response = await fetch(`${API_URL}/orders`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            orders = data.orders;
            renderOrdersPage();
        }
    } catch (error) {
        console.error('Load orders error:', error);
    }
}

function renderOrdersPage() {
    const activeBtn = document.querySelector('#order-filter-tabs button.active');
    const filter = (activeBtn && activeBtn.dataset.filter) || 'all';

    const list = document.getElementById('orders-list');
    list.innerHTML = '';

    const filtered = orders.filter(order => {
        if (filter === 'all') return true;
        if (filter === 'active') return ['open', 'sent', 'served'].includes(order.status);
        return order.status === filter;
    });

    document.getElementById('orders-empty').hidden = filtered.length > 0;

    filtered.forEach(order => list.appendChild(renderOrderCard(order)));
}

function renderOrderCard(order) {
    const card = document.createElement('div');
    card.className = 'order-card';

    const itemsHtml = (order.items || []).slice(0, 6).map(item => `
        <div class="order-item ${item.voided ? 'voided' : ''}">
            <span>${esc(item.productName)}${item.voided ? ' (VOID)' : ''}</span>
            <strong>x${item.quantity}</strong>
        </div>
    `).join('');

    const extra = (order.items || []).length > 6
        ? `<div class="muted small" style="margin-top:6px;">+${order.items.length - 6} more items</div>`
        : '';

    let actions = '';
    if (order.status === 'open' || order.status === 'sent') {
        actions += `<button class="btn btn-primary btn-sm" onclick="openOrderFromTable('${order.id}')">Add Items</button>`;
        if (order.kotCount > 0) {
            actions += `<button class="btn btn-outline btn-sm" onclick="printOrderKots('${order.id}')">Print KOT</button>`;
        }
    }
    if (order.status !== 'closed' && order.status !== 'void') {
        actions += `<button class="btn btn-success btn-sm" onclick="checkoutOrder('${order.id}')">Checkout</button>`;
        if (order.status === 'sent' || order.status === 'open') {
            actions += `<button class="btn btn-outline btn-sm" onclick="updateTableOrderStatus('${order.id}', 'served')">Mark Served</button>`;
            if (order.table_id) {
                actions += `<button class="btn btn-outline btn-sm" onclick="openTransferModal('${order.id}')">Transfer</button>`;
                actions += `<button class="btn btn-outline btn-sm" onclick="openOrderSplitModal('${order.id}')">Split</button>`;
            }
        }
    }
    if (order.status !== 'closed' && order.status !== 'void') {
        actions += `<button class="btn btn-danger btn-sm" onclick="voidOrder('${order.id}')">Void</button>`;
    }

    const customerInfo = order.customer_name
        ? `<span class="order-card-meta">| ${esc(order.customer_name)}</span>`
        : '';

    card.innerHTML = `
        <div class="order-card-header">
            <div>
                <strong>${esc(order.order_number)}</strong>
                <div class="order-card-meta">Table ${esc(order.table_number || '-')} ${customerInfo} | ${new Date(order.created_at).toLocaleTimeString()} | ${formatMoney(order.total_amount)}</div>
            </div>
            <div class="order-card-badges">
                <span class="badge ${orderStatusClass(order)}">${orderStatusLabel(order)}</span>
                ${order.kitchenStatus && order.kitchenStatus !== 'none'
                    ? `<span class="badge ${kitchenStatusClass(order.kitchenStatus)}">Kitchen: ${kitchenStatusLabel(order.kitchenStatus)}</span>`
                    : ''}
            </div>
        </div>
        <div class="order-card-items">${itemsHtml}${extra}</div>
        <div class="order-card-actions">${actions}</div>
    `;

    return card;
}

function printOrderKots(orderId) {
    const listOrder = orders.find(o => o.id === orderId);
    if (!listOrder) return;

    const fetchOrder = listOrder.kots
        ? Promise.resolve(listOrder)
        : fetch(`${API_URL}/orders/${orderId}`, { headers: apiHeaders() })
            .then(r => r.json())
            .then(d => d.order);

    fetchOrder.then(order => {
        const itemsHtml = (order.items || [])
            .filter(i => i.sendToKitchen && !i.voided)
            .map(i => `
                <div style="display:flex;justify-content:space-between;padding:3px 0;">
                    <span>${esc(i.productName)} x ${i.quantity}</span>
                    <span>${esc(i.station || 'main')}</span>
                </div>
            `).join('');

        const win = window.open('', '_blank', 'width=320,height=500');
        if (!win) {
            showToast('Pop-up blocked. Allow pop-ups to print.', 'error');
            return;
        }
        win.document.write(`
            <html><head><title>KOT - ${esc(order.order_number)}</title>
            <style>
                body { font-family: monospace; padding: 20px; color: #000; }
                .h { text-align: center; margin-bottom: 12px; }
                .muted { color: #555; font-size: 12px; }
            </style></head>
            <body>
                <div class="h">
                    <strong>KITCHEN ORDER</strong><br>
                    <span>${esc(order.order_number)}</span><br>
                    ${order.table_number ? `<span class="muted">Table ${esc(order.table_number)}</span>` : ''}<br>
                    <span class="muted">${new Date(order.created_at).toLocaleString()}</span>
                </div>
                <hr>
                ${itemsHtml || '<p>No kitchen items</p>'}
                ${order.notes ? `<div class="muted" style="margin-top:10px;">Note: ${esc(order.notes)}</div>` : ''}
            </body></html>
        `);
        win.document.close();
        win.print();
    }).catch(() => showToast('Failed to load order for printing', 'error'));
}

async function checkoutOrder(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    closeTableDetailModal();
    await loadOrderIntoCart(orderId);
    navigateToPage('billing');
    showToast('Order loaded. Review items and press Checkout.');
}

async function updateTableOrderStatus(orderId, status) {
    try {
        const response = await fetch(`${API_URL}/orders/${orderId}/status`, {
            method: 'PUT',
            headers: apiHeaders(),
            body: JSON.stringify({ status })
        });

        const data = await response.json();

        if (response.ok) {
            showToast(`Order marked as ${orderStatusLabel({ status })}`);
            await Promise.all([loadOrders(), loadTables()]);
        } else {
            showToast(data.error || 'Failed to update order', 'error');
        }
    } catch (error) {
        console.error('Update order status error:', error);
        showToast('Failed to update order', 'error');
    }
}

async function voidOrder(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!confirm(`Void order ${order ? order.order_number : ''}? Kitchen tickets will be cancelled and the table freed.`)) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/orders/${orderId}/status`, {
            method: 'PUT',
            headers: apiHeaders(),
            body: JSON.stringify({ status: 'void' })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('Order voided');
            await Promise.all([loadOrders(), loadTables()]);
            if (activeOrder && activeOrder.id === orderId) {
                cart = [];
                clearActiveOrder();
                renderCart();
            }
        } else {
            showToast(data.error || 'Failed to void order', 'error');
        }
    } catch (error) {
        console.error('Void order error:', error);
        showToast('Failed to void order', 'error');
    }
}

// ==================== ORDER TRANSFER & SPLIT ====================

let transferOrderId = null;
let splitOrderId = null;

function openTransferModal(orderId) {
    transferOrderId = orderId;
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const select = document.getElementById('transfer-table');
    select.innerHTML = '';
    const available = tables.filter(t => t.id !== order.table_id && t.status !== 'occupied');
    if (available.length === 0) {
        showToast('No available tables to transfer to', 'error');
        return;
    }
    available.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.table_number} (${t.zone})`;
        select.appendChild(opt);
    });

    document.getElementById('transfer-modal-title').textContent = `Transfer ${order.order_number}`;
    document.getElementById('transfer-modal').classList.add('active');
}

function closeTransferModal() {
    document.getElementById('transfer-modal').classList.remove('active');
    transferOrderId = null;
}

async function confirmTransfer() {
    const targetTableId = document.getElementById('transfer-table').value;
    if (!targetTableId) {
        showToast('Select a target table', 'error');
        return;
    }
    const btn = document.querySelector('#transfer-modal .modal-footer .btn-primary');
    btn.disabled = true;
    try {
        const response = await fetch(`${API_URL}/orders/${transferOrderId}/transfer`, {
            method: 'PUT',
            headers: apiHeaders(),
            body: JSON.stringify({ targetTableId })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Transfer failed');
        showToast(data.message);
        closeTransferModal();
        await Promise.all([loadOrders(), loadTables()]);
    } catch (error) {
        console.error('Transfer error:', error);
        showToast(error.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

function openOrderSplitModal(orderId) {
    splitOrderId = orderId;
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const select = document.getElementById('split-target-table');
    select.innerHTML = '<option value="">Walk-in (no table)</option>';
    tables.forEach(t => {
        if (t.id === order.table_id || t.status === 'occupied') return;
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.table_number} (${t.zone})`;
        select.appendChild(opt);
    });

    const container = document.getElementById('order-split-items');
    container.innerHTML = '';
    const movable = (order.items || []).filter(i => !i.voided && !i.sendToKitchen);
    if (movable.length === 0) {
        container.innerHTML = '<p class="muted small">No items can be split. Only items not yet sent to the kitchen are movable.</p>';
        return;
    }
    movable.forEach(item => {
        const row = document.createElement('div');
        row.className = 'split-item-row';
        row.innerHTML = `
            <label class="split-check">
                <input type="checkbox" checked value="${esc(item.productId)}">
                <span>${esc(item.productName)}</span>
            </label>
            <input type="number" class="split-qty" min="1" max="${item.quantity}" value="${item.quantity}" data-product="${esc(item.productId)}">
            <span class="muted small">max ${item.quantity}</span>
        `;
        container.appendChild(row);
    });

    document.getElementById('order-split-modal').classList.add('active');
}

function closeOrderSplitModal() {
    document.getElementById('order-split-modal').classList.remove('active');
    splitOrderId = null;
}

async function confirmOrderSplit() {
    if (!splitOrderId) return;

    const items = [];
    document.querySelectorAll('#order-split-items .split-item-row').forEach(row => {
        const checkbox = row.querySelector('input[type=checkbox]');
        if (checkbox && checkbox.checked) {
            const qty = parseInt(row.querySelector('.split-qty').value, 10) || 0;
            if (qty > 0) items.push({ productId: checkbox.value, quantity: qty });
        }
    });
    if (items.length === 0) {
        showToast('Select at least one item to move', 'error');
        return;
    }

    const targetTableId = document.getElementById('split-target-table').value;
    const btn = document.querySelector('#order-split-modal .modal-footer .btn-primary');
    btn.disabled = true;
    try {
        const response = await fetch(`${API_URL}/orders/${splitOrderId}/split`, {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({ targetTableId, items })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Split failed');
        showToast(data.message);
        closeOrderSplitModal();
        await Promise.all([loadOrders(), loadTables()]);
    } catch (error) {
        console.error('Split error:', error);
        showToast(error.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ==================== INVENTORY ====================

async function loadInventory() {
    try {
        const url = lowStockOnly
            ? `${API_URL}/inventory/products?lowStock=true`
            : `${API_URL}/inventory/products`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            allInventory = data.products;
            renderInventoryTable();
        }
    } catch (error) {
        console.error('Load inventory error:', error);
    }
}

function renderInventoryTable() {
    const tbody = document.getElementById('inventory-table');
    tbody.innerHTML = '';

    allInventory.forEach(product => {
        const stock = product.stock_quantity || 0;
        const reorder = product.reorder_level || 0;
        const status = stock <= 0
            ? '<span class="badge badge-danger">Out of Stock</span>'
            : stock <= reorder
                ? '<span class="badge badge-warning">Low Stock</span>'
                : '<span class="badge badge-success">In Stock</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${esc(product.name)}</strong></td>
            <td>${esc(product.barcode) || '-'}</td>
            <td>${esc(product.category) || '-'}</td>
            <td>${formatMoney(product.price)}</td>
            <td class="${stock <= reorder ? 'text-danger' : ''}">${stock}</td>
            <td>${status}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="showProductModal('${product.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteProduct('${product.id}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterInventory(query) {
    const q = query.toLowerCase();
    const filtered = allInventory.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q))
    );

    const tbody = document.getElementById('inventory-table');
    tbody.innerHTML = '';

    filtered.forEach(product => {
        const stock = product.stock_quantity || 0;
        const status = stock <= 0
            ? '<span class="badge badge-danger">Out of Stock</span>'
            : stock <= (product.reorder_level || 0)
                ? '<span class="badge badge-warning">Low Stock</span>'
                : '<span class="badge badge-success">In Stock</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${esc(product.name)}</strong></td>
            <td>${esc(product.barcode) || '-'}</td>
            <td>${esc(product.category) || '-'}</td>
            <td>${formatMoney(product.price)}</td>
            <td>${stock}</td>
            <td>${status}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="showProductModal('${product.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteProduct('${product.id}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleLowStock() {
    lowStockOnly = !lowStockOnly;
    const btn = document.getElementById('low-stock-btn');
    btn.textContent = lowStockOnly ? 'Show All' : 'Show Low Stock';
    btn.classList.toggle('btn-primary', lowStockOnly);
    btn.classList.toggle('btn-outline', !lowStockOnly);
    loadInventory();
}

function showProductModal(productId) {
    editingProductId = productId || null;
    document.getElementById('product-form').reset();
    document.getElementById('product-modal-title').textContent = productId ? 'Edit Product' : 'Add Product';
    document.getElementById('product-save-btn').textContent = productId ? 'Save Changes' : 'Save Product';

    if (productId) {
        const product = allInventory.find(p => p.id === productId) || products.find(p => p.id === productId);
        if (product) {
            document.getElementById('product-id').value = product.id;
            document.getElementById('product-name').value = product.name || '';
            document.getElementById('product-barcode').value = product.barcode || '';
            document.getElementById('product-category').value = product.category || '';
            document.getElementById('product-unit').value = product.unit || 'pcs';
            document.getElementById('product-price').value = product.price || '';
            document.getElementById('product-cost').value = product.cost_price || '';
            document.getElementById('product-tax').value = product.tax_rate || 18;
            document.getElementById('product-stock').value = product.stock_quantity || 0;
            document.getElementById('product-reorder').value = product.reorder_level || 10;
        }
    }

    document.getElementById('product-modal').classList.add('active');
}

function closeProductModal() {
    document.getElementById('product-modal').classList.remove('active');
    editingProductId = null;
}

async function submitProduct(e) {
    e.preventDefault();

    const payload = {
        name: document.getElementById('product-name').value.trim(),
        barcode: document.getElementById('product-barcode').value.trim() || null,
        category: document.getElementById('product-category').value.trim() || null,
        unit: document.getElementById('product-unit').value.trim() || 'pcs',
        price: parseFloat(document.getElementById('product-price').value) || 0,
        costPrice: parseFloat(document.getElementById('product-cost').value) || 0,
        taxRate: parseFloat(document.getElementById('product-tax').value) || 18,
        stockQuantity: parseInt(document.getElementById('product-stock').value, 10) || 0,
        reorderLevel: parseInt(document.getElementById('product-reorder').value, 10) || 10
    };

    if (!payload.name) {
        showToast('Product name is required', 'error');
        return;
    }

    const isEdit = !!editingProductId;
    const url = isEdit
        ? `${API_URL}/inventory/products/${editingProductId}`
        : `${API_URL}/inventory/products`;
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, {
            method,
            headers: apiHeaders(),
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            showToast(isEdit ? 'Product updated' : 'Product added');
            closeProductModal();
            await Promise.all([loadInventory(), loadProducts()]);
        } else {
            showToast(data.error || 'Failed to save product', 'error');
        }
    } catch (error) {
        console.error('Save product error:', error);
        showToast('Failed to save product', 'error');
    }
}

async function deleteProduct(productId) {
    const product = allInventory.find(p => p.id === productId);
    if (!confirm(`Delete product "${product ? product.name : ''}"? This cannot be undone.`)) return;

    try {
        const response = await fetch(`${API_URL}/inventory/products/${productId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            showToast('Product deleted');
            await Promise.all([loadInventory(), loadProducts()]);
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to delete product', 'error');
        }
    } catch (error) {
        console.error('Delete product error:', error);
        showToast('Failed to delete product', 'error');
    }
}

// ==================== KITCHEN ====================

async function loadKitchenOrders() {
    try {
        let url = `${API_URL}/kitchen/orders?status=pending,preparing`;
        if (kitchenStation !== 'all') url += `&station=${encodeURIComponent(kitchenStation)}`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            renderKitchenBoard(data.orders);
        }
    } catch (error) {
        console.error('Load kitchen orders error:', error);
    }
}

function kotElapsedHtml(order) {
    const created = new Date(order.created_at).getTime();
    const mins = Math.max(0, Math.floor((Date.now() - created) / 60000));
    return `
        <span class="kot-elapsed" data-created="${created}" title="Time since order was placed">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span class="kot-elapsed-text">${mins}m</span>
        </span>
    `;
}

function refreshKotTimers() {
    document.querySelectorAll('.kot-elapsed').forEach(el => {
        const created = parseInt(el.getAttribute('data-created'), 10);
        if (isNaN(created)) return;
        const mins = Math.max(0, Math.floor((Date.now() - created) / 60000));
        const text = el.querySelector('.kot-elapsed-text');
        if (text) text.textContent = `${mins}m`;
        el.classList.toggle('stale', mins >= 15);
    });
}

function renderKitchenBoard(orders) {
    const board = document.getElementById('kds-board');
    board.innerHTML = '';
    document.getElementById('kitchen-empty').hidden = orders.length > 0;

    orders.forEach(order => {
        const card = document.createElement('div');
        card.className = `kot-card ${order.status}`;

        const itemsHtml = (order.items || []).map(item => {
            const voided = item.voided;
            return `
                <div class="kot-item ${voided ? 'voided' : ''}">
                    <span>${esc(item.productName || item.name)}${voided ? ' (VOID)' : ''}</span>
                    <strong>x${item.quantity}</strong>
                </div>
            `;
        }).join('');

        const notes = order.notes
            ? `<div class="kot-notes">Note: ${esc(order.notes)}</div>`
            : '';

        card.innerHTML = `
            <div class="kot-header">
                <span class="kot-number">${esc(order.order_number)}</span>
                <span class="kot-station">${esc(order.station || 'main')}</span>
                ${order.table_number ? `<span class="kot-table-badge">Table ${esc(order.table_number)}</span>` : ''}
                ${kotElapsedHtml(order)}
            </div>
            ${notes}
            <div class="kot-items">${itemsHtml}</div>
            <div class="kot-actions">
                ${order.status === 'pending'
                    ? `<button class="btn btn-primary" onclick="updateOrderStatus('${order.id}', 'preparing')">Start Preparing</button>`
                    : `<button class="btn btn-success" onclick="updateOrderStatus('${order.id}', 'completed')">Mark Ready</button>`}
                <button class="btn btn-outline" onclick="printKot('${order.id}')">Print</button>
            </div>
        `;

        board.appendChild(card);
    });
    refreshKotTimers();
}

function printKot(kotId) {
    const fetchUrl = `${API_URL}/kitchen/orders/${kotId}`;
    fetch(fetchUrl, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
            const kot = data.order || data;
            const itemsHtml = (kot.items || []).map(i => `
                <div style="display:flex;justify-content:space-between;padding:3px 0;">
                    <span>${i.productName || i.name} x ${i.quantity}</span>
                    <span></span>
                </div>
            `).join('');

            const win = window.open('', '_blank', 'width=320,height=500');
            if (!win) {
                showToast('Pop-up blocked. Allow pop-ups to print.', 'error');
                return;
            }
            win.document.write(`
                <html><head><title>KOT</title>
                <style>
                    body { font-family: monospace; padding: 20px; color: #000; }
                    .h { text-align: center; margin-bottom: 12px; }
                    .row { display: flex; justify-content: space-between; padding: 3px 0; }
                    .muted { color: #555; font-size: 12px; }
                </style></head>
                <body>
                    <div class="h">
                        <strong>KITCHEN ORDER</strong><br>
                        <span class="muted">${esc(kot.order_number)}</span><br>
                        ${kot.table_number ? `<span class="muted">Table ${esc(kot.table_number)}</span>` : ''}<br>
                        <span class="muted">${new Date(kot.created_at).toLocaleString()}</span>
                    </div>
                    <hr>
                    ${itemsHtml}
                    ${kot.notes ? `<div class="muted" style="margin-top:10px;">Note: ${esc(kot.notes)}</div>` : ''}
                </body></html>
            `);
            win.document.close();
            win.print();
        })
        .catch(() => showToast('Failed to load KOT for printing', 'error'));
}

async function updateOrderStatus(orderId, status) {
    try {
        const response = await fetch(`${API_URL}/kitchen/orders/${orderId}/status`, {
            method: 'PUT',
            headers: apiHeaders(),
            body: JSON.stringify({ status })
        });

        if (response.ok) {
            showToast(status === 'completed' ? 'Order marked ready' : 'Order in progress', 'info');
            loadKitchenOrders();
        }
    } catch (error) {
        console.error('Update order status error:', error);
        showToast('Failed to update order', 'error');
    }
}

// ==================== CUSTOMERS ====================

async function loadCustomers() {
    try {
        const response = await fetch(`${API_URL}/customers`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            customers = data.customers;
            renderCustomersTable();
            populateCustomerSelect();
        }
    } catch (error) {
        console.error('Load customers error:', error);
    }
}

function renderCustomersTable() {
    const tbody = document.getElementById('customers-table');
    tbody.innerHTML = '';

    customers.forEach(customer => {
        const tr = document.createElement('tr');
        const membershipClass = customer.membership_type === 'Gold'
            ? 'badge-warning'
            : customer.membership_type === 'Platinum'
                ? 'badge-info'
                : 'badge-success';

        tr.innerHTML = `
            <td><strong>${esc(customer.name)}</strong></td>
            <td>${esc(customer.phone) || '-'}</td>
            <td>${esc(customer.email) || '-'}</td>
            <td>${customer.loyalty_points || 0}</td>
            <td><span class="badge ${membershipClass}">${esc(customer.membership_type || 'regular')}</span></td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="viewCustomer('${customer.id}')">View</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function populateCustomerSelect() {
    const select = document.getElementById('customer-select');
    const current = select.value;
    select.innerHTML = '<option value="">Walk-in customer</option>';
    customers.forEach(customer => {
        const option = document.createElement('option');
        option.value = customer.id;
        option.textContent = `${customer.name}${customer.phone ? ` - ${customer.phone}` : ''}`;
        select.appendChild(option);
    });
    if (current) select.value = current;
}

function filterCustomers(query) {
    const q = query.toLowerCase();
    const filtered = customers.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
    );

    const tbody = document.getElementById('customers-table');
    tbody.innerHTML = '';

    filtered.forEach(customer => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${esc(customer.name)}</strong></td>
            <td>${esc(customer.phone) || '-'}</td>
            <td>${esc(customer.email) || '-'}</td>
            <td>${customer.loyalty_points || 0}</td>
            <td><span class="badge badge-success">${esc(customer.membership_type || 'regular')}</span></td>
            <td><button class="btn btn-outline btn-sm" onclick="viewCustomer('${customer.id}')">View</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function showCustomerModal() {
    document.getElementById('customer-form').reset();
    document.getElementById('customer-modal').classList.add('active');
}

function closeCustomerModal() {
    document.getElementById('customer-modal').classList.remove('active');
}

async function submitCustomer(e) {
    e.preventDefault();

    const payload = {
        name: document.getElementById('customer-name').value.trim(),
        phone: document.getElementById('customer-phone').value.trim() || null,
        email: document.getElementById('customer-email').value.trim() || null,
        birthday: document.getElementById('customer-birthday').value || null,
        address: document.getElementById('customer-address').value.trim() || null,
        notes: document.getElementById('customer-notes').value.trim() || null
    };

    if (!payload.name) {
        showToast('Customer name is required', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/customers`, {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            showToast('Customer added');
            closeCustomerModal();
            await loadCustomers();
        } else {
            showToast(data.error || 'Failed to add customer', 'error');
        }
    } catch (error) {
        console.error('Add customer error:', error);
        showToast('Failed to add customer', 'error');
    }
}

async function viewCustomer(customerId) {
    try {
        const response = await fetch(`${API_URL}/customers/${customerId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            renderCustomerDetail(data.customer);
            document.getElementById('customer-detail-modal').classList.add('active');
        } else {
            showToast(data.error || 'Could not load customer', 'error');
        }
    } catch (error) {
        console.error('View customer error:', error);
        showToast('Failed to load customer details', 'error');
    }
}

function renderCustomerDetail(customer) {
    document.getElementById('detail-customer-name').textContent = customer.name;

    const history = (customer.purchaseHistory || []);
    const loyalty = (customer.loyaltyTransactions || []);

    const historyHtml = history.length === 0
        ? '<p class="muted small">No purchase history yet.</p>'
        : `<table class="data-table compact">
            <thead>
                <tr><th>Bill</th><th>Date</th><th>Amount</th><th>Payment</th></tr>
            </thead>
            <tbody>
                ${history.map(b => `
                    <tr>
                        <td>${esc(b.bill_number)}</td>
                        <td>${new Date(b.created_at).toLocaleDateString()}</td>
                        <td>${formatMoney(b.total_amount)}</td>
                        <td>${esc(b.payment_method || '-')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;

    const loyaltyHtml = loyalty.length === 0
        ? '<p class="muted small">No loyalty activity yet.</p>'
        : `<table class="data-table compact">
            <thead>
                <tr><th>Points</th><th>Type</th><th>Description</th><th>Date</th></tr>
            </thead>
            <tbody>
                ${loyalty.map(t => `
                    <tr>
                        <td class="${t.points < 0 ? 'text-danger' : ''}">${t.points > 0 ? '+' : ''}${t.points}</td>
                        <td>${esc(t.transaction_type)}</td>
                        <td>${esc(t.description || '-')}</td>
                        <td>${new Date(t.created_at).toLocaleDateString()}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;

    document.getElementById('customer-detail-body').innerHTML = `
        <div class="detail-grid">
            <div class="detail-item">
                <span class="detail-label">Phone</span>
                <span>${esc(customer.phone) || '-'}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Email</span>
                <span>${esc(customer.email) || '-'}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Membership</span>
                <span class="badge badge-warning">${esc(customer.membership_type || 'regular')}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Loyalty Points</span>
                <span>${customer.loyalty_points || 0}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Total Purchases</span>
                <span>${formatMoney(customer.total_purchases)}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Address</span>
                <span>${esc(customer.address) || '-'}</span>
            </div>
        </div>
        <h4 style="margin: 20px 0 10px;">Purchase History</h4>
        ${historyHtml}
        <h4 style="margin: 20px 0 10px;">Loyalty Activity</h4>
        ${loyaltyHtml}
    `;
}

function closeCustomerDetailModal() {
    document.getElementById('customer-detail-modal').classList.remove('active');
}

// ==================== EMPLOYEES ====================

async function loadEmployees() {
    try {
        const response = await fetch(`${API_URL}/employees`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            employees = data.employees;
            renderEmployeesTable();
            populateAttendanceSelect();
        }
    } catch (error) {
        console.error('Load employees error:', error);
    }
}

function renderEmployeesTable() {
    const tbody = document.getElementById('employees-table');
    tbody.innerHTML = '';

    employees.forEach(emp => {
        const tr = document.createElement('tr');
        const statusClass = emp.attendance_status === 'present' ? 'badge-success' : 'badge-secondary';
        tr.innerHTML = `
            <td><strong>${esc(emp.name)}</strong></td>
            <td>${esc(emp.role)}</td>
            <td>${esc(emp.phone) || '-'}</td>
            <td>${formatMoney(emp.salary)}</td>
            <td><span class="badge ${statusClass}">${esc(emp.attendance_status || 'absent')}</span></td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="viewEmployee('${emp.id}')">View</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function populateAttendanceSelect() {
    const select = document.getElementById('attendance-employee');
    select.innerHTML = '<option value="">Select employee...</option>';
    employees.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = emp.name;
        select.appendChild(option);
    });
}

function toggleAttendancePanel() {
    const panel = document.getElementById('attendance-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) populateAttendanceSelect();
}

async function markAttendance() {
    const employeeId = document.getElementById('attendance-employee').value;
    const type = document.getElementById('attendance-type').value;

    if (!employeeId) {
        showToast('Select an employee first', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/employees/attendance`, {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({ employeeId, type })
        });

        const data = await response.json();

        if (response.ok) {
            showToast(data.message || `Attendance marked (${type})`);
            document.getElementById('attendance-panel').hidden = true;
            loadEmployees();
        } else {
            showToast(data.error || 'Failed to mark attendance', 'error');
        }
    } catch (error) {
        console.error('Mark attendance error:', error);
        showToast('Failed to mark attendance', 'error');
    }
}

async function viewEmployee(employeeId) {
    try {
        const response = await fetch(`${API_URL}/employees/${employeeId}/performance`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            const perf = data.performance;
            showToast(`${perf.employee.name}: ${perf.totalSales ? formatMoney(perf.totalSales) : 'Rs 0.00'} in sales, ${perf.billsHandled || 0} bills`);
        } else {
            showToast(data.error || 'Could not load employee', 'error');
        }
    } catch (error) {
        console.error('View employee error:', error);
        showToast('Failed to load employee details', 'error');
    }
}

// ==================== REPORTS ====================

function destroyReportChart() {
    if (reportChart) {
        reportChart.destroy();
        reportChart = null;
    }
}

async function loadReport(type) {
    document.querySelectorAll('.report-tabs button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.report === type);
    });

    const content = document.getElementById('report-content');
    content.innerHTML = '<div class="empty-state"><p>Loading report...</p></div>';
    destroyReportChart();

    const endpoints = {
        daily: '/sales/daily',
        weekly: '/sales/weekly',
        monthly: '/sales/monthly',
        profit: '/profit',
        tax: '/tax',
        orders: '/orders'
    };

    try {
        const response = await fetch(`${API_URL}/reports${endpoints[type]}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (!response.ok) {
            content.innerHTML = `<div class="empty-state"><p>${esc(data.error || 'Failed to load report')}</p></div>`;
            return;
        }

        switch (type) {
            case 'daily':
                renderDailyReport(data.report);
                break;
            case 'weekly':
                renderWeeklyReport(data.report);
                break;
            case 'monthly':
                renderMonthlyReport(data.report);
                break;
            case 'profit':
                renderProfitReport(data.report);
                break;
            case 'tax':
                renderTaxReport(data.report);
                break;
            case 'orders':
                renderOrdersReport(data.report);
                break;
        }
    } catch (error) {
        console.error('Load report error:', error);
        content.innerHTML = '<div class="empty-state"><p>Failed to load report.</p></div>';
    }
}

function renderDailyReport(report) {
    const summary = report.summary || {};
    const content = document.getElementById('report-content');

    const stats = [
        { label: 'Transactions', value: summary.totalTransactions || 0 },
        { label: 'Total Sales', value: formatMoney(summary.totalSales) },
        { label: 'Cash', value: formatMoney(summary.cashSales) },
        { label: 'Card', value: formatMoney(summary.cardSales) },
        { label: 'UPI', value: formatMoney(summary.upiSales) },
        { label: 'Wallet', value: formatMoney(summary.walletSales) },
        { label: 'Avg Transaction', value: formatMoney(summary.averageTransaction) }
    ];

    const topProducts = (report.topProducts || []);

    content.innerHTML = `
        <h3>Daily Sales Report <span class="muted small">${esc(report.date || '')}</span></h3>
        <div class="report-stats">
            ${stats.map(s => `<div class="stat-pill"><span>${s.label}</span><strong>${s.value}</strong></div>`).join('')}
        </div>
        <h4 style="margin: 20px 0 10px;">Top Products</h4>
        ${topProducts.length === 0
            ? '<p class="muted small">No sales recorded today.</p>'
            : `<div class="table-wrap">
                <table class="data-table compact">
                    <thead><tr><th>Product</th><th>Quantity Sold</th><th>Revenue</th></tr></thead>
                    <tbody>
                        ${topProducts.map(p => `
                            <tr>
                                <td>${esc(p.name)}</td>
                                <td>${p.quantitySold}</td>
                                <td>${formatMoney(p.revenue)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`}
    `;
}

function renderWeeklyReport(report) {
    const data = report.data || [];
    const content = document.getElementById('report-content');

    content.innerHTML = `
        <h3>Weekly Sales Report</h3>
        <div class="chart-container"><canvas id="reportChart"></canvas></div>
        ${data.length === 0
            ? '<p class="muted small">No sales recorded in the last 7 days.</p>'
            : `<div class="table-wrap">
                <table class="data-table compact">
                    <thead><tr><th>Date</th><th>Transactions</th><th>Total Sales</th></tr></thead>
                    <tbody>
                        ${data.map(d => `
                            <tr>
                                <td>${esc(d.date)}</td>
                                <td>${d.transactions}</td>
                                <td>${formatMoney(d.totalSales)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`}
    `;

    if (data.length) {
        reportChart = new Chart(document.getElementById('reportChart'), {
            type: 'bar',
            data: {
                labels: data.map(d => d.date),
                datasets: [{
                    label: 'Sales',
                    data: data.map(d => d.totalSales),
                    backgroundColor: 'rgba(79, 70, 229, 0.7)',
                    borderColor: '#4f46e5',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }
}

function renderMonthlyReport(report) {
    const summary = report.summary || {};
    const breakdown = report.dailyBreakdown || [];
    const content = document.getElementById('report-content');

    content.innerHTML = `
        <h3>Monthly Sales Report <span class="muted small">${esc(report.month || '')}</span></h3>
        <div class="report-stats">
            <div class="stat-pill"><span>Transactions</span><strong>${summary.totalTransactions || 0}</strong></div>
            <div class="stat-pill"><span>Total Sales</span><strong>${formatMoney(summary.totalSales)}</strong></div>
            <div class="stat-pill"><span>Discounts</span><strong>${formatMoney(summary.totalDiscounts)}</strong></div>
            <div class="stat-pill"><span>Tax Collected</span><strong>${formatMoney(summary.totalTax)}</strong></div>
        </div>
        <div class="chart-container"><canvas id="reportChart"></canvas></div>
    `;

    if (breakdown.length) {
        reportChart = new Chart(document.getElementById('reportChart'), {
            type: 'line',
            data: {
                labels: breakdown.map(d => d.date),
                datasets: [{
                    label: 'Daily Sales',
                    data: breakdown.map(d => d.totalSales),
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    } else {
        content.innerHTML += '<p class="muted small">No sales recorded this month.</p>';
    }
}

function renderProfitReport(report) {
    const margin = Number(report.profitMargin) || 0;
    const content = document.getElementById('report-content');

    const stats = [
        { label: 'Revenue', value: formatMoney(report.revenue) },
        { label: 'Cost of Goods Sold', value: formatMoney(report.costOfGoodsSold) },
        { label: 'Profit', value: formatMoney(report.profit) },
        { label: 'Profit Margin', value: `${margin}%` }
    ];

    content.innerHTML = `
        <h3>Profit Report</h3>
        <div class="report-stats">
            ${stats.map(s => `<div class="stat-pill"><span>${s.label}</span><strong>${s.value}</strong></div>`).join('')}
        </div>
    `;
}

function renderTaxReport(report) {
    const breakdown = report.taxBreakdown || [];
    const content = document.getElementById('report-content');

    content.innerHTML = `
        <h3>Tax Report (GST)</h3>
        <div class="report-stats">
            <div class="stat-pill"><span>Total Tax Collected</span><strong>${formatMoney(report.totalTaxCollected)}</strong></div>
        </div>
        ${breakdown.length === 0
            ? '<p class="muted small">No tax data available.</p>'
            : `<div class="table-wrap">
                <table class="data-table compact">
                    <thead><tr><th>Tax Rate</th><th>Taxable Amount</th><th>Tax Amount</th></tr></thead>
                    <tbody>
                        ${breakdown.map(row => `
                            <tr>
                                <td>${row.taxRate}%</td>
                                <td>${formatMoney(row.taxableAmount)}</td>
                                <td>${formatMoney(row.totalTax)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`}
    `;
}

function renderOrdersReport(report) {
    const summary = report.summary || {};
    const byTable = report.byTable || [];
    const byZone = report.byZone || [];
    const prepTime = report.prepTime || {};
    const kitchenVolume = report.kitchenVolume || [];
    const content = document.getElementById('report-content');

    const stats = [
        { label: 'Total Orders', value: summary.totalOrders || 0 },
        { label: 'Revenue', value: formatMoney(summary.totalRevenue) },
        { label: 'Avg Order Value', value: formatMoney(summary.averageOrderValue) },
        { label: 'Avg Prep Time', value: `${Math.round(Number(prepTime.avgMinutes) || 0)} min` }
    ];

    content.innerHTML = `
        <h3>Orders Report</h3>
        <div class="report-stats">
            ${stats.map(s => `<div class="stat-pill"><span>${s.label}</span><strong>${s.value}</strong></div>`).join('')}
        </div>
        <h4 style="margin: 20px 0 10px;">Sales by Table</h4>
        ${byTable.length === 0
            ? '<p class="muted small">No billed orders yet.</p>'
            : `<div class="table-wrap">
                <table class="data-table compact">
                    <thead><tr><th>Table</th><th>Orders</th><th>Revenue</th></tr></thead>
                    <tbody>
                        ${byTable.map(row => `
                            <tr>
                                <td>${esc(row.tableNumber)}</td>
                                <td>${row.orderCount}</td>
                                <td>${formatMoney(row.revenue)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`}
        <h4 style="margin: 20px 0 10px;">Sales by Zone</h4>
        ${byZone.length === 0
            ? '<p class="muted small">No zones configured.</p>'
            : `<div class="table-wrap">
                <table class="data-table compact">
                    <thead><tr><th>Zone</th><th>Orders</th><th>Revenue</th></tr></thead>
                    <tbody>
                        ${byZone.map(row => `
                            <tr>
                                <td>${esc(row.zone)}</td>
                                <td>${row.orderCount}</td>
                                <td>${formatMoney(row.revenue)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`}
        <h4 style="margin: 20px 0 10px;">Kitchen Volume by Station</h4>
        ${kitchenVolume.length === 0
            ? '<p class="muted small">No kitchen tickets yet.</p>'
            : `<div class="table-wrap">
                <table class="data-table compact">
                    <thead><tr><th>Station</th><th>Tickets</th><th>Completed</th></tr></thead>
                    <tbody>
                        ${kitchenVolume.map(row => `
                            <tr>
                                <td>${esc(row.station)}</td>
                                <td>${row.ticketCount}</td>
                                <td>${row.completed}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`}
    `;
}

// ==================== SETTINGS ====================

async function loadSettings() {
    try {
        const response = await fetch(`${API_URL}/settings`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            appSettings = data.settings || {};
            document.getElementById('store-name').value = appSettings.company_name || '';
            document.getElementById('gst-number').value = appSettings.gst_number || '';
            document.getElementById('invoice-prefix').value = appSettings.invoice_prefix || 'INV';
            document.getElementById('gst-rate').value = appSettings.gst_rate || 18;
            document.getElementById('currency').value = appSettings.currency || 'INR';
        }
    } catch (error) {
        console.error('Load settings error:', error);
    }
}

async function saveSettings(e) {
    e.preventDefault();

    const payload = {
        company_name: document.getElementById('store-name').value.trim(),
        gst_number: document.getElementById('gst-number').value.trim(),
        invoice_prefix: document.getElementById('invoice-prefix').value.trim() || 'INV',
        gst_rate: document.getElementById('gst-rate').value || '18',
        currency: document.getElementById('currency').value
    };

    try {
        const response = await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: apiHeaders(),
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            appSettings = Object.assign(appSettings, payload);
            showToast('Settings saved');
            renderCart();
        } else {
            showToast(data.error || 'Failed to save settings', 'error');
        }
    } catch (error) {
        console.error('Save settings error:', error);
        showToast('Failed to save settings', 'error');
    }
}

async function loadLoginLogs() {
    const container = document.getElementById('login-logs');
    if (!container) return;
    try {
        const response = await fetch(`${API_URL}/auth/login-logs`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) {
            container.innerHTML = `<p class="muted small">${esc(data.error || 'Failed to load login logs')}</p>`;
            return;
        }
        const logs = data.logs || [];
        if (logs.length === 0) {
            container.innerHTML = '<p class="muted small">No login attempts recorded yet.</p>';
            return;
        }
        container.innerHTML = `
            <div class="table-wrap">
                <table class="data-table compact">
                    <thead><tr><th>User</th><th>Status</th><th>Time</th><th>IP</th><th>Device</th></tr></thead>
                    <tbody>
                        ${logs.map(log => `
                            <tr>
                                <td>${esc(log.username || '-')}</td>
                                <td>${log.success ? '<span class="log-status success">Success</span>' : '<span class="log-status fail">Failed</span>'}</td>
                                <td>${esc(formatDateTime(log.created_at))}</td>
                                <td>${esc(log.ip_address || '-')}</td>
                                <td class="muted small">${esc(log.user_agent ? log.user_agent.slice(0, 40) : '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        console.error('Login logs error:', error);
        container.innerHTML = '<p class="muted small">Failed to load login logs.</p>';
    }
}

// ==================== BACKUP / EXPORT ====================

async function backupData() {
    try {
        const response = await fetch(`${API_URL}/inventory/products`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const inventory = await response.json();

        const customerRes = await fetch(`${API_URL}/customers`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const customersRes = await customerRes.json();

        const backup = {
            exportedAt: new Date().toISOString(),
            products: inventory.products || [],
            customers: customersRes.customers || [],
            settings: appSettings
        };

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Backup downloaded');
    } catch (error) {
        console.error('Backup error:', error);
        showToast('Failed to create backup', 'error');
    }
}

async function exportData() {
    try {
        const response = await fetch(`${API_URL}/inventory/products`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const products = data.products || [];

        if (products.length === 0) {
            showToast('No data to export', 'error');
            return;
        }

        const headers = ['name', 'barcode', 'category', 'price', 'stock_quantity', 'cost_price', 'tax_rate'];
        const rows = products.map(p =>
            headers.map(h => {
                const val = p[h];
                const str = val == null ? '' : String(val);
                return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
            }).join(',')
        );

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pos-products-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Inventory exported as CSV');
    } catch (error) {
        console.error('Export error:', error);
        showToast('Failed to export data', 'error');
    }
}

// Close modals when clicking the backdrop
document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    }
});
