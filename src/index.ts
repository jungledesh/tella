// Import Express and types for server framework.
import express from 'express';
import { Request, Response } from 'express';
import { insertUser, getUser } from './db.ts';
import { hashPhone } from './utils.ts';

// Create Express app instance.
const app = express();

// Set server port.
const port = 3000;

// Middleware to parse URL-encoded bodies (e.g., Twilio POST).
app.use(express.urlencoded({ extended: true }));

// GET route for root to test server.
app.get('/', (req: Request, res: Response) => {
  res.send('Tella server is running!');
});

// POST route for SMS webhook stub.
app.post('/sms', (req: Request, res: Response) => {
  const from = req.body.From || 'unknown'; // Extract sender phone.
  const body = req.body.Body || ''; // Extract message body.
  console.log(`Received SMS from ${from}: ${body}`); // Log for debugging.
  res.status(200).send('<Response></Response>'); // Return TwiML for Twilio.
});

// Start server on port.
app.listen(port, () => {
  console.log(`Tella server running on http://localhost:${port}`);
});

// Test DB functions on start (add this block here).
(async () => {
  const msg = await insertUser(
    'test_hash',
    true,
    JSON.stringify({ amount: 10 })
  );
  console.log('Insert result:', msg); // "User info saved"
  const user = await getUser('test_hash');
  console.log('Test user:', user);
})();

// Test hashing with DB insert.
const testPhone = '+1234567890';
const hashed = hashPhone(testPhone);
const msg = await insertUser(hashed, true, JSON.stringify({ amount: 10 }));
console.log('Insert result:', msg); // "User info saved"
const user = await getUser(hashed);
console.log('Test user:', user);
