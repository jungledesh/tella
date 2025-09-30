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
      CREATE TABLE IF NOT EXISTS users  (
        phone_hash TEXT PRIMARY KEY,
        wallet_init BOOLEAN DEFAULT FALSE,
        pending_actions TEXT,
        is_bank_linked BOOLEAN DEFAULT FALSE,
        phone TEXT UNIQUE,
        hashed_pin TEXT,
        stripe_customer_id TEXT,
        stripe_payment_method_id TEXT
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

function validatePhone(phone: string): string {
  if (typeof phone !== 'string' || phone.trim() === '') {
    throw new Error('Invalid phone: non-empty string required');
  }
  return phone;
}

function validateHashedPin(hashedPin: string): string {
  if (typeof hashedPin !== 'string' || hashedPin.trim() === '') {
    throw new Error('Invalid hashedPin: non-empty string required');
  }
  return hashedPin;
}

function validateStripeCustomerId(stripeCustomerId: string): string {
  if (typeof stripeCustomerId !== 'string' || stripeCustomerId.trim() === '') {
    throw new Error('Invalid stripeCustomerId: non-empty string required');
  }
  return stripeCustomerId;
}

function validateStripePaymentMethodId(stripePaymentMethodId: string): string {
  if (
    typeof stripePaymentMethodId !== 'string' ||
    stripePaymentMethodId.trim() === ''
  ) {
    throw new Error('Invalid stripePaymentMethodId: non-empty string required');
  }
  return stripePaymentMethodId;
}

// Get user
export async function getUser(phoneHash: string): Promise<{
  wallet_init: number;
  pending_actions: string;
  is_bank_linked: number;
  phone: string;
  hashed_pin: string;
  stripe_customer_id: string;
  stripe_payment_method_id: string;
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
  phone: string = '',
  hashedPin: string = '',
  stripeCustomerId: string = '',
  stripePaymentMethodId: string = ''
): Promise<string> {
  try {
    phoneHash = validatePhoneHash(phoneHash);
    const initVal = validateWalletInit(walletInit);
    pendingActions = validatePendingActions(pendingActions);
    const initBankLink = validateBankLinked(is_bank_linked);
    const validatedPhone = validatePhone(phone);
    const validatedHashedPin = validateHashedPin(hashedPin);
    const validatedStripeCustomerId =
      validateStripeCustomerId(stripeCustomerId);
    const validatedStripePaymentMethodId = validateStripePaymentMethodId(
      stripePaymentMethodId
    );

    await pool.query(
      `INSERT INTO users (
        phone_hash, wallet_init, pending_actions, is_bank_linked, 
        phone, hashed_pin, stripe_customer_id, stripe_payment_method_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (phone_hash) DO UPDATE SET 
        wallet_init = $2, 
        pending_actions = $3, 
        is_bank_linked = $4,
        phone = $5,
        hashed_pin = $6,
        stripe_customer_id = $7,
        stripe_payment_method_id = $8`,
      [
        phoneHash,
        initVal,
        pendingActions,
        initBankLink,
        validatedPhone,
        validatedHashedPin,
        validatedStripeCustomerId,
        validatedStripePaymentMethodId,
      ]
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
    phone?: string;
    hashed_pin?: string;
    stripe_customer_id?: string;
    stripe_payment_method_id?: string;
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

    if (updates.phone !== undefined) {
      setClauses.push(`phone = $${idx++}`);
      values.push(validatePhone(updates.phone));
    }

    if (updates.hashed_pin !== undefined) {
      setClauses.push(`hashed_pin = $${idx++}`);
      values.push(validateHashedPin(updates.hashed_pin));
    }

    if (updates.stripe_customer_id !== undefined) {
      setClauses.push(`stripe_customer_id = $${idx++}`);
      values.push(validateStripeCustomerId(updates.stripe_customer_id));
    }

    if (updates.stripe_payment_method_id !== undefined) {
      setClauses.push(`stripe_payment_method_id = $${idx++}`);
      values.push(
        validateStripePaymentMethodId(updates.stripe_payment_method_id)
      );
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
