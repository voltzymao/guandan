function errorHandler(err, req, res, next) {
    console.error('[ERROR]', err.message, err.stack);
    const status = err.status || 500;
    res.status(status).json({
        error: err.message || '服务器内部错误',
    });
}

module.exports = errorHandler;
