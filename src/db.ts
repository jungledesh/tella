// Import pg for PostgreSQL connection pooling.
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

console.log('DB URL:', process.env.DATABASE_URL);

// Create connection pool using DATABASE_URL from env.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Disable strict SSL for dev; enable in prod with cert validation.
});

// Init users table if not exists (run once or on startup).
export async function initDbSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        phone_hash TEXT PRIMARY KEY,
        wallet_init BOOLEAN DEFAULT FALSE,
        pending_actions JSONB
      )
    `);
    console.log('Users table initialized.');
  } catch (err) {
    console.error('Error initializing DB schema:', err);
    throw err;
  }
}

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

function validateWalletInit(walletInit: boolean): boolean {
  if (typeof walletInit !== 'boolean') {
    throw new Error('Invalid walletInit: boolean required');
  }
  return walletInit;
}

function validatePendingActions(pendingActions: string | null): string | null {
  if (pendingActions === null) return null;
  if (typeof pendingActions !== 'string') {
    throw new Error('Invalid pendingActions: string or null required');
  }
  try {
    JSON.parse(pendingActions); // Ensure valid JSON
  } catch {
    throw new Error('Invalid pendingActions: must be valid JSON string');
  }
  return pendingActions;
}

// Get user
export async function getUser(
  phoneHash: string
): Promise<{ wallet_init: boolean; pending_actions: string } | null> {
  try {
    phoneHash = validatePhoneHash(phoneHash);
    const res = await pool.query(`SELECT * FROM users WHERE phone_hash = $1`, [
      phoneHash,
    ]);
    return res.rows[0] || null;
  } catch (err) {
    console.error('Error getting user:', err);
    throw err;
  }
}

// Insert/upsert user
export async function insertUser(
  phoneHash: string,
  walletInit: boolean = false,
  pendingActions: string | null = null
): Promise<string> {
  try {
    phoneHash = validatePhoneHash(phoneHash);
    walletInit = validateWalletInit(walletInit);
    pendingActions = validatePendingActions(pendingActions);
    await pool.query(
      `INSERT INTO users (phone_hash, wallet_init, pending_actions)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone_hash) DO UPDATE SET wallet_init = $2, pending_actions = $3`,
      [phoneHash, walletInit, pendingActions]
    );
    return 'User info saved';
  } catch (err) {
    console.error('Error inserting user:', err);
    throw err;
  }
}

// Update user
export async function updateUser(
  phoneHash: string,
  updates: { wallet_init?: boolean; pending_actions?: string | null }
): Promise<string> {
  try {
    phoneHash = validatePhoneHash(phoneHash);
    const setClauses: string[] = [];
    const values: (boolean | string | null)[] = [];
    let idx = 1;

    if (updates.wallet_init !== undefined) {
      setClauses.push(`wallet_init = $${idx++}`);
      values.push(validateWalletInit(updates.wallet_init));
    }

    if (updates.pending_actions !== undefined) {
      updates.pending_actions = validatePendingActions(updates.pending_actions);
      setClauses.push(`pending_actions = $${idx++}`);
      values.push(updates.pending_actions);
    }

    if (!setClauses.length) {
      throw new Error('No updates provided');
    }

    const query = `UPDATE users SET ${setClauses.join(', ')} WHERE phone_hash = $${idx}`;
    values.push(phoneHash);

    const res = await pool.query(query, values);
    if (res.rowCount === 0) {
      throw new Error('User not found');
    }
    return 'Updated';
  } catch (err) {
    console.error('Error updating user:', err);
    throw err;
  }
}

// Optionally close pool on process exit (not strictly needed for Express, but good practice).
process.on('exit', async () => {
  await pool.end();
});
