// Import Express, types, DB, parser, and Solana.
import express from 'express';
import { Request, Response } from 'express';
import { insertUser, getUser } from './db.ts';
import { parseIntent } from './parser.ts';
import { hashPhone } from './utils.ts';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Program, Idl, AnchorProvider } from '@project-serum/anchor';
import dotenv from 'dotenv';

// Load env vars.
dotenv.config();

// Mock Tella keypair (full 64 bytes, prod uses TEE).
let tellaKeypair: Keypair;
try {
  const secretKey = JSON.parse(process.env.TELLA_SECRET_KEY || '[]');
  if (!Array.isArray(secretKey) || secretKey.length !== 64) {
    throw new Error('Invalid TELLA_SECRET_KEY: must be 64-byte array');
  }
  tellaKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
} catch (error) {
  console.error('Keypair init error:', error);
  process.exit(1); // Exit if keypair fails (critical for TX).
}

const mockWallet = {
  publicKey: tellaKeypair.publicKey,
  signTransaction: async (tx: Transaction) => {
    tx.partialSign(tellaKeypair);
    return tx;
  },
  signAllTransactions: async (txs: Transaction[]) => {
    txs.forEach((tx) => tx.partialSign(tellaKeypair));
    return txs;
  },
};

// Solana connection (devnet for MVP).
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Mock program ID (replace with your intent_gateway program)
const programId = new PublicKey('6mRsosPgBPjRgAxpvX4qZnJjchWSJmbqJYYJLM4sKRXz');

// Mock IDL for intent_gateway (replace with real IDL).
const idl: Idl = {
  version: '0.1.0',
  name: 'intent_gateway',
  instructions: [
    {
      name: 'p2p_transfer',
      accounts: [
        { name: 'sender', isMut: true, isSigner: true },
        { name: 'recipient', isMut: true, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'amount', type: 'u64' },
        { name: 'memo', type: 'string' },
      ],
    },
  ],
  accounts: [],
};

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
        const pending = JSON.parse(user.pending_actions);
        // Build Solana TX for p2p_transfer.
        const provider = new AnchorProvider(connection, mockWallet, {
          commitment: 'confirmed',
        }); // Create Anchor provider
        const program = new Program(idl, programId, provider); // Program instance
        // Build tx
        const tx = new Transaction().add(
          program.methods.p2p_transfer(
            {
              amount: parsed.amount * 1_000_000, // USDC lamports (mock).
              memo: pending.memo || '',
            },
            {
              accounts: {
                sender: tellaKeypair.publicKey,
                recipient: new PublicKey(recipientHash), // Mock recipient PDA.
                systemProgram: SystemProgram.programId,
              },
            }
          )
        );
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash; // Set recent blockhash for TX validity.
        tx.feePayer = tellaKeypair.publicKey; // Set fee payer to Tella's keypair.
        // Sign and send TX with modern API.
        const signature = await sendAndConfirmTransaction(
          connection,
          tx,
          [tellaKeypair],
          { commitment: 'confirmed' }
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
