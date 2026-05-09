const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../../data/guandan.db');

let db;

function getDb() {
    if (!db) {
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('synchronous = NORMAL');
        runMigrations();
    }
    return db;
}

function runMigrations() {
    const migrationsDir = path.join(__dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        try {
            db.exec(sql);
        } catch (err) {
            // 忽略已存在的列/表/索引（迁移幂等）
            if (err.message && (err.message.includes('duplicate column name') || err.message.includes('already exists'))) {
                continue;
            }
            throw err;
        }
    }
}

module.exports = { getDb };
