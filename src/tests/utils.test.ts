// Test hashPhone function.
import { hashPhone } from '../utils.ts';

describe('Utils', () => {
  test('hashPhone produces consistent SHA-256 hash', () => {
    const phone = '+1234567890';
    const hash = hashPhone(phone);
    expect(hash).toHaveLength(64); // SHA-256 hex length.
    expect(hashPhone(phone)).toEqual(hash); // Deterministic.
  });
});
