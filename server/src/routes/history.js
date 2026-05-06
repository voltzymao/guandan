const express = require('express');
const Game = require('../models/Game');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取战绩列表
router.get('/', authMiddleware, (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = (page - 1) * limit;
        const history = Game.getUserHistory(req.user.id, limit, offset);
        res.json({ history });
    } catch (err) {
        next(err);
    }
});

// 获取单局详情
router.get('/:gameId', authMiddleware, (req, res, next) => {
    try {
        const game = Game.findById(parseInt(req.params.gameId));
        if (!game) return res.status(404).json({ error: '对局不存在' });
        const rounds = Game.getRounds(game.id);
        res.json({ game, rounds });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
