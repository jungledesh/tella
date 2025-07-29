import { Database } from 'sqlite3';
import { getUser, insertUser } from '../db.ts';

// Helper: dummy valid SHA-256 hex (64 chars)
const dummyHash =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('DB', () => {
  let db: Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await new Promise<void>((resolve) => {
      db.serialize(() => {
        db.run(
          `
          CREATE TABLE users (
            phone_hash TEXT PRIMARY KEY,
            wallet_init BOOLEAN DEFAULT 0,
            pending_actions TEXT
          )
        `,
          () => resolve()
        );
      });
    });
  });

  afterEach(() => {
    db.close();
  });

  test('insertUser and getUser work correctly with valid input', async () => {
    const pending = JSON.stringify({ amount: 10 });
    await insertUser(dummyHash, true, pending);
    const user = await getUser(dummyHash);

    expect(user).toEqual({
      wallet_init: 1,
      phone_hash: dummyHash,
      pending_actions: pending,
    });

    // Insert again with default params
    await expect(insertUser(dummyHash)).resolves.toBe('User info saved');
  });

  test('getUser returns null for non-existent user', async () => {
    const user = await getUser(dummyHash.replace(/0/g, 'f'));
    expect(user).toBeNull();
  });

  test('insertUser handles empty pendingActions', async () => {
    await insertUser(dummyHash, false, '');
    const user = await getUser(dummyHash);
    // Should return empty string or null depending on DB; adjust if needed
    expect(user?.pending_actions).toBe('');
  });

  // Edge / error cases:

  test('insertUser rejects invalid phoneHash (too short)', async () => {
    await expect(insertUser('short')).rejects.toThrow(
      'Invalid input: phoneHash must be a valid SHA-256 hex string'
    );
  });

  test('insertUser rejects invalid phoneHash (invalid chars)', async () => {
    const invalidHash = 'z'.repeat(64);
    await expect(insertUser(invalidHash)).rejects.toThrow(
      'Invalid input: phoneHash must be a valid SHA-256 hex string'
    );
  });

  test('insertUser rejects non-boolean walletInit', async () => {
    // @ts-expect-error deliberate wrong type
    await expect(insertUser(dummyHash, 'true')).rejects.toThrow(
      'Invalid input: walletInit must be a boolean'
    );
  });

  test('insertUser rejects non-string pendingActions', async () => {
    // @ts-expect-error deliberate wrong type
    await expect(insertUser(dummyHash, false, 123)).rejects.toThrow(
      'Invalid input: pendingActions must be a string'
    );
  });

  test('getUser rejects invalid phoneHash input', async () => {
    await expect(getUser('short')).rejects.toThrow(
      'Invalid input: phoneHash must be 64 characters long'
    );

    const invalidHash = 'g'.repeat(64);
    await expect(getUser(invalidHash)).rejects.toThrow(
      'Invalid input: phoneHash must be a valid SHA-256 hex string'
    );
  });
});
