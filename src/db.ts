// Import sqlite3 as default (for CommonJS compatibility in ESM).
import pkg from 'sqlite3';
const { Database } = pkg;

// Create or open DB file (local mocking)
const db = new Database('./tella.db');

// Init users table if not exists.
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      phone_hash TEXT PRIMARY KEY,
      wallet_init INTEGER DEFAULT 0,
      pending_actions TEXT
    )
  `);
});

// Helpers for validation (DRY)
function validatePhoneHash(phoneHash: string): string {
  if (typeof phoneHash !== 'string' || phoneHash.trim() === '') {
    throw new Error('Invalid phoneHash: non-empty string required');
  }
  phoneHash = phoneHash.toLowerCase();
  if (phoneHash.length !== 64 || !/^[0-9a-f]{64}$/.test(phoneHash)) {
    throw new Error('Invalid phoneHash: must be 64-char hex');
  }
  return phoneHash;
}

function validateWalletInit(walletInit: boolean): number {
  if (typeof walletInit !== 'boolean') {
    throw new Error('Invalid walletInit: boolean required');
  }
  return walletInit ? 1 : 0;
}

function validatePendingActions(pendingActions: string): string {
  if (typeof pendingActions !== 'string') {
    throw new Error('Invalid pendingActions: string required');
  }
  return pendingActions;
}

// Get user
export function getUser(
  phoneHash: string
): Promise<{ wallet_init: number; pending_actions: string } | null> {
  return new Promise((resolve, reject) => {
    try {
      phoneHash = validatePhoneHash(phoneHash);
      db.get(
        `SELECT * FROM users WHERE phone_hash = ?`,
        [phoneHash],
        (err, row) => {
          if (err) return reject(err);
          resolve(
            (row as { wallet_init: number; pending_actions: string }) || null
          );
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

// Insert/upsert user
export function insertUser(
  phoneHash: string,
  walletInit: boolean = false,
  pendingActions: string = ''
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      phoneHash = validatePhoneHash(phoneHash);
      const initVal = validateWalletInit(walletInit);
      pendingActions = validatePendingActions(pendingActions);
      db.run(
        `INSERT OR REPLACE INTO users (phone_hash, wallet_init, pending_actions) VALUES (?, ?, ?)`,
        [phoneHash, initVal, pendingActions],
        (err) => (err ? reject(err) : resolve('User info saved'))
      );
    } catch (err) {
      reject(err);
    }
  });
}

// Update user
export function updateUser(
  phoneHash: string,
  updates: { wallet_init?: boolean; pending_actions?: string | null }
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      phoneHash = validatePhoneHash(phoneHash);
      const setClauses: string[] = [];
      const values: (number | string | null)[] = [];

      if (updates.wallet_init !== undefined) {
        setClauses.push('wallet_init = ?');
        values.push(validateWalletInit(updates.wallet_init));
      }

      if (updates.pending_actions !== undefined) {
        if (updates.pending_actions !== null) {
          validatePendingActions(updates.pending_actions);
        }
        setClauses.push('pending_actions = ?');
        values.push(updates.pending_actions);
      }

      if (!setClauses.length) {
        return reject(new Error('No updates provided'));
      }

      const query = `UPDATE users SET ${setClauses.join(', ')} WHERE phone_hash = ?`;
      values.push(phoneHash);

      db.run(query, values, function (err) {
        if (err) return reject(err);
        if (this.changes === 0) return reject(new Error('User not found'));
        resolve('Updated');
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Close DB on exit
process.on('exit', () => db.close());

// Export DB for use in other files.
export default db;
