const express = require('express');
const User = require('../models/User');
const CoinTransaction = require('../models/CoinTransaction');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 所有端点都需要认证
router.use(authMiddleware);

// 获取金币余额 + 流水
router.get('/', (req, res, next) => {
    try {
        const userId = req.user.id;
        const stats = User.getStats(userId);
        const coins = stats ? stats.coins : 0;
        res.json({ coins });
    } catch (err) {
        next(err);
    }
});

// 金币流水
router.get('/transactions', (req, res, next) => {
    try {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        const transactions = CoinTransaction.getHistory(userId, limit, offset);
        res.json({ transactions });
    } catch (err) {
        next(err);
    }
});

// 签到状态
router.get('/checkin/status', (req, res, next) => {
    try {
        const userId = req.user.id;
        const status = User.getCheckinStatus(userId);
        res.json(status);
    } catch (err) {
        next(err);
    }
});

// 每日签到
router.post('/checkin', (req, res, next) => {
    try {
        const userId = req.user.id;
        const result = User.checkin(userId);
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

// 获取每日任务
router.get('/tasks', (req, res, next) => {
    try {
        const userId = req.user.id;
        const tasks = User.getDailyTasks(userId);
        res.json({ tasks });
    } catch (err) {
        next(err);
    }
});

// 领取任务奖励
router.post('/tasks/:taskKey/claim', (req, res, next) => {
    try {
        const userId = req.user.id;
        const result = User.claimTask(userId, req.params.taskKey);
        if (!result.success) return res.status(400).json(result);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
