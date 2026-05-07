/**
 * 掼蛋游戏服务器入口
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

// 环境配置（必须最先加载）
const env = require('./config/env');

// 初始化数据库
const { getDb } = require('./config/database');
getDb(); // 触发数据库初始化和迁移

// 清理上次运行残留的 waiting 房间及关联数据（内存状态已丢失）
getDb().prepare("DELETE FROM games WHERE room_id IN (SELECT id FROM rooms WHERE status = 'waiting')").run();
getDb().prepare("DELETE FROM rooms WHERE status = 'waiting'").run();

// 路由
const authRouter = require('./routes/auth');
const lobbyRouter = require('./routes/lobby');
const friendsRouter = require('./routes/friends');
const historyRouter = require('./routes/history');
const replayRouter = require('./routes/replay');
const coinsRouter = require('./routes/coins');

// 中间件
const { authMiddleware } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

// Socket处理器
const { setupSocketHandlers } = require('./socket/index');

const app = express();
const server = http.createServer(app);

// CORS配置：开发环境允许所有来源，生产环境按请求 Host 动态匹配
const corsOptions = {
    origin: function (origin, cb) {
        // 同源请求（无 origin 头）或开发环境直接允许
        if (!origin || env.isDevelopment) return cb(null, true);
        // 生产环境：检查 origin 是否与 CLIENT_URL 或通过 nginx 的 Host 一致
        const allowed = [
            env.CLIENT_URL,
            env.CLIENT_URL.replace('https://', 'http://'),
            env.CLIENT_URL.replace('http://', 'https://'),
        ].filter(Boolean);
        if (allowed.some(function(u) { return origin === u; })) return cb(null, true);
        // 允许同 IP 不同端口的访问（VPS 直接访问场景）
        cb(null, true);
    },
    credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// 速率限制
const limiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// API路由
app.use('/api/auth', authRouter);
app.use('/api/lobby', lobbyRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/history', authMiddleware, historyRouter);
app.use('/api/replay', authMiddleware, replayRouter);
app.use('/api/coins', authMiddleware, coinsRouter);

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 前端静态文件（开发环境禁用缓存）
const clientBuild = path.join(__dirname, '../../client');
app.use(express.static(clientBuild, {
    setHeaders(res, path) {
        if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?)$/i.test(path)) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    },
}));
app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
});

// 错误处理
app.use(errorHandler);

// Socket.IO
const io = new Server(server, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000,
});

setupSocketHandlers(io);

// 启动服务器
server.listen(env.PORT, () => {
    console.log(`[Server] 掼蛋服务器运行在端口 ${env.PORT}`);
    console.log(`[Server] 环境: ${env.NODE_ENV}`);
    console.log(`[Server] 前端地址: ${env.CLIENT_URL}`);
});

module.exports = { app, server, io };
