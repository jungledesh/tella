// Import crypto for secure hashing.
import crypto from 'crypto';

// HMAC-SHA-256 for phone to user_id_hash (secret from env for unpredictability).
export function hashPhone(phone: string): string {
  const secret = process.env.HASH_SECRET || 'your-fixed-secret-key'; // Env for security, rotate if needed.
  return crypto.createHmac('sha256', secret).update(phone).digest('hex');
}
