import { Pool } from 'pg';
import { loadSecrets } from '../index.ts';

const dummyHash =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const dummyHashUpper = dummyHash.toUpperCase();

describe('DB', () => {
  let testPool: Pool;
  let getUser: typeof import('../db.ts').getUser;
  let insertUser: typeof import('../db.ts').insertUser;
  let updateUser: typeof import('../db.ts').updateUser;
  let initDbSchema: typeof import('../db.ts').initDbSchema;

  beforeAll(async () => {
    await loadSecrets();
    const dbModule = await import('../db.ts');
    getUser = dbModule.getUser;
    insertUser = dbModule.insertUser;
    updateUser = dbModule.updateUser;
    initDbSchema = dbModule.initDbSchema;

    testPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await initDbSchema();
  });

  beforeEach(async () => {
    await testPool.query('DELETE FROM users');
  });

  afterAll(async () => {
    await testPool.end();
  });

  // --- INSERT USER TESTS ---
  test('insertUser inserts with defaults', async () => {
    await expect(insertUser(dummyHash)).resolves.toBe('User info saved');
    const user = await getUser(dummyHash);
    expect(user).toEqual({
      phone_hash: dummyHash,
      wallet_init: false,
      pending_actions: '',
      is_bank_linked: false,
      plaid_access_token: '',
    });
  });

  test('insertUser overwrites existing user', async () => {
    await insertUser(dummyHash, false, '{}', false, '');
    await insertUser(dummyHash, true, '{"updated":1}', true, 'token123');

    const user = await getUser(dummyHash);
    expect(user).toEqual({
      phone_hash: dummyHash,
      wallet_init: true,
      pending_actions: '{"updated":1}',
      is_bank_linked: true,
      plaid_access_token: 'token123',
    });
  });

  test('insertUser rejects invalid phoneHash', async () => {
    await expect(insertUser('short')).rejects.toThrow();
    await expect(insertUser('g'.repeat(64))).rejects.toThrow();
    await expect(insertUser('')).rejects.toThrow();
  });

  test('insertUser rejects invalid types', async () => {
    // @ts-expect-error testing w/ invalid types
    await expect(insertUser(dummyHash, 'true')).rejects.toThrow();
    // @ts-expect-error testing w/ invalid types
    await expect(insertUser(dummyHash, false, 123)).rejects.toThrow();
    // @ts-expect-error at this point you should know
    await expect(insertUser(dummyHash, false, '', 'true')).rejects.toThrow();

    await expect(
      // @ts-expect-error testing w/ invalid types
      insertUser(dummyHash, false, '', false, 123)
    ).rejects.toThrow();
  });

  test('insertUser normalizes uppercase hash', async () => {
    await insertUser(dummyHashUpper, true, '{}');
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(true);
  });

  // --- GET USER TESTS ---
  test('getUser returns null for non-existent user', async () => {
    const user = await getUser('f'.repeat(64));
    expect(user).toBeNull();
  });

  test('getUser rejects invalid phoneHash', async () => {
    await expect(getUser('short')).rejects.toThrow();
    await expect(getUser('')).rejects.toThrow();
    await expect(getUser('g'.repeat(64))).rejects.toThrow();
  });

  // --- UPDATE USER TESTS ---
  test('updateUser updates wallet_init only', async () => {
    await insertUser(dummyHash, false, '{"original":1}');
    await updateUser(dummyHash, { wallet_init: true });
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(true);
    expect(user?.pending_actions).toBe('{"original":1}');
  });

  test('updateUser updates pending_actions only', async () => {
    await insertUser(dummyHash, true, '{"original":1}');
    await updateUser(dummyHash, { pending_actions: '{"new":2}' });
    const user = await getUser(dummyHash);
    expect(user?.pending_actions).toBe('{"new":2}');
    expect(user?.wallet_init).toBe(true);
  });

  test('updateUser sets pending_actions to null', async () => {
    await insertUser(dummyHash, true, '{"original":1}');
    await updateUser(dummyHash, { pending_actions: null });
    const user = await getUser(dummyHash);
    expect(user?.pending_actions).toBeNull();
  });

  test('updateUser updates is_bank_linked only', async () => {
    await insertUser(dummyHash, false, '{}', false);
    await updateUser(dummyHash, { is_bank_linked: true });
    const user = await getUser(dummyHash);
    expect(user?.is_bank_linked).toBe(true);
  });

  test('updateUser updates plaid_access_token only', async () => {
    await insertUser(dummyHash);
    await updateUser(dummyHash, { plaid_access_token: 'token123' });
    const user = await getUser(dummyHash);
    expect(user?.plaid_access_token).toBe('token123');
  });

  test('updateUser sets plaid_access_token to null', async () => {
    await insertUser(dummyHash, false, '', false, 'token123');
    await updateUser(dummyHash, { plaid_access_token: null });
    const user = await getUser(dummyHash);
    expect(user?.plaid_access_token).toBeNull();
  });

  test('updateUser updates multiple fields at once', async () => {
    await insertUser(dummyHash, false, '{"orig":1}', false, 'token0');
    await updateUser(dummyHash, {
      wallet_init: true,
      pending_actions: '{"updated":1}',
      is_bank_linked: true,
      plaid_access_token: 'token123',
    });
    const user = await getUser(dummyHash);
    expect(user).toEqual({
      phone_hash: dummyHash,
      wallet_init: true,
      pending_actions: '{"updated":1}',
      is_bank_linked: true,
      plaid_access_token: 'token123',
    });
  });

  test('updateUser rejects if no updates provided', async () => {
    await insertUser(dummyHash);
    await expect(updateUser(dummyHash, {})).rejects.toThrow(
      'No updates provided'
    );
  });

  test('updateUser rejects non-existent user', async () => {
    const nonExistent = 'f'.repeat(64);
    await expect(
      updateUser(nonExistent, { wallet_init: true })
    ).rejects.toThrow('User not found');
  });

  test('updateUser normalizes uppercase hash', async () => {
    await insertUser(dummyHash, false);
    await updateUser(dummyHashUpper, { wallet_init: true });
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(true);
  });

  test('updateUser handles special chars in pending_actions', async () => {
    await insertUser(dummyHash, false);
    const special = JSON.stringify({ memo: 'Hello "world" \\n' });
    await updateUser(dummyHash, { pending_actions: special });
    const user = await getUser(dummyHash);
    expect(user?.pending_actions).toBe(special);
  });

  test('updateUser handles special chars in plaid_access_token', async () => {
    await insertUser(dummyHash);
    const special = 'tok"en\\123';
    await updateUser(dummyHash, { plaid_access_token: special });
    const user = await getUser(dummyHash);
    expect(user?.plaid_access_token).toBe(special);
  });
});
