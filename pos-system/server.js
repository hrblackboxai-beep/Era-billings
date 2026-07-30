const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Import and initialize database first
const dbModule = require('./database/database');

let dbInitialized = false;

dbModule.initializeDatabase().then(() => {
  dbInitialized = true;
  console.log('Database initialized successfully');
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// Import routes (they will use the db module)
const billingRoutes = require('./routes/billing');
const inventoryRoutes = require('./routes/inventory');
const customerRoutes = require('./routes/customer');
const employeeRoutes = require('./routes/employee');
const kitchenRoutes = require('./routes/kitchen');
const reportRoutes = require('./routes/reports');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payment');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/kitchen', kitchenRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/payments', paymentRoutes);

// Socket.IO for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-kitchen', () => {
    socket.join('kitchen');
    console.log('Client joined kitchen room');
  });

  socket.on('new-order', (order) => {
    io.to('kitchen').emit('order-created', order);
  });

  socket.on('order-status-update', (data) => {
    io.emit('order-status-changed', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`POS Server running on http://localhost:${PORT}`);
  console.log('Offline mode enabled - All data stored locally in SQLite');
});

module.exports = { app, io };
