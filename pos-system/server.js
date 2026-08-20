require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');

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
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Custom middleware
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
app.use(logger);

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
const analyticsRoutes = require('./routes/analytics');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/kitchen', kitchenRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/analytics', analyticsRoutes);

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

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Start server
server.listen(config.port, () => {
  console.log(`POS Server running on http://localhost:${config.port}`);
  console.log('Offline mode enabled - All data stored locally in SQLite');
  console.log(`Environment: ${config.nodeEnv}`);
});

module.exports = { app, io };
