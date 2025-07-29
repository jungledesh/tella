// Test DB functions with in-memory SQLite.
import { Database } from 'sqlite3';
import { getUser, insertUser } from '../db.ts';

describe('DB', () => {
  let db: Database;

  beforeEach(async () => {
    db = new Database(':memory:'); // In-memory DB for tests.
    db.serialize(() => {
      db.run(`
        CREATE TABLE users (
          phone_hash TEXT PRIMARY KEY,
          wallet_init BOOLEAN DEFAULT 0,
          pending_actions TEXT
        )
      `);
    });
  });

  afterEach(() => {
    db.close();
  });

  test('insertUser and getUser work correctly', async () => {
    const phoneHash = 'test_hash';
    const pending = JSON.stringify({ amount: 10 });
    await insertUser(phoneHash, true, pending);
    const user = await getUser(phoneHash);
    expect(user).toEqual({
      phone_hash: phoneHash,
      wallet_init: 1,
      pending_actions: pending,
    });
    expect(await insertUser(phoneHash)).toBe('User info saved');
  });
});
