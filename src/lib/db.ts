import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'marketing.db');

let db: Database.Database | null = null;

/**
 * Get or create the database connection
 */
export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

/**
 * Initialize database schema
 */
function initSchema(): void {
  const database = db!;

  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      platform TEXT PRIMARY KEY,
      last_request_at INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_posts (
      post_id TEXT PRIMARY KEY,
      processed_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_replies (
      post_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      reply_text TEXT NOT NULL,
      original_post_url TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_counts (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_processed_expires ON processed_posts(expires_at);
    CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_replies(expires_at);
    CREATE INDEX IF NOT EXISTS idx_daily_expires ON daily_counts(expires_at);
  `);
}

/**
 * Clean up expired rows from all tables
 */
export function cleanupExpired(): void {
  const database = getDb();
  const now = Date.now();

  database.exec(`
    DELETE FROM rate_limits WHERE expires_at < ${now};
    DELETE FROM processed_posts WHERE expires_at < ${now};
    DELETE FROM pending_replies WHERE expires_at < ${now};
    DELETE FROM daily_counts WHERE expires_at < ${now};
  `);
}

/**
 * Close the database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
