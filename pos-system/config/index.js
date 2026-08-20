require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'pos-secret-key-offline-change-in-production',
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || './database/pos.db',
  company: {
    name: process.env.COMPANY_NAME || 'My Store',
    currency: process.env.CURRENCY || 'INR',
    gstRate: process.env.GST_RATE || 18
  }
};
