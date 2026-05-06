const { getDb } = require('../config/database');

class Friend {
    static getList(userId) {
        return getDb().prepare(`
            SELECT u.id, u.username, u.avatar_id, s.rating, s.rank_tier,
                   f.id as friendship_id, f.status
            FROM friendships f
            JOIN users u ON u.id = CASE
                WHEN f.requester_id = ? THEN f.addressee_id
                ELSE f.requester_id
            END
            LEFT JOIN user_stats s ON s.user_id = u.id
            WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
        `).all(userId, userId, userId);
    }

    static getPending(userId) {
        return getDb().prepare(`
            SELECT f.id, u.id as from_id, u.username as from_username, u.avatar_id, f.created_at
            FROM friendships f
            JOIN users u ON u.id = f.requester_id
            WHERE f.addressee_id = ? AND f.status = 'pending'
        `).all(userId);
    }

    static findRelation(userId1, userId2) {
        return getDb().prepare(`
            SELECT * FROM friendships
            WHERE (requester_id = ? AND addressee_id = ?)
               OR (requester_id = ? AND addressee_id = ?)
        `).get(userId1, userId2, userId2, userId1);
    }

    static sendRequest(requesterId, addresseeId) {
        const result = getDb().prepare(
            'INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?)'
        ).run(requesterId, addresseeId);
        return result.lastInsertRowid;
    }

    static updateStatus(id, status) {
        getDb().prepare('UPDATE friendships SET status = ? WHERE id = ?').run(status, id);
    }

    static delete(id) {
        getDb().prepare('DELETE FROM friendships WHERE id = ?').run(id);
    }

    static findById(id) {
        return getDb().prepare('SELECT * FROM friendships WHERE id = ?').get(id);
    }
}

module.exports = Friend;
