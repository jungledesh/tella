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

// Get user info from phone hash
export function getUser(
  phoneHash: string
): Promise<{ wallet_init: number; pending_actions: string } | null> {
  return new Promise((resolve, reject) => {
    // Basic type + empty check
    if (typeof phoneHash !== 'string' || phoneHash.trim() === '') {
      return reject(
        new Error('Invalid input: phoneHash must be a non-empty string')
      );
    }

    // Normalize casing
    phoneHash = phoneHash.toLowerCase();

    // Length check
    if (phoneHash.length !== 64) {
      return reject(
        new Error('Invalid input: phoneHash must be 64 characters long')
      );
    }

    // Hex format check (lowercase only, since normalized above)
    if (!/^[a-f0-9]{64}$/.test(phoneHash)) {
      return reject(
        new Error('Invalid input: phoneHash must be a valid SHA-256 hex string')
      );
    }

    // Proceed with DB lookup
    db.get(
      `SELECT * FROM users WHERE phone_hash = ?`,
      [phoneHash],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        resolve(row as { wallet_init: number; pending_actions: string });
      }
    );
  });
}

export function insertUser(
  phoneHash: string,
  walletInit: boolean = false,
  pendingActions: string = ''
): Promise<string> {
  return new Promise((resolve, reject) => {
    // --- Validate phoneHash ---
    if (typeof phoneHash !== 'string' || phoneHash.trim() === '') {
      return reject(
        new Error('Invalid input: phoneHash must be a non-empty string')
      );
    }

    // Normalize case
    phoneHash = phoneHash.toLowerCase();

    // Length + hex check
    if (phoneHash.length !== 64 || !/^[a-f0-9]{64}$/.test(phoneHash)) {
      return reject(
        new Error('Invalid input: phoneHash must be a valid SHA-256 hex string')
      );
    }

    // --- Validate walletInit ---
    if (typeof walletInit !== 'boolean') {
      return reject(new Error('Invalid input: walletInit must be a boolean'));
    }

    // --- Validate pendingActions ---
    if (typeof pendingActions !== 'string') {
      return reject(
        new Error('Invalid input: pendingActions must be a string')
      );
    }

    // Proceed with DB insertion
    db.run(
      `INSERT OR REPLACE INTO users (phone_hash, wallet_init, pending_actions) VALUES (?, ?, ?)`,
      [phoneHash, walletInit ? 1 : 0, pendingActions],
      (err) => {
        if (err) return reject(err);
        resolve('User info saved');
      }
    );
  });
}

// Export DB for use in other files.
export default db;
