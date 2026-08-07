const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config/config');

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, jwtConfig.secret);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Role-based access control. Must be used after authMiddleware.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No token provided' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };
}

authMiddleware.requireRole = requireRole;

module.exports = authMiddleware;
