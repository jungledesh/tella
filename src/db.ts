// Import sqlite3 as default (for CommonJS compatibility in ESM).
import pkg from 'sqlite3';
const { Database } = pkg;

// Create or open DB file (local mocking)
const db = new Database('./tella.db');

// Init users table if not exists (hashed state for users).
// Init users table if not exists.
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      phone_hash TEXT PRIMARY KEY,
      wallet_init BOOLEAN DEFAULT 0, 
      pending_actions TEXT
    )
  `);
});

// Get user by phone_hash (async promise).
export function getUser(
  phoneHash: string
): Promise<{ wallet_init: number; pending_actions: string } | null> {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM users WHERE phone_hash = ?`,
      [phoneHash],
      (err, row) => {
        if (err) reject(err);
        resolve(row as { wallet_init: number; pending_actions: string } | null);
      }
    );
  });
}

// Insert or update user (async).
export function insertUser(
  phoneHash: string,
  walletInit: boolean = false,
  pendingActions: string = ''
): Promise<string> {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO users (phone_hash, wallet_init, pending_actions) VALUES (?, ?, ?)`,
      [phoneHash, walletInit ? 1 : 0, pendingActions],
      (err) => {
        if (err) reject(err);
        resolve('User info saved');
      }
    );
  });
}

// Export DB for use in other files.
export default db;
