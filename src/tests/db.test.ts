import { Pool } from 'pg';
import { loadSecrets } from '../index.ts';

const dummyHash =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const dummyHashUpper = dummyHash.toUpperCase();
const dummyPhone = '+12025550123';
const dummyHashedPin = 'hashed_pin_123';
const dummyStripeCustomerId = 'cus_123456789';
const dummyStripePaymentMethodId = 'pm_123456789';

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
    await expect(
      insertUser(
        dummyHash,
        false,
        '',
        false,
        '1234567890',
        'dummyHashPin',
        dummyStripeCustomerId,
        dummyStripePaymentMethodId
      )
    ).resolves.toBe('User info saved');

    const user = await getUser(dummyHash);
    expect(user).toEqual({
      phone_hash: dummyHash,
      wallet_init: false,
      pending_actions: '',
      is_bank_linked: false,
      phone: '1234567890',
      hashed_pin: 'dummyHashPin',
      stripe_customer_id: dummyStripeCustomerId,
      stripe_payment_method_id: dummyStripePaymentMethodId,
    });
  });

  test('insertUser overwrites existing user', async () => {
    await insertUser(
      dummyHash,
      false,
      '{}',
      false,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
    await insertUser(
      dummyHash,
      true,
      '{"updated":1}',
      true,
      dummyPhone,
      'new_hashed_pin',
      'new_cus_123',
      'new_pm_123'
    );

    const user = await getUser(dummyHash);
    expect(user).toEqual({
      phone_hash: dummyHash,
      wallet_init: true,
      pending_actions: '{"updated":1}',
      is_bank_linked: true,
      phone: dummyPhone,
      hashed_pin: 'new_hashed_pin',
      stripe_customer_id: 'new_cus_123',
      stripe_payment_method_id: 'new_pm_123',
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
    // @ts-expect-error testing w/ invalid types
    await expect(insertUser(dummyHash, false, '', 'true')).rejects.toThrow();
    // @ts-expect-error testing w/ invalid types
    await expect(
      insertUser(dummyHash, false, '', false, true)
    ).rejects.toThrow();
    // @ts-expect-error testing w/ invalid types
    await expect(
      insertUser(dummyHash, false, '', false, '', true)
    ).rejects.toThrow();
    // @ts-expect-error testing w/ invalid types
    await expect(
      insertUser(dummyHash, false, '', false, '', '', true)
    ).rejects.toThrow();
    // @ts-expect-error testing w/ invalid types
    await expect(
      insertUser(dummyHash, false, '', false, '', '', '', true)
    ).rejects.toThrow();
  });

  test('insertUser normalizes uppercase hash', async () => {
    await insertUser(
      dummyHashUpper,
      true,
      '{}',
      true,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
    const user = await getUser(dummyHash);
    expect(user).toEqual({
      phone_hash: dummyHash,
      wallet_init: true,
      pending_actions: '{}',
      is_bank_linked: true,
      phone: dummyPhone,
      hashed_pin: dummyHashedPin,
      stripe_customer_id: dummyStripeCustomerId,
      stripe_payment_method_id: dummyStripePaymentMethodId,
    });
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
    await insertUser(
      dummyHash,
      false,
      '{"original":1}',
      false,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
    await updateUser(dummyHash, { wallet_init: true });
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(true);
    expect(user?.pending_actions).toBe('{"original":1}');
    expect(user?.phone).toBe(dummyPhone);
    expect(user?.hashed_pin).toBe(dummyHashedPin);
    expect(user?.stripe_customer_id).toBe(dummyStripeCustomerId);
    expect(user?.stripe_payment_method_id).toBe(dummyStripePaymentMethodId);
  });

  test('updateUser updates pending_actions only', async () => {
    await insertUser(
      dummyHash,
      true,
      '{"original":1}',
      false,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
    await updateUser(dummyHash, { pending_actions: '{"new":2}' });
    const user = await getUser(dummyHash);
    expect(user?.pending_actions).toBe('{"new":2}');
    expect(user?.wallet_init).toBe(true);
    expect(user?.phone).toBe(dummyPhone);
    expect(user?.hashed_pin).toBe(dummyHashedPin);
    expect(user?.stripe_customer_id).toBe(dummyStripeCustomerId);
    expect(user?.stripe_payment_method_id).toBe(dummyStripePaymentMethodId);
  });

  test('updateUser sets pending_actions to null', async () => {
    await insertUser(
      dummyHash,
      true,
      '{"original":1}',
      false,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
    await updateUser(dummyHash, { pending_actions: null });
    const user = await getUser(dummyHash);
    expect(user?.pending_actions).toBeNull();
    expect(user?.wallet_init).toBe(true);
    expect(user?.phone).toBe(dummyPhone);
    expect(user?.hashed_pin).toBe(dummyHashedPin);
    expect(user?.stripe_customer_id).toBe(dummyStripeCustomerId);
    expect(user?.stripe_payment_method_id).toBe(dummyStripePaymentMethodId);
  });

  test('updateUser updates is_bank_linked only', async () => {
    await insertUser(
      dummyHash,
      false,
      '{}',
      false,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
    await updateUser(dummyHash, { is_bank_linked: true });
    const user = await getUser(dummyHash);
    expect(user?.is_bank_linked).toBe(true);
    expect(user?.phone).toBe(dummyPhone);
    expect(user?.hashed_pin).toBe(dummyHashedPin);
    expect(user?.stripe_customer_id).toBe(dummyStripeCustomerId);
    expect(user?.stripe_payment_method_id).toBe(dummyStripePaymentMethodId);
  });

  test('updateUser updates Stripe fields', async () => {
    await insertUser(
      dummyHash,
      false,
      '{}',
      false,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
    await updateUser(dummyHash, {
      phone: '+12025550124',
      hashed_pin: 'new_hashed_pin',
      stripe_customer_id: 'new_cus_123',
      stripe_payment_method_id: 'new_pm_123',
    });
    const user = await getUser(dummyHash);
    expect(user).toEqual({
      phone_hash: dummyHash,
      wallet_init: false,
      pending_actions: '{}',
      is_bank_linked: false,
      phone: '+12025550124',
      hashed_pin: 'new_hashed_pin',
      stripe_customer_id: 'new_cus_123',
      stripe_payment_method_id: 'new_pm_123',
    });
  });

  test('updateUser updates multiple fields at once', async () => {
    await insertUser(
      dummyHash,
      false,
      '{"orig":1}',
      false,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
    await updateUser(dummyHash, {
      wallet_init: true,
      pending_actions: '{"updated":1}',
      is_bank_linked: true,
      phone: '+12025550124',
      hashed_pin: 'new_hashed_pin',
      stripe_customer_id: 'new_cus_123',
      stripe_payment_method_id: 'new_pm_123',
    });
    const user = await getUser(dummyHash);
    expect(user).toEqual({
      phone_hash: dummyHash,
      wallet_init: true,
      pending_actions: '{"updated":1}',
      is_bank_linked: true,
      phone: '+12025550124',
      hashed_pin: 'new_hashed_pin',
      stripe_customer_id: 'new_cus_123',
      stripe_payment_method_id: 'new_pm_123',
    });
  });

  test('updateUser rejects if no updates provided', async () => {
    await insertUser(
      dummyHash,
      false,
      '{"orig":1}',
      false,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
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
    await insertUser(
      dummyHash,
      false,
      '{}',
      false,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
    await updateUser(dummyHashUpper, { wallet_init: true });
    const user = await getUser(dummyHash);
    expect(user?.wallet_init).toBe(true);
  });

  test('updateUser handles special chars in pending_actions', async () => {
    await insertUser(
      dummyHash,
      false,
      '{}',
      false,
      dummyPhone,
      dummyHashedPin,
      dummyStripeCustomerId,
      dummyStripePaymentMethodId
    );
    const special = JSON.stringify({ memo: 'Hello "world" \\n' });
    await updateUser(dummyHash, { pending_actions: special });
    const user = await getUser(dummyHash);
    expect(user?.pending_actions).toBe(special);
    expect(user?.phone).toBe(dummyPhone);
    expect(user?.hashed_pin).toBe(dummyHashedPin);
    expect(user?.stripe_customer_id).toBe(dummyStripeCustomerId);
    expect(user?.stripe_payment_method_id).toBe(dummyStripePaymentMethodId);
  });
});
