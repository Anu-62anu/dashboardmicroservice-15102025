const errorHandler = (err, _req, res, _next) => {
  console.error(err.stack || err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message,
  });
};

module.exports = { errorHandler };
