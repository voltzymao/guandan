const { getDb } = require('../config/database');

class UserModel {
    static findById(id) {
        return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
    }

    static findByUsername(username) {
        return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
    }

    static findByEmail(email) {
        return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
    }

    static create({ username, email, passwordHash, isGuest = false }) {
        const db = getDb();
        const result = db.prepare(
            'INSERT INTO users (username, email, password_hash, is_guest) VALUES (?, ?, ?, ?)'
        ).run(username, email || null, passwordHash || null, isGuest ? 1 : 0);

        db.prepare('INSERT INTO user_stats (user_id) VALUES (?)').run(result.lastInsertRowid);
        return result.lastInsertRowid;
    }

    static updateLastLogin(id) {
        getDb().prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    }

    static getStats(userId) {
        return getDb().prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
    }

    static getProfile(userId) {
        return getDb().prepare(`
            SELECT u.id, u.username, u.avatar_id, u.created_at, u.is_guest,
                   s.rating, s.rank_tier, s.games_played, s.games_won,
                   s.current_level, s.win_streak
            FROM users u
            LEFT JOIN user_stats s ON s.user_id = u.id
            WHERE u.id = ?
        `).get(userId);
    }

    static updateStats(userId, updates) {
        const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updates);
        getDb().prepare(`UPDATE user_stats SET ${fields} WHERE user_id = ?`).run(...values, userId);
    }

    static search(query, limit = 10) {
        return getDb().prepare(
            'SELECT id, username, avatar_id FROM users WHERE username LIKE ? AND is_guest = 0 LIMIT ?'
        ).all(`%${query}%`, limit);
    }
}

module.exports = UserModel;
