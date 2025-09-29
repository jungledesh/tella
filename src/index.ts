// Import Express, types, DB, parser, and Solana.
import express from 'express';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { Request, Response } from 'express';
import { hashPhone, normalizePhoneToE164 } from './utils.ts';
import { Buffer } from 'buffer';
import crypto from 'crypto';
import twilio from 'twilio';
import Stripe from 'stripe';

// Functions we’ll import dynamically inside main/startServer
let insertUser: typeof import('./db.ts').insertUser;
let getUser: typeof import('./db.ts').getUser;
let updateUser: typeof import('./db.ts').updateUser;
let initDbSchema: typeof import('./db.ts').initDbSchema;
let deriveUserPdaAndAta: typeof import('./intent_gateway.ts').deriveUserPdaAndAta;
let executeP2pTransfer: typeof import('./intent_gateway.ts').executeP2pTransfer;
let initUserIfNeeded: typeof import('./intent_gateway.ts').initUserIfNeeded;
let usdcMint: typeof import('./intent_gateway.ts').usdcMint;
let programId: typeof import('./intent_gateway.ts').programId;
let parseIntent: typeof import('./parser.ts').parseIntent;

// Constants
const EXPIRES_MS = 5 * 60 * 1000; // 5 min
const MAX_BODY_LENGTH = 320;
const WELCOME_MSG = 'Tella 👋,\n Easiest way to send money — securely 🔒';

// Express app
const app = express();

// =======================
// Stripe Helper
// =======================
async function processStripeCustomer(
  stripe: Stripe,
  phone: string,
  paymentMethodId: string,
  idempotencyKey: string
) {
  // Create Stripe Customer
  const customer = await stripe.customers.create(
    {
      phone,
      metadata: { signupDate: new Date().toISOString() },
    },
    { idempotencyKey: `customer-${idempotencyKey}` }
  );

  // Attach Payment Method
  await stripe.paymentMethods.attach(paymentMethodId, {
    customer: customer.id,
  });

  // Set as default payment method
  await stripe.customers.update(customer.id, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });

  return customer.id;
}

// Type guard for Stripe errors
function isStripeError(
  error: unknown
): error is { statusCode: number; code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    'code' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number' &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

// =======================
// Exports
// =======================
export async function loadSecrets() {
  const smClient = new SecretsManagerClient({ region: 'us-west-1' });
  const command = new GetSecretValueCommand({
    SecretId:
      'arn:aws:secretsmanager:us-west-1:834873818995:secret:tella-secrets-G5Tmeo',
  });
  const response = await smClient.send(command);
  const secrets = JSON.parse(response.SecretString || '{}');
  Object.assign(process.env, secrets); // Merge into env
}

// =======================
// Main server logic
// =======================
async function startServer() {
  // Load secrets first
  await loadSecrets();

  // Initialize Twilio client after secrets are loaded
  const client: twilio.Twilio = twilio(
    process.env.TWILIO_SID,
    process.env.TWILIO_TOKEN
  );
  const tellaNumber = process.env.TELLA_NUMBER || '';

  // Initialize Stripe client
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-08-27.basil',
  });

  // Dynamically import modules after secrets loaded
  ({ insertUser, getUser, updateUser, initDbSchema } = await import('./db.ts'));
  ({ parseIntent } = await import('./parser.ts'));
  ({
    deriveUserPdaAndAta,
    executeP2pTransfer,
    initUserIfNeeded,
    usdcMint,
    programId,
  } = await import('./intent_gateway.ts'));

  try {
    // Init DB
    await initDbSchema();
    console.log('DB schema initialized successfully.');

    // Middleware
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    // Home Route
    app.get('/', (_: Request, res: Response) => {
      res.send('Tella server is running!');
    });

    // Landing Form Onboarding Route
    app.post('/api/signup', async (req: Request, res: Response) => {
      const { phone, hashedPin, paymentMethodId, idempotencyKey } = req.body;

      // Validate inputs
      if (!phone || !hashedPin || !paymentMethodId || !idempotencyKey) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Validate and normalize phone number
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizePhoneToE164(phone);
      } catch (error) {
        console.error('Phone validation error:', error);
        return res.status(400).json({ error: 'Invalid phone number' });
      }

      let userHash: string;
      try {
        userHash = hashPhone(normalizedPhone);
      } catch (error) {
        console.error('Hashing error:', error);
        return res.status(400).json({ error: 'Invalid phone number' });
      }

      try {
        // Process Stripe Customer and Payment Method
        const customerId = await processStripeCustomer(
          stripe,
          normalizedPhone,
          paymentMethodId,
          idempotencyKey
        );

        // Log signup details (no DB storage yet)
        console.log('User onboarded:', {
          userHash,
          phone: normalizedPhone,
          paymentMethodId,
          customerId,
          timestamp: new Date().toISOString(),
        });

        // Send welcome SMS
        await client.messages.create({
          body: `${WELCOME_MSG}\nSet your pin, and link bank at www.olsms.xyz`,
          from: tellaNumber,
          to: normalizedPhone,
        });

        return res.status(200).json({
          success: true,
          message: 'User onboarded successfully',
          customerId: customerId,
        });
      } catch (error) {
        console.error('Signup error:', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        });
        const errorMessages: { [key: string]: string } = {
          invalid_request_error: 'Invalid payment method. Please try again.',
          authentication_error: 'Stripe authentication failed.',
          rate_limit_error: 'Too many requests. Please try again later.',
        };
        const statusCode = isStripeError(error) ? error.statusCode : 400;
        const errorCode = isStripeError(error) ? error.code : undefined;
        return res.status(statusCode).json({
          error:
            (errorCode && errorMessages[errorCode]) ||
            (error instanceof Error ? error.message : String(error)) ||
            'Failed to process signup',
        });
      }
    });

    // Existing Twilio webhook endpoint (uses sendSmsRes for TwiML)
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

        if (parsed.trigger === 'direct') {
          await handleDirectIntent(res, fromHash, from, parsed);
        } else if (parsed.trigger === 'confirmation') {
          await handleConfirmationIntent(res, fromHash, client, tellaNumber);
        } else if (parsed.trigger === 'cancel') {
          await handleCancelIntent(res, fromHash);
        } else if (parsed.trigger === 'onboard') {
          await handleOnboardIntent(res, fromHash, from, client, tellaNumber);
        } else {
          return sendSmsRes(res, 'Invalid intent ⚠️');
        }
      } catch (err) {
        console.error('SMS error:', err);
        return sendSmsRes(res, 'Error parsing intent ⚠️');
      }
    });

    // Start server
    const port = 3000;
    app.listen(port, '0.0.0.0', () => {
      console.log(`Tella server running on http://0.0.0.0:${port}`);
    });
  } catch (err) {
    console.error('Failed to initialize DB schema:', err);
    process.exit(1); // Exit app on startup failure
  }
}

// =======================
// Only run if executed directly
// =======================
if (
  process.argv[1]?.endsWith('index.ts') ||
  process.argv[1]?.endsWith('index.js')
) {
  startServer().catch((err) => {
    console.error('Failed to start Tella server:', err);
    process.exit(1);
  });
}

// Handle 'onboard' intent
async function handleOnboardIntent(
  res: Response,
  fromHash: string,
  from: string,
  client: twilio.Twilio,
  tellaNumber: string
) {
  try {
    let user = await getUser(fromHash);
    if (!user) {
      await insertUser(fromHash, false, '', false);
      user = await getUser(fromHash);
    }

    if (user!.is_bank_linked) {
      return res.status(200).json({ message: 'Already onboarded ✅' });
    }

    // Send SMS with link
    await client.messages.create({
      body: `${WELCOME_MSG}\n Set your pin, and link bank at www.olsms.xyz`,
      from: tellaNumber,
      to: from,
    });

    return res.status(200).json({ message: 'Sms sent to link your bank ✅' });
  } catch (err) {
    console.error('Onboard error:', err);
    return res.status(500).json({ message: 'Onboarding failed ⚠️' });
  }
}

// Handle 'direct' send intent
async function handleDirectIntent(
  res: Response,
  fromHash: string,
  from: string,
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
      senderPhone: from,
      recipientPhone: parsed.recipient,
    }),
    sender?.is_bank_linked ? true : false
  );

  // Insert recipient if new
  if (!(await getUser(recipientHash))) {
    await insertUser(recipientHash, false, '', false);
  }

  // Check if user needs bank linking
  const needsBankLink = !sender?.is_bank_linked;

  // Welcome if new
  const welcome = !needsBankLink ? '' : `${WELCOME_MSG}\n\n`;

  // Send confirm with appropriate message
  const memoTxt = parsed.memo ? `\n 📝 Memo: ${parsed.memo}` : '';
  const message = `${welcome}💸Amount: $${parsed.amount}\n📞 To: ${parsed.recipient}${memoTxt}\nConfirm: yes or no❓`;

  sendSmsRes(res, message);

  // Background init sender
  if (!senderInit) {
    retry(() =>
      initUserIfNeeded(fromHash, fromHashBytes, fromPda, fromAta)
    ).catch((err) => console.error(`Init retry failed ${fromHash}:`, err));
  }
}

// Handle 'confirmation' intent
async function handleConfirmationIntent(
  res: Response,
  fromHash: string,
  client: twilio.Twilio,
  tellaNumber: string
) {
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
    senderPhone: string;
    recipientPhone: string;
  };
  try {
    pending = JSON.parse(user.pending_actions);
  } catch {
    await updateUser(fromHash, { pending_actions: null });
    return sendSmsRes(res, 'Invalid pending transfer ⚠️');
  }

  const {
    actionID,
    amount,
    recipientHash,
    memo,
    expires,
    senderPhone,
    recipientPhone,
  } = pending;

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
  sendSmsRes(res, 'Sent ✅💸🔒');

  // Recipient flow after transfer completion
  const memoTxt = pending.memo ? ` for ${pending.memo}` : '';
  await client.messages.create({
    body: `${senderPhone} sent you $${pending.amount}${memoTxt} ✅🔒`,
    from: tellaNumber,
    to: recipientPhone,
  });

  // Clear pending
  await updateUser(fromHash, { pending_actions: null });
}

async function handleCancelIntent(res: Response, fromHash: string) {
  const user = await getUser(fromHash);
  if (user?.pending_actions) {
    await updateUser(fromHash, { pending_actions: null });
    sendSmsRes(res, 'Transaction cancelled ❌');
  } else {
    sendSmsRes(res, 'No pending transfer to cancel ⚠️');
  }
}

// Helper: Send XML SMS response
function sendSmsRes(res: Response, msg: string) {
  res.status(200).send(`<Response><Message>${msg}</Message></Response>`);
}

async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 1) throw new Error(`Retry failed: ${err}`);
    await new Promise<void>((resolve) =>
      globalThis.setTimeout(resolve, delayMs)
    );
    return retry(fn, retries - 1, delayMs * 2);
  }
}
