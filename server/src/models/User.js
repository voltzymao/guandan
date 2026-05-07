const { getDb } = require('../config/database');
const CoinTransaction = require('./CoinTransaction');

const CHECKIN_REWARDS = [10, 15, 20, 25, 30, 35, 50]; // 签到第1-7天奖励
const DAILY_TASKS = [
    { key: 'play_3_games', description: '完成3局游戏', target: 3, reward: 20 },
    { key: 'win_2_games', description: '赢得2局胜利', target: 2, reward: 30 },
    { key: 'double_down', description: '完成1次双下', target: 1, reward: 40 },
];

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
                   s.current_level, s.win_streak, s.coins
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

    // ==================== 金币系统 ====================

    static addCoins(userId, amount, type, referenceId = null) {
        const db = getDb();
        const stats = db.prepare('SELECT coins FROM user_stats WHERE user_id = ?').get(userId);
        const currentCoins = stats ? stats.coins : 0;
        const newCoins = Math.max(0, currentCoins + amount);

        const updateCoins = db.prepare('UPDATE user_stats SET coins = ? WHERE user_id = ?');
        const insertTx = db.prepare(
            'INSERT INTO coin_transactions (user_id, type, amount, balance_after, reference_id) VALUES (?, ?, ?, ?, ?)'
        );

        const transact = db.transaction(() => {
            updateCoins.run(newCoins, userId);
            insertTx.run(userId, type, amount, newCoins, referenceId);
            return newCoins;
        });

        return transact();
    }

    // ==================== 每日签到 ====================

    static getCheckinStatus(userId) {
        const db = getDb();
        const today = db.prepare(
            "SELECT * FROM daily_checkins WHERE user_id = ? AND checkin_date = date('now')"
        ).get(userId);
        const lastRecord = db.prepare(
            'SELECT * FROM daily_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1'
        ).get(userId);

        const canCheckin = !today;
        const currentStreak = lastRecord ? lastRecord.day_streak : 0;
        const nextStreak = canCheckin ? currentStreak + 1 : currentStreak;
        const nextReward = CHECKIN_REWARDS[(nextStreak - 1) % CHECKIN_REWARDS.length];

        return { canCheckin, dayStreak: currentStreak, nextStreak, nextReward, todayRecord: today || null };
    }

    static checkin(userId) {
        const db = getDb();
        const status = this.getCheckinStatus(userId);
        if (!status.canCheckin) return { success: false, error: '今日已签到' };

        const checkinDone = db.transaction(() => {
            db.prepare(
                "INSERT INTO daily_checkins (user_id, checkin_date, day_streak, coins_rewarded) VALUES (?, date('now'), ?, ?)"
            ).run(userId, status.nextStreak, status.nextReward);

            const newCoins = this.addCoins(userId, status.nextReward, 'daily_checkin');
            return { dayStreak: status.nextStreak, reward: status.nextReward, coins: newCoins };
        });

        return { success: true, ...checkinDone() };
    }

    // ==================== 每日任务 ====================

    static getDailyTasks(userId) {
        const db = getDb();
        return DAILY_TASKS.map(task => {
            const record = db.prepare(
                "SELECT * FROM user_tasks WHERE user_id = ? AND task_date = date('now') AND task_key = ?"
            ).get(userId, task.key);
            return {
                ...task,
                progress: record ? record.progress : 0,
                claimed: record ? record.claimed : 0,
            };
        });
    }

    static updateTaskProgress(userId, taskKey, increment = 1) {
        const db = getDb();
        const task = DAILY_TASKS.find(t => t.key === taskKey);
        if (!task) return;

        const existing = db.prepare(
            "SELECT * FROM user_tasks WHERE user_id = ? AND task_date = date('now') AND task_key = ?"
        ).get(userId, taskKey);

        if (existing) {
            if (existing.claimed) return;
            const newProgress = Math.min(existing.progress + increment, task.target);
            db.prepare(
                'UPDATE user_tasks SET progress = ? WHERE id = ?'
            ).run(newProgress, existing.id);
        } else {
            db.prepare(
                "INSERT INTO user_tasks (user_id, task_date, task_key, progress, target) VALUES (?, date('now'), ?, ?, ?)"
            ).run(userId, taskKey, Math.min(increment, task.target), task.target);
        }
    }

    static claimTask(userId, taskKey) {
        const db = getDb();
        const task = DAILY_TASKS.find(t => t.key === taskKey);
        if (!task) return { success: false, error: '任务不存在' };

        const record = db.prepare(
            "SELECT * FROM user_tasks WHERE user_id = ? AND task_date = date('now') AND task_key = ?"
        ).get(userId, taskKey);

        if (!record || record.progress < record.target) {
            return { success: false, error: '任务未完成' };
        }
        if (record.claimed) {
            return { success: false, error: '奖励已领取' };
        }

        const claimDone = db.transaction(() => {
            db.prepare('UPDATE user_tasks SET claimed = 1 WHERE id = ?').run(record.id);
            const newCoins = this.addCoins(userId, task.reward, 'task_reward', taskKey);
            return { reward: task.reward, coins: newCoins };
        });

        return { success: true, ...claimDone() };
    }
}

module.exports = UserModel;
