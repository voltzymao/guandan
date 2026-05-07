const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const { authMiddleware, signToken } = require('../middleware/auth');

const router = express.Router();

// 注册
router.post('/register', async (req, res, next) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }
        if (username.length < 2 || username.length > 20) {
            return res.status(400).json({ error: '用户名长度2-20位' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: '密码至少6位' });
        }
        if (User.findByUsername(username)) {
            return res.status(409).json({ error: '用户名已存在' });
        }
        if (email && User.findByEmail(email)) {
            return res.status(409).json({ error: '邮箱已被注册' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const userId = User.create({ username, email, passwordHash });
        const token = signToken({ id: userId, username });
        const profile = User.getProfile(userId);

        res.json({ token, user: { id: userId, username, isGuest: false, rating: profile.rating, current_level: profile.current_level, rank_tier: profile.rank_tier, games_played: profile.games_played, games_won: profile.games_won, coins: profile.coins || 0 } });
    } catch (err) {
        next(err);
    }
});

// 登录
router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }

        const user = User.findByUsername(username);
        if (!user || user.is_guest) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        if (user.is_banned) {
            return res.status(403).json({ error: '账号已被封禁' });
        }

        User.updateLastLogin(user.id);
        const token = signToken({ id: user.id, username: user.username });
        const profile = User.getProfile(user.id);

        res.json({ token, user: { id: user.id, username: user.username, isGuest: false, rating: profile.rating, current_level: profile.current_level, rank_tier: profile.rank_tier, games_played: profile.games_played, games_won: profile.games_won, coins: profile.coins || 0 } });
    } catch (err) {
        next(err);
    }
});

// 游客登录
router.post('/guest', (req, res, next) => {
    try {
        const baseName = req.body.username || '游客';
        const uniqueName = `${baseName}${Math.floor(Math.random() * 9000) + 1000}`;

        const userId = User.create({ username: uniqueName, isGuest: true });
        const token = signToken({ id: userId, username: uniqueName, isGuest: true });
        const profile = User.getProfile(userId);

        res.json({ token, user: { id: userId, username: uniqueName, isGuest: true, rating: profile.rating, current_level: profile.current_level, rank_tier: profile.rank_tier, games_played: profile.games_played, games_won: profile.games_won, coins: profile.coins || 0 } });
    } catch (err) {
        next(err);
    }
});

// 获取当前用户信息
router.get('/me', authMiddleware, (req, res, next) => {
    try {
        const profile = User.getProfile(req.user.id);
        if (!profile) return res.status(404).json({ error: '用户不存在' });
        res.json({ user: profile });
    } catch (err) {
        next(err);
    }
});

// 搜索用户（用于添加好友）
router.get('/search', authMiddleware, (req, res, next) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json({ users: [] });
        const users = User.search(q);
        res.json({ users: users.filter(u => u.id !== req.user.id) });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
