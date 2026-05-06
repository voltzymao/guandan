const express = require('express');
const bcrypt = require('bcryptjs');
const Room = require('../models/Room');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// 获取房间列表
router.get('/', (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = (page - 1) * limit;
        const rooms = Room.listWaiting(limit, offset);
        res.json({ rooms: rooms.map(r => ({
            id: r.id,
            code: r.room_code,
            name: r.name,
            hostId: r.host_id,
            hostName: r.host_name,
            playerCount: 0,
            status: r.status || 'waiting',
            isPrivate: !!r.is_private,
            createdAt: r.created_at,
        }))});
    } catch (err) {
        next(err);
    }
});

// 创建房间
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        const { name, isPrivate, password } = req.body;
        let passwordHash = null;
        if (isPrivate && password) {
            passwordHash = await bcrypt.hash(password, 8);
        }

        let code;
        let attempts = 0;
        do {
            code = generateRoomCode();
            attempts++;
        } while (Room.findByCode(code) && attempts < 10);

        const roomId = Room.create({
            roomCode: code,
            name: name || `${req.user.username}的房间`,
            hostId: req.user.id,
            isPrivate: !!isPrivate,
            passwordHash,
        });

        res.json({ room: { id: roomId, code, name: name || `${req.user.username}的房间`, hostId: req.user.id } });
    } catch (err) {
        next(err);
    }
});

// 获取房间信息
router.get('/:code', (req, res, next) => {
    try {
        const room = Room.findByCode(req.params.code.toUpperCase());
        if (!room) return res.status(404).json({ error: '房间不存在' });
        res.json({ room: {
            id: room.id,
            code: room.room_code,
            name: room.name,
            hostId: room.host_id,
            status: room.status,
            isPrivate: !!room.is_private,
        }});
    } catch (err) {
        next(err);
    }
});

module.exports = router;
