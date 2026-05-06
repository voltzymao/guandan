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
    const migrationPath = path.join(__dirname, '../../migrations/001_schema.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    db.exec(sql);
}

module.exports = { getDb };
