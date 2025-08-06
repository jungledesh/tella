// Test hashPhone function.
import { hashPhone } from '../utils.ts';

describe('Utils', () => {
  test('hashPhone produces consistent SHA-256 hash', () => {
    const phone = '+12345678901';
    const hash = hashPhone(phone);
    expect(hash).toHaveLength(64); // SHA-256 hex length.
    expect(hashPhone(phone)).toEqual(hash); // Deterministic.
  });

  test('hashPhone throws error for empty phone', () => {
    expect(() => hashPhone('')).toThrow('Valid phone number is required');
  });

  test('hashPhone throws error for non-phone input', () => {
    expect(() => hashPhone('abc')).toThrow(
      'Phone number must contain only digits'
    );
  });

  test('hashPhone throws error for non-phone input', () => {
    expect(() => hashPhone('231abc123')).toThrow(
      'Phone number must contain at least 10 digits'
    );
  });

  test('hashPhone throws error for invalid country code input', () => {
    expect(() => hashPhone('01234567890')).toThrow(
      'Invalid country code. Only US numbers (+1) are supported'
    );
  });

  test('hashPhone throws error for 11+ digit input', () => {
    expect(() => hashPhone('0211234567890')).toThrow(
      'Invalid phone number: must be 10 digits or start with +1 followed by 10 digits'
    );
  });

  test('hashPhone handles formatted phone', () => {
    const hash = hashPhone('+1 (669) 262-8341');
    expect(hash).toHaveLength(64);
  });

  test('hashPhone handles formatted phone', () => {
    const hash = hashPhone('(669) 262-8341');
    expect(hash).toHaveLength(64);
  });
});
