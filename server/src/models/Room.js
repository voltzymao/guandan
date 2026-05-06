const { getDb } = require('../config/database');

class Room {
    static findByCode(code) {
        return getDb().prepare('SELECT * FROM rooms WHERE room_code = ?').get(code);
    }

    static findById(id) {
        return getDb().prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    }

    static listWaiting(limit = 20, offset = 0) {
        return getDb().prepare(`
            SELECT r.*, u.username as host_name
            FROM rooms r
            LEFT JOIN users u ON u.id = r.host_id
            WHERE r.status = 'waiting'
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset);
    }

    static create({ roomCode, name, hostId, isPrivate = false, passwordHash = null }) {
        const result = getDb().prepare(`
            INSERT INTO rooms (room_code, name, host_id, is_private, password_hash)
            VALUES (?, ?, ?, ?, ?)
        `).run(roomCode, name || null, hostId, isPrivate ? 1 : 0, passwordHash);
        return result.lastInsertRowid;
    }

    static updateStatus(id, status) {
        getDb().prepare('UPDATE rooms SET status = ? WHERE id = ?').run(status, id);
    }

    static delete(id) {
        getDb().prepare('DELETE FROM games WHERE room_id = ?').run(id);
        getDb().prepare('DELETE FROM rooms WHERE id = ?').run(id);
    }
}

module.exports = Room;
