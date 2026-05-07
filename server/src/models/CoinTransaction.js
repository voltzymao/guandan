const { getDb } = require('../config/database');

class CoinTransaction {
    static insert({ userId, type, amount, balanceAfter, referenceId = null }) {
        return getDb().prepare(
            'INSERT INTO coin_transactions (user_id, type, amount, balance_after, reference_id) VALUES (?, ?, ?, ?, ?)'
        ).run(userId, type, amount, balanceAfter, referenceId);
    }

    static getHistory(userId, limit = 20, offset = 0) {
        return getDb().prepare(
            'SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(userId, limit, offset);
    }
}

module.exports = CoinTransaction;
