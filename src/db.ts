// Import pg for PostgreSQL connection pooling.
import { Pool } from 'pg';

// Create connection pool using DATABASE_URL from env.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Disable strict SSL for dev; enable in prod with cert validation.
});

// Init users table if not exists (run once or on startup).
export async function initDbSchema() {
  const client = await pool.connect();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        phone_hash TEXT PRIMARY KEY,
        wallet_init BOOLEAN DEFAULT FALSE,
        pending_actions TEXT,
        is_bank_linked BOOLEAN DEFAULT FALSE,
        plaid_access_token TEXT
      );
    `);
    console.log('Users table initialized.');
  } catch (err) {
    console.error('Error initializing DB schema:', err);
    throw err;
  } finally {
    client.release();
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

function validateBankLinked(isBankLinked: boolean): number {
  if (typeof isBankLinked !== 'boolean') {
    throw new Error('Invalid is_bank_linked: boolean required');
  }
  return isBankLinked ? 1 : 0;
}

function validatePlaidToken(plaidAccessToken: string): string {
  if (typeof plaidAccessToken !== 'string') {
    throw new Error('Invalid plaid_access_token: string required');
  }
  return plaidAccessToken;
}

// Get user
export async function getUser(phoneHash: string): Promise<{
  wallet_init: number;
  pending_actions: string;
  is_bank_linked: number;
  plaid_access_token: string;
} | null> {
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
  pendingActions: string = '',
  is_bank_linked: boolean = false,
  plaid_access_token: string = ''
): Promise<string> {
  try {
    phoneHash = validatePhoneHash(phoneHash);
    const initVal = validateWalletInit(walletInit);
    pendingActions = validatePendingActions(pendingActions);
    const initBankLink = validateBankLinked(is_bank_linked);
    plaid_access_token = validatePlaidToken(plaid_access_token);

    await pool.query(
      `INSERT INTO users (phone_hash, wallet_init, pending_actions, is_bank_linked, plaid_access_token)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (phone_hash) DO UPDATE SET wallet_init = $2, pending_actions = $3, is_bank_linked = $4, plaid_access_token = $5`,
      [phoneHash, initVal, pendingActions, initBankLink, plaid_access_token]
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
  updates: {
    wallet_init?: boolean;
    pending_actions?: string | null;
    is_bank_linked?: boolean;
    plaid_access_token?: string | null;
  }
): Promise<string> {
  try {
    phoneHash = validatePhoneHash(phoneHash);
    const setClauses: string[] = [];
    const values: (number | string | null)[] = [];
    let idx = 1;

    if (updates.wallet_init !== undefined) {
      setClauses.push(`wallet_init = $${idx++}`);
      values.push(validateWalletInit(updates.wallet_init));
    }

    if (updates.pending_actions !== undefined) {
      if (updates.pending_actions !== null) {
        validatePendingActions(updates.pending_actions);
      }
      setClauses.push(`pending_actions = $${idx++}`);
      values.push(updates.pending_actions);
    }

    if (updates.is_bank_linked !== undefined) {
      setClauses.push(`is_bank_linked = $${idx++}`);
      values.push(validateBankLinked(updates.is_bank_linked));
    }

    if (updates.plaid_access_token !== undefined) {
      if (updates.plaid_access_token != null) {
        validatePlaidToken(updates.plaid_access_token);
      }
      setClauses.push(`plaid_access_token= $${idx++}`);
      values.push(updates.plaid_access_token);
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

process.on('exit', async () => {
  await pool.end();
});
