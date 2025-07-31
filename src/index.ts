// Import Express, types, DB, parser, and Solana.
import express from 'express';
import { Request, Response } from 'express';
import { insertUser, getUser } from './db.ts';
import { parseIntent } from './parser.ts';
import { hashPhone } from './utils.ts';
import dotenv from 'dotenv';
import { Buffer } from 'buffer';

// Program related logic
import {
  deriveUserPdaAndAta,
  executeP2pTransfer,
  initUserIfNeeded,
  usdcMint,
  programId,
} from './intent_gateway.ts';

// Load env vars.
dotenv.config();

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
  // Hashing phone #
  const from = req.body.From || 'unknown';
  const body = req.body.Body || '';
  let fromHash: string;
  try {
    fromHash = hashPhone(from);
  } catch (error) {
    console.error('Hashing error:', error);
    res
      .status(200)
      .send('<Response><Message>Invalid phone number</Message></Response>');
    return;
  }

  // Parsing intent
  try {
    const parsed = await parseIntent(body);
    const recipientHash = parsed.recipient ? hashPhone(parsed.recipient) : '';

    // Compute byte hashes for PDAs/init
    const fromHashBytes = Uint8Array.from(Buffer.from(fromHash, 'hex'));

    // Derive PDAs/ATAs early for potential background init
    const { userPda: fromUserPda, ata: fromAta } = deriveUserPdaAndAta(
      fromHashBytes,
      programId,
      usdcMint
    );

    if (parsed.trigger === 'direct') {
      // Check sender init from DB
      let senderInitialized = false;
      const existingSender = await getUser(fromHash);
      if (existingSender) {
        senderInitialized = existingSender.wallet_init === 1;
      }

      // Store pending action
      await insertUser(
        fromHash,
        senderInitialized,
        JSON.stringify({
          amount: parsed.amount,
          recipientHash,
          memo: parsed.memo,
          expires: Date.now() + 5 * 60 * 1000,
        })
      );

      // Insert recipient if not exists (init false, no pending)
      const existingRecipient = await getUser(recipientHash);
      if (!existingRecipient) {
        await insertUser(recipientHash, false);
      }

      res
        .status(200)
        .send(
          `<Response><Message>Confirm sending $${parsed.amount} to ${parsed.recipient}?</Message></Response>`
        );

      // Background: Init sender if needed (async, after response)
      if (!senderInitialized) {
        initUserIfNeeded(fromHash, fromHashBytes, fromUserPda, fromAta).catch(
          (error) => {
            console.error(
              `Background init error for sender ${fromHash}:`,
              error
            );
            // Optional: Add retry logic or alert here if needed
          }
        );
      }
    } else if (parsed.trigger === 'confirmation') {
      // Execute transaction
      const user = await getUser(fromHash);
      if (user?.pending_actions) {
        // Parse pending actions JSON
        const pending = JSON.parse(user.pending_actions);

        const recipientHash = pending.recipientHash;
        const amount = pending.amount; // number

        // Convert hash strings to bytes (Uint8Array)
        const toHashBytes = Uint8Array.from(Buffer.from(recipientHash, 'hex'));

        // Derive PDA + ATA
        const { userPda: toUserPda, ata: toAta } = deriveUserPdaAndAta(
          toHashBytes,
          programId,
          usdcMint
        );

        // Fallback: Check and init sender if not (though background should have handled)
        const senderUser = await getUser(fromHash);
        if (!senderUser || senderUser.wallet_init !== 1) {
          await initUserIfNeeded(fromHash, fromHashBytes, fromUserPda, fromAta);
        }

        // Check and init user accs if needed
        const recipientUser = await getUser(recipientHash);
        if (!recipientUser || recipientUser.wallet_init !== 1) {
          await initUserIfNeeded(recipientHash, toHashBytes, toUserPda, toAta);
        }

        // Build and send transfer TX
        const signature = await executeP2pTransfer(
          fromHashBytes,
          toHashBytes,
          amount,
          fromUserPda,
          fromAta,
          toUserPda,
          toAta
        );
        console.log(`TX sent: ${signature}`); // Log TX signature for debugging.
        res.status(200).send('<Response><Message>Sent</Message></Response>');
      } else {
        res
          .status(200)
          .send(
            '<Response><Message>No pending action found</Message></Response>'
          );
      }
    } else {
      // Fallback for Invalid intent
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
