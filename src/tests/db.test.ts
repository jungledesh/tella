import { Pool } from 'pg';
import { getUser, insertUser, updateUser, initDbSchema } from '../db.ts';

// Helper: dummy valid SHA-256 hex (64 chars)
const dummyHash =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const dummyHashUpper = dummyHash.toUpperCase(); // For normalization test

describe('DB', () => {
  let testPool: Pool;

  beforeAll(async () => {
    testPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await initDbSchema(); // Run once for the suite
  });

  beforeEach(async () => {
    await testPool.query('DELETE FROM users'); // Cleanup data per test
  });

  afterAll(async () => {
    await testPool.end(); // Close at end of suite
  });

  test('insertUser and getUser work correctly with valid input', async () => {
    const pendingObj = { amount: 10 };
    const pending = JSON.stringify(pendingObj);
    await insertUser(dummyHash, true, pending);
    const user = await getUser(dummyHash);

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
    await insertUser(dummyHash, false, '{}');
    const user = await getUser(dummyHash);
    expect(user?.pending_actions).toEqual('{}');
  });

  // Edge / error cases for insertUser:

  test('insertUser rejects invalid phoneHash (too short)', async () => {
    await expect(insertUser('short')).rejects.toThrow(
      'Invalid phoneHash: must be 64-char hex'
    );
  });

  test('insertUser rejects invalid phoneHash (too long)', async () => {
    const tooLong = '0'.repeat(65);
    await expect(insertUser(tooLong)).rejects.toThrow(
      'Invalid phoneHash: must be 64-char hex'
    );
  });

  test('insertUser rejects invalid phoneHash (invalid chars)', async () => {
    const invalidHash = 'z'.repeat(64);
    await expect(insertUser(invalidHash)).rejects.toThrow(
      'Invalid phoneHash: must be 64-char hex'
    );
  });

  test('insertUser rejects empty phoneHash', async () => {
    await expect(insertUser('')).rejects.toThrow(
      'Invalid phoneHash: non-empty string required'
    );
  });

  test('insertUser rejects non-boolean walletInit', async () => {
    // @ts-expect-error deliberate wrong type
    await expect(insertUser(dummyHash, 'true')).rejects.toThrow(
      'Invalid walletInit: boolean required'
    );
  });

  test('insertUser rejects non-string pendingActions', async () => {
    // @ts-expect-error deliberate wrong type
    await expect(insertUser(dummyHash, false, 123)).rejects.toThrow(
      'Invalid pendingActions: string required'
    );
  });

  // Special cases for insertUser:

  test('insertUser normalizes uppercase hash to lowercase', async () => {
    await insertUser(dummyHashUpper, true, '{}');
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
      'Invalid phoneHash: must be 64-char hex'
    );

    await expect(getUser('')).rejects.toThrow(
      'Invalid phoneHash: non-empty string required'
    );

    const invalidHash = 'g'.repeat(64);
    await expect(getUser(invalidHash)).rejects.toThrow(
      'Invalid phoneHash: must be 64-char hex'
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
    expect(user?.pending_actions).toBeNull();
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
      'Invalid phoneHash: must be 64-char hex'
    );
  });

  test('updateUser rejects invalid phoneHash (invalid chars)', async () => {
    const invalidHash = 'z'.repeat(64);
    await expect(
      updateUser(invalidHash, { wallet_init: true })
    ).rejects.toThrow('Invalid phoneHash: must be 64-char hex');
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
