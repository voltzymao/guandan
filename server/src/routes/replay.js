const express = require('express');
const Game = require('../models/Game');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取对局所有回合列表
router.get('/:gameId', authMiddleware, (req, res, next) => {
    try {
        const game = Game.findById(parseInt(req.params.gameId));
        if (!game) return res.status(404).json({ error: '对局不存在' });
        const rounds = Game.getRounds(game.id);
        res.json({ game, rounds: rounds.map(r => ({
            id: r.id,
            roundNumber: r.round_number,
            finishOrder: JSON.parse(r.finish_order),
            startedAt: r.started_at,
            finishedAt: r.finished_at,
        }))});
    } catch (err) {
        next(err);
    }
});

// 获取单回合回放数据
router.get('/:gameId/:roundId', authMiddleware, (req, res, next) => {
    try {
        const round = Game.getRound(parseInt(req.params.roundId));
        if (!round || round.game_id !== parseInt(req.params.gameId)) {
            return res.status(404).json({ error: '回放不存在' });
        }
        res.json({ replay: round });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
