// Centralized application configuration
module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET || 'pos-secret-key-offline',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  }
};
