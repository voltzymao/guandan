const express = require('express');
const Friend = require('../models/Friend');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取好友列表（含待处理请求）
router.get('/', authMiddleware, (req, res, next) => {
    try {
        const friends = Friend.getList(req.user.id);
        const pending = Friend.getPending(req.user.id);
        res.json({ friends, pending });
    } catch (err) {
        next(err);
    }
});

// 发送好友请求
router.post('/request', authMiddleware, (req, res, next) => {
    try {
        const { userId, targetUsername } = req.body;
        const targetId = userId || (targetUsername ? User.findByUsername(targetUsername)?.id : null);
        if (!targetId) return res.status(400).json({ error: '请提供目标用户' });

        const target = User.findById(targetId);
        if (!target) return res.status(404).json({ error: '用户不存在' });
        if (target.id === req.user.id) return res.status(400).json({ error: '不能添加自己' });
        if (target.is_guest) return res.status(400).json({ error: '不能添加游客' });

        const existing = Friend.findRelation(req.user.id, target.id);
        if (existing) {
            if (existing.status === 'accepted') return res.status(409).json({ error: '已经是好友' });
            if (existing.status === 'pending') return res.status(409).json({ error: '请求已发送' });
        }

        const id = Friend.sendRequest(req.user.id, target.id);
        res.json({ id, message: '好友请求已发送' });
    } catch (err) {
        next(err);
    }
});

// 接受好友请求
router.post('/:id/accept', authMiddleware, (req, res, next) => {
    try {
        const friendship = Friend.findById(parseInt(req.params.id));
        if (!friendship) return res.status(404).json({ error: '请求不存在' });
        if (friendship.addressee_id !== req.user.id) return res.status(403).json({ error: '无权操作' });
        if (friendship.status !== 'pending') return res.status(400).json({ error: '请求状态无效' });

        Friend.updateStatus(friendship.id, 'accepted');
        res.json({ message: '已接受好友请求' });
    } catch (err) {
        next(err);
    }
});

// 拒绝/删除好友
router.delete('/:id', authMiddleware, (req, res, next) => {
    try {
        const friendship = Friend.findById(parseInt(req.params.id));
        if (!friendship) return res.status(404).json({ error: '关系不存在' });
        if (friendship.requester_id !== req.user.id && friendship.addressee_id !== req.user.id) {
            return res.status(403).json({ error: '无权操作' });
        }

        Friend.delete(friendship.id);
        res.json({ message: '操作成功' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
