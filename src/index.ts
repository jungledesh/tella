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
const MAX_BODY_LENGTH = 320; // SMS-like limit for validation
const WELCOME_MSG =
  'Hi from Tella 👋,\nThe easiest way to send money via SMS — secure 🔒 and reliable 🛡️'; //  Welcome msg

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
  // Get body
  const from = req.body.From || 'unknown';
  const body = req.body.Body || '';

  // Validate + hash sender phone
  let fromHash: string;
  try {
    fromHash = hashPhone(from);
  } catch (error) {
    console.error('Hashing error:', error);
    return sendSmsRes(res, 'Invalid sender phone number 🚫');
  }

  // Validate body (SMS-like length limit, prevent empty/bad)
  if (
    typeof body !== 'string' ||
    body.trim() === '' ||
    body.length > MAX_BODY_LENGTH
  ) {
    return sendSmsRes(res, 'Invalid message 🚫');
  }

  // Parsing intent
  try {
    const parsed = await parseIntent(body);

    console.log('Trigger: ', parsed.trigger);

    if (parsed.trigger === 'direct') {
      await handleDirectIntent(res, fromHash, parsed);
    } else if (parsed.trigger === 'confirmation') {
      await handleConfirmationIntent(res, fromHash);
    } else {
      return sendSmsRes(res, 'Invalid intent ⚠️');
    }
  } catch (err) {
    console.error('SMS error:', err);
    return sendSmsRes(res, 'Error parsing intent ⚠️');
  }
});

// Handle 'direct' send intent
async function handleDirectIntent(
  res: Response,
  fromHash: string,
  parsed: { amount: number; recipient: string; memo: string }
) {
  // Validate recipient
  if (!parsed.recipient.trim()) {
    return sendSmsRes(res, 'Recipient missing ⚠️');
  }

  // Hash recipient
  let recipientHash: string;
  try {
    recipientHash = hashPhone(parsed.recipient);
  } catch (err) {
    console.error('Recipient hash error:', err);
    return sendSmsRes(res, 'Invalid recipient 🚫');
  }

  // Prevent self-send
  if (fromHash === recipientHash) {
    return sendSmsRes(res, 'Self-send not allowed 🚫');
  }

  // Validate amount
  if (parsed.amount <= 0) {
    return sendSmsRes(res, 'Invalid amount 🚫');
  }

  // Derive sender PDA/ATA
  const fromHashBytes = Uint8Array.from(Buffer.from(fromHash, 'hex'));
  const { userPda: fromPda, ata: fromAta } = deriveUserPdaAndAta(
    fromHashBytes,
    programId,
    usdcMint
  );

  // Get/check sender in DB
  const sender = await getUser(fromHash);
  const senderInit = sender?.wallet_init === 1;

  // Generate action ID
  const actionId = crypto.randomUUID();

  // Store pending
  await insertUser(
    fromHash,
    senderInit,
    JSON.stringify({
      actionId,
      amount: parsed.amount,
      recipientHash,
      memo: parsed.memo,
      expires: Date.now() + EXPIRES_MS,
    })
  );

  // Insert recipient if new
  if (!(await getUser(recipientHash))) {
    await insertUser(recipientHash, false);
  }

  // Welcome if new
  const welcome = senderInit ? '' : `${WELCOME_MSG}\n\n`;

  // Send confirm
  const memoTxt = parsed.memo ? ` for ${parsed.memo}` : '';
  sendSmsRes(
    res,
    `${welcome}Confirm sending $${parsed.amount} to ${parsed.recipient}${memoTxt}❓`
  );

  // Background init sender
  if (!senderInit) {
    initUserIfNeeded(fromHash, fromHashBytes, fromPda, fromAta).catch((err) =>
      console.error(`Init error ${fromHash}:`, err)
    );
  }
}

// Handle 'confirmation' intent
async function handleConfirmationIntent(res: Response, fromHash: string) {
  const user = await getUser(fromHash);
  if (!user?.pending_actions) {
    return sendSmsRes(res, 'No pending transfer ⚠️');
  }

  // Parse pending
  let pending: {
    actionID: string;
    amount: number;
    recipientHash: string;
    memo: string;
    expires: number;
  };
  try {
    pending = JSON.parse(user.pending_actions);
  } catch {
    await updateUser(fromHash, { pending_actions: null });
    return sendSmsRes(res, 'Invalid pending transfer ⚠️');
  }

  const { actionID, amount, recipientHash, memo, expires } = pending;

  // Check expired
  if (Date.now() > expires) {
    await updateUser(fromHash, { pending_actions: null });
    return sendSmsRes(res, 'Transfer expired ⚠️');
  }

  // Bytes
  const fromHashBytes = Uint8Array.from(Buffer.from(fromHash, 'hex'));
  const toHashBytes = Uint8Array.from(Buffer.from(recipientHash, 'hex'));

  // Derive PDAs/ATAs
  const { userPda: fromPda, ata: fromAta } = deriveUserPdaAndAta(
    fromHashBytes,
    programId,
    usdcMint
  );
  const { userPda: toPda, ata: toAta } = deriveUserPdaAndAta(
    toHashBytes,
    programId,
    usdcMint
  );

  // Init sender if needed, remove when you add re-tries
  const sender = await getUser(fromHash);
  if (!sender || sender.wallet_init !== 1) {
    await initUserIfNeeded(fromHash, fromHashBytes, fromPda, fromAta);
  }

  // Init recipient if needed
  const recipient = await getUser(recipientHash);
  if (!recipient || recipient.wallet_init !== 1) {
    await initUserIfNeeded(recipientHash, toHashBytes, toPda, toAta);
  }

  // Execute transfer
  const sig = await executeP2pTransfer(
    fromHashBytes,
    toHashBytes,
    amount,
    fromPda,
    fromAta,
    toPda,
    toAta,
    memo
  );
  console.log(
    `TX sent for ${fromHash} to ${recipientHash} with action ${actionID}: ${sig}`
  );
  // Update user
  sendSmsRes(res, 'Sent ✅🔒💸');

  // Clear pending
  await updateUser(fromHash, { pending_actions: null });
}

// Helper: Send XML SMS response
function sendSmsRes(res: Response, msg: string) {
  res.status(200).send(`<Response><Message>${msg}</Message></Response>`);
}

// Start server.
app.listen(port, () => {
  console.log(`Tella server running on http://localhost:${port}`);
});
