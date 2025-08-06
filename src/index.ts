// Import Express, types, DB, parser, and Solana.
import express from 'express';
import { Request, Response } from 'express';
import { insertUser, getUser, updateUser } from './db.ts';
import { parseIntent } from './parser.ts';
import { hashPhone } from './utils.ts';
import dotenv from 'dotenv';
import { Buffer } from 'buffer';
import crypto from 'crypto';

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

// Constants for readability/simplicity
const EXPIRES_MS = 5 * 60 * 1000; // 5 minutes
const MAX_BODY_LENGTH = 160; // SMS-like limit for validation
const WELCOME_MSG =
  "Hi from Tella 👋,\n\nWe're the easiest way to send money via SMS — secure 🔒 and reliable 🛡️"; //  Welcome msg

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
      .send('<Response><Message>Invalid phone number 🚫</Message></Response>');
    return;
  }

  // Validate body (SMS-like length limit, prevent empty/bad)
  if (
    typeof body !== 'string' ||
    body.trim() === '' ||
    body.length > MAX_BODY_LENGTH
  ) {
    res
      .status(200)
      .send('<Response><Message>Invalid message 🚫</Message></Response>');
    return;
  }
  // Parsing intent
  try {
    const parsed = await parseIntent(body);
    if (
      !parsed.recipient ||
      typeof parsed.recipient !== 'string' ||
      parsed.recipient.trim() === ''
    ) {
      res
        .status(200)
        .send(
          '<Response><Message>Recipient not provided ⚠️</Message></Response>'
        );
      return;
    }

    let recipientHash: string;
    // Hash recipient phone
    try {
      recipientHash = hashPhone(parsed.recipient);
    } catch (error) {
      console.error('Recipient hashing error:', error);
      res
        .status(200)
        .send(
          '<Response><Message>Invalid recipient phone number 🚫</Message></Response>'
        );
      return;
    }

    // Compute byte hashes for PDAs/init
    const fromHashBytes = Uint8Array.from(Buffer.from(fromHash, 'hex'));

    // Derive PDAs/ATAs early for potential background init
    const { userPda: fromUserPda, ata: fromAta } = deriveUserPdaAndAta(
      fromHashBytes,
      programId,
      usdcMint
    );

    if (parsed.trigger === 'direct') {
      // Validate amount
      if (typeof parsed.amount !== 'number' || parsed.amount <= 0) {
        res
          .status(200)
          .send('<Response><Message>Invalid amount 🚫</Message></Response>');
        return;
      }

      // Check for self-transfer
      if (fromHash === recipientHash) {
        res
          .status(200)
          .send(
            '<Response><Message>Self-transfer not allowed 🚫</Message></Response>'
          );
        return;
      }

      // Check sender init from DB
      let senderInitialized = false;
      const existingSender = await getUser(fromHash);
      if (existingSender) {
        senderInitialized = existingSender.wallet_init === 1;
      }

      // Generate unique actionID for each send request
      const actionId = crypto.randomUUID();

      // Store pending action
      await insertUser(
        fromHash,
        senderInitialized,
        JSON.stringify({
          actionId,
          amount: parsed.amount,
          recipientHash,
          memo: parsed.memo,
          expires: Date.now() + EXPIRES_MS,
        })
      );

      // Insert recipient if not exists (init false, no pending)
      const existingRecipient = await getUser(recipientHash);
      if (!existingRecipient) {
        await insertUser(recipientHash, false);
      }

      // First-time welcome if new sender
      const welcome = !senderInitialized ? `${WELCOME_MSG}\n\n` : '';

      // Format memo
      const memo = parsed.memo ? ` for ${parsed.memo}` : '';
      res
        .status(200)
        .send(
          `<Response><Message>${welcome}Confirm sending $${parsed.amount} to ${parsed.recipient}${memo}❓</Message></Response>`
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
        let pending;
        try {
          pending = JSON.parse(user.pending_actions);
        } catch {
          res
            .status(200)
            .send(
              '<Response><Message>Invalid pending action</Message></Response>'
            );
          return;
        }

        // Check if expired
        if (Date.now() > pending.expires) {
          res
            .status(200)
            .send(
              '<Response><Message>Confirmation expired ⚠️</Message></Response>'
            ); // Send first for low latency
          await updateUser(fromHash, { pending_actions: null }); // Then update DB
          return;
        }

        // Retrieve actionID for logging
        const actionId = pending.actionId;

        const recipientHash = pending.recipientHash;
        const amount = pending.amount; // number
        const memo = pending.memo || ''; // empty string if not present

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

        // Pre-insert recipient if not in DB (ensures row exists for flag update)
        if (!(await getUser(recipientHash))) {
          await insertUser(recipientHash, false);
        }

        // Check and init recipient account if needed
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
          toAta,
          memo
        );
        console.log(
          `TX sent for ${fromHash} to ${recipientHash} with action ${actionId}: ${signature}`
        ); // Log TX signature for debugging.
        res
          .status(200)
          .send('<Response><Message>Sent ✅🔒💸</Message></Response>'); // Send first for low latency
        await updateUser(fromHash, { pending_actions: null }); // Then update DB
      } else {
        res
          .status(200)
          .send(
            '<Response><Message>No pending action found ⚠️</Message></Response>'
          );
      }
    } else {
      // Fallback for Invalid intent
      res
        .status(200)
        .send('<Response><Message>Invalid intent ⚠️</Message></Response>');
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res
      .status(200)
      .send('<Response><Message>Error parsing intent ⚠️</Message></Response>');
  }
});

// Start server.
app.listen(port, () => {
  console.log(`Tella server running on http://localhost:${port}`);
});
