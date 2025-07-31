import { Database } from 'sqlite3';
import { getUser, insertUser, updateUser } from '../db.ts';

// Helper: dummy valid SHA-256 hex (64 chars)
const dummyHash =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const dummyHashUpper = dummyHash.toUpperCase(); // For normalization test

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

    // Note: Adjust type in db.ts to include phone_hash: string if needed
    expect(user).toEqual({
      phone_hash: dummyHash,
      wallet_init: 1,
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
    expect(user?.pending_actions).toBe('');
  });

  // Edge / error cases for insertUser:

  test('insertUser rejects invalid phoneHash (too short)', async () => {
    await expect(insertUser('short')).rejects.toThrow(
      'Invalid input: phoneHash must be a valid SHA-256 hex string'
    );
  });

  test('insertUser rejects invalid phoneHash (too long)', async () => {
    const tooLong = '0'.repeat(65);
    await expect(insertUser(tooLong)).rejects.toThrow(
      'Invalid input: phoneHash must be a valid SHA-256 hex string'
    );
  });

  test('insertUser rejects invalid phoneHash (invalid chars)', async () => {
    const invalidHash = 'z'.repeat(64);
    await expect(insertUser(invalidHash)).rejects.toThrow(
      'Invalid input: phoneHash must be a valid SHA-256 hex string'
    );
  });

  test('insertUser rejects empty phoneHash', async () => {
    await expect(insertUser('')).rejects.toThrow(
      'Invalid input: phoneHash must be a non-empty string'
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

  // Special cases for insertUser:

  test('insertUser normalizes uppercase hash to lowercase', async () => {
    await insertUser(dummyHashUpper, true, '');
    const userLower = await getUser(dummyHash); // Query with lower
    expect(userLower?.wallet_init).toBe(1);

    const userUpper = await getUser(dummyHashUpper); // Query with upper, should find (normalized)
    expect(userUpper?.wallet_init).toBe(1);
  });

  test('insertUser overwrites existing user (INSERT OR REPLACE)', async () => {
    await insertUser(dummyHash, false, '');
    let user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(0);
    expect(user?.pending_actions).toBe('');

    await insertUser(dummyHash, true, '{"new":1}');
    user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(1);
    expect(user?.pending_actions).toBe('{"new":1}');
  });

  test('insertUser handles special chars in pendingActions (e.g., quotes)', async () => {
    const specialPending = JSON.stringify({ memo: 'Hello "world" \\n' }); // Escaped quotes
    await insertUser(dummyHash, false, specialPending);
    const user = await getUser(dummyHash);
    expect(user?.pending_actions).toBe(specialPending);
  });

  test('getUser rejects invalid phoneHash input', async () => {
    await expect(getUser('short')).rejects.toThrow(
      'Invalid input: phoneHash must be 64 characters long'
    );

    await expect(getUser('')).rejects.toThrow(
      'Invalid input: phoneHash must be a non-empty string'
    );

    const invalidHash = 'g'.repeat(64);
    await expect(getUser(invalidHash)).rejects.toThrow(
      'Invalid input: phoneHash must be a valid SHA-256 hex string'
    );
  });

  // Tests for updateUser:

  test('updateUser updates both wallet_init and pending_actions', async () => {
    await insertUser(dummyHash, false, '');
    await updateUser(dummyHash, {
      wallet_init: true,
      pending_actions: '{"updated":1}',
    });
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(1);
    expect(user?.pending_actions).toBe('{"updated":1}');
  });

  test('updateUser updates only wallet_init', async () => {
    await insertUser(dummyHash, false, '{"original":1}');
    await updateUser(dummyHash, { wallet_init: true });
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(1);
    expect(user?.pending_actions).toBe('{"original":1}');
  });

  test('updateUser updates only pending_actions', async () => {
    await insertUser(dummyHash, true, '{"original":1}');
    await updateUser(dummyHash, { pending_actions: '{"new":2}' });
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(1);
    expect(user?.pending_actions).toBe('{"new":2}');
  });

  test('updateUser sets pending_actions to null', async () => {
    await insertUser(dummyHash, true, '{"original":1}');
    await updateUser(dummyHash, { pending_actions: null });
    const user = await getUser(dummyHash);
    expect(user?.pending_actions).toBeNull(); // SQLite NULL
  });

  test('updateUser resolves on non-existent user (noop)', async () => {
    const nonExistentHash = 'ffffffffffffffffff'.padEnd(64, 'f');
    await expect(
      updateUser(nonExistentHash, { wallet_init: true })
    ).rejects.toThrow('User not found');
  });

  test('updateUser rejects if no updates provided', async () => {
    await expect(updateUser(dummyHash, {})).rejects.toThrow(
      'No updates provided'
    );
  });

  test('updateUser rejects invalid phoneHash (too short)', async () => {
    await expect(updateUser('short', { wallet_init: true })).rejects.toThrow(
      'Invalid input: phoneHash must be a valid SHA-256 hex string'
    );
  });

  test('updateUser rejects invalid phoneHash (invalid chars)', async () => {
    const invalidHash = 'z'.repeat(64);
    await expect(
      updateUser(invalidHash, { wallet_init: true })
    ).rejects.toThrow(
      'Invalid input: phoneHash must be a valid SHA-256 hex string'
    );
  });

  test('updateUser normalizes uppercase hash', async () => {
    await insertUser(dummyHash, false, '');
    await updateUser(dummyHashUpper, { wallet_init: true });
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(1);
  });

  test('updateUser handles special chars in pending_actions', async () => {
    await insertUser(dummyHash, false, '');
    const special = JSON.stringify({ memo: 'Hello "world" \\n' });
    await updateUser(dummyHash, { pending_actions: special });
    const user = await getUser(dummyHash);
    expect(user?.pending_actions).toBe(special);
  });

  // Additional integration/special cases:

  test('getUser after update reflects changes', async () => {
    await insertUser(dummyHash, true, '{"init":1}');
    await updateUser(dummyHash, { wallet_init: false, pending_actions: null });
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(0);
    expect(user?.pending_actions).toBeNull();
  });

  test('insertUser after update overwrites', async () => {
    await insertUser(dummyHash, false, '');
    await updateUser(dummyHash, { wallet_init: true });
    await insertUser(dummyHash, false, '{"overwritten":1}');
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(0); // Overwritten
    expect(user?.pending_actions).toBe('{"overwritten":1}');
  });
});
