// Import SQLite for DB operations.
import sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';

// Create or open DB file (local mocking).
const db = new Database('./tella.db');

// Init users table if not exists (hashed state for users).
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      phone_hash TEXT PRIMARY KEY,
      pin_hash TEXT,
      wallet_init BOOLEAN DEFAULT 0
    )
  `);
});

// Export DB for use in other files.
export default db;