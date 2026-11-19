/* SQLite database (Node's built-in node:sqlite). One file, WAL mode, created on first run. */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'game.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  coins INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  best_level INTEGER NOT NULL DEFAULT 1,
  games_played INTEGER NOT NULL DEFAULT 0,
  remove_ads INTEGER NOT NULL DEFAULT 0,
  themes TEXT NOT NULL DEFAULT '[]',
  inventory TEXT NOT NULL DEFAULT '{}',
  rating INTEGER NOT NULL DEFAULT 1000,
  battles_w INTEGER NOT NULL DEFAULT 0,
  battles_l INTEGER NOT NULL DEFAULT 0,
  adventure TEXT NOT NULL DEFAULT '{"unlocked":1,"stages":{}}'
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  stage INTEGER,
  score INTEGER NOT NULL DEFAULT 0,
  lines INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  time INTEGER NOT NULL DEFAULT 0,
  pps REAL,
  tetrises INTEGER, tspins INTEGER,
  continued INTEGER NOT NULL DEFAULT 0,
  used_equipment INTEGER NOT NULL DEFAULT 0,
  result TEXT, theme TEXT, device TEXT, opponent TEXT, rating_delta INTEGER, attack_sent INTEGER, coins INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id, at DESC);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  method TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_ref ON orders(provider_ref);
`);

// Columns added after the first release. SQLite has no "add if missing", so check the table first.
const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
[['paid_amount_cents', 'INTEGER'], ['currency', 'TEXT'], ['last_error', 'TEXT'], ['last_checked_at', 'INTEGER'], ['reference_id', 'TEXT']].forEach(([name, type]) => {
  if (!orderCols.includes(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
});
db.exec('CREATE INDEX IF NOT EXISTS orders_reference ON orders(reference_id)');

function row(sql, ...p) { return db.prepare(sql).get(...p); }
function all(sql, ...p) { return db.prepare(sql).all(...p); }
function run(sql, ...p) { return db.prepare(sql).run(...p); }

module.exports = { db, row, all, run };
