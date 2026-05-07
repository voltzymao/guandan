-- 金币系统迁移
-- v2.0 新增金币余额、交易流水、签到、每日任务

-- 用户金币余额
ALTER TABLE user_stats ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;

-- 金币交易流水
CREATE TABLE IF NOT EXISTS coin_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type VARCHAR(32) NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ct_user_id ON coin_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ct_created ON coin_transactions(created_at);

-- 每日签到
CREATE TABLE IF NOT EXISTS daily_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    checkin_date DATE NOT NULL DEFAULT (date('now')),
    day_streak INTEGER NOT NULL DEFAULT 1,
    coins_rewarded INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_dc_user ON daily_checkins(user_id, checkin_date);

-- 每日任务
CREATE TABLE IF NOT EXISTS user_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    task_date DATE NOT NULL DEFAULT (date('now')),
    task_key VARCHAR(32) NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    target INTEGER NOT NULL,
    claimed INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, task_date, task_key)
);

CREATE INDEX IF NOT EXISTS idx_ut_user ON user_tasks(user_id, task_date);
