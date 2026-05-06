-- 掼蛋游戏数据库初始化脚本

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(32) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    is_guest BOOLEAN DEFAULT 0,
    avatar_id INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_banned BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_stats (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER DEFAULT 1000,
    rank_tier VARCHAR(16) DEFAULT 'bronze',
    games_played INTEGER DEFAULT 0,
    games_won INTEGER DEFAULT 0,
    current_level VARCHAR(4) DEFAULT '2',
    win_streak INTEGER DEFAULT 0,
    total_playtime INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code VARCHAR(8) UNIQUE NOT NULL,
    name VARCHAR(64),
    host_id INTEGER REFERENCES users(id),
    status VARCHAR(16) DEFAULT 'waiting',
    is_private BOOLEAN DEFAULT 0,
    password_hash VARCHAR(255),
    max_players INTEGER DEFAULT 4,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER REFERENCES rooms(id),
    status VARCHAR(16) DEFAULT 'active',
    team_a_ids TEXT NOT NULL,
    team_b_ids TEXT NOT NULL,
    team_a_level VARCHAR(4) DEFAULT '2',
    team_b_level VARCHAR(4) DEFAULT '2',
    winner_team INTEGER,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    rounds_played INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    finish_order TEXT NOT NULL,
    tribute_data TEXT,
    move_sequence TEXT NOT NULL DEFAULT '[]',
    initial_hands TEXT NOT NULL DEFAULT '{}',
    team_a_level_before VARCHAR(4),
    team_b_level_before VARCHAR(4),
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
);

CREATE TABLE IF NOT EXISTS game_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    team INTEGER NOT NULL,
    finish_position INTEGER,
    rating_before INTEGER,
    rating_after INTEGER,
    rating_delta INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(16) DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_games_room ON games(room_id);
CREATE INDEX IF NOT EXISTS idx_participants_user ON game_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_game ON game_participants(game_id);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id);
