// Import Express, types, DB, and parser.
import express from 'express';
import { Request, Response } from 'express';
import { insertUser, getUser } from './db.ts';
import { parseIntent } from './parser.ts';
import { hashPhone } from './utils.ts';

// Create Express app.
const app = express();

// Set server port.
const port = 3000;

// Middleware to parse URL-encoded bodies.
app.use(express.urlencoded({ extended: true }));

// GET route for root.
app.get('/', (_: Request, res: Response) => {
  res.send('Tella server is running!');
});

// POST route for SMS webhook.
app.post('/sms', async (req: Request, res: Response) => {
  const from = req.body.From || 'unknown';
  const body = req.body.Body || '';
  const fromHash = hashPhone(from);

  try {
    const parsed = await parseIntent(body);
    const recipientHash = parsed.recipient ? hashPhone(parsed.recipient) : '';

    if (parsed.trigger === 'direct') {
      await insertUser(
        fromHash,
        false,
        JSON.stringify({
          amount: parsed.amount,
          recipientHash,
          memo: parsed.memo,
          expires: Date.now() + 5 * 60 * 1000,
        })
      );
      res
        .status(200)
        .send(
          `<Response><Message>Confirm sending $${parsed.amount} to ${parsed.recipient}?</Message></Response>`
        );
    } else if (parsed.trigger === 'confirmation') {
      const user = await getUser(fromHash);
      if (user?.pending_actions) {
        res.status(200).send('<Response><Message>Sent</Message></Response>');
      } else {
        res
          .status(200)
          .send(
            '<Response><Message>No pending action found</Message></Response>'
          );
      }
    } else {
      res
        .status(200)
        .send('<Response><Message>Invalid intent</Message></Response>');
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res
      .status(200)
      .send('<Response><Message>Error parsing intent</Message></Response>');
  }
});

// Start server.
app.listen(port, () => {
  console.log(`Tella server running on http://localhost:${port}`);
});

// Test DB and parser.
(async () => {
  const parsed = await parseIntent('Send $10 to +1 (669) 262-8341 for lunch');
  console.log('Parsed intent:', parsed);
})();
