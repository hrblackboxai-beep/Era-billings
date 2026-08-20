module.exports = (req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${res.statusCode} - ${duration}ms`);
  });
  
  try {
    next();
  } catch (error) {
    console.error('Request error:', error);
    next(error);
  }
};
