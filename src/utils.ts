// Import crypto for secure hashing.
import crypto from 'crypto';

export function hashPhone(phone: string): string {
  const normalizedPhone = normalizePhoneToE164(phone); // E.164 format

  const secret = process.env.HASH_SECRET || 'your-fixed-secret-key';
  return crypto
    .createHmac('sha256', secret)
    .update(normalizedPhone)
    .digest('hex');
}

export function normalizePhoneToE164(phone: string): string {
  if (typeof phone !== 'string' || phone.trim() === '') {
    throw new Error('Phone number is required');
  }

  phone = phone.trim();

  // Strip all non-digit characters
  let digits = phone.replace(/\D/g, '');

  // Check for empty or too short digits
  if (digits.length === 0) {
    throw new Error('Phone number must contain digits');
  }

  if (digits.length < 10) {
    throw new Error('Phone number must contain at least 10 digits');
  }

  // Validate length (US/Canada: 10-digit or 11-digit with leading '1')
  if (digits.length === 10) {
    digits = '1' + digits; // Assume US number missing country code
  } else if (digits.length === 11 && !digits.startsWith('1')) {
    throw new Error('Invalid country code. Only US numbers (+1) are supported');
  } else if (digits.length !== 11) {
    throw new Error('Phone number must contain 10 or 11 digits');
  }

  return `+${digits}`; // E.164 format
}
