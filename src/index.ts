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
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Program, Idl, AnchorProvider } from '@project-serum/anchor';
import dotenv from 'dotenv';
import idl from '../../intent_gateway/target/idl/intent_gateway.json' with { type: 'json' };
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Buffer } from 'buffer';

// Load env vars.
dotenv.config();

// Load and validate Tella keypair from env
let tellaKeypair: Keypair;
try {
  const secretKey = JSON.parse(process.env.TELLA_SECRET_KEY || '[]');
  if (!Array.isArray(secretKey) || secretKey.length !== 64) {
    throw new Error(
      `Invalid TELLA_SECRET_KEY: expected 64-byte array, got ${secretKey.length}`
    );
  }
  tellaKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
} catch (error) {
  console.error('Keypair init error:', error);
  process.exit(1); // Critical failure
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

// Program ID from the actual IDL
const programId = new PublicKey('6mRsosPgBPjRgAxpvX4qZnJjchWSJmbqJYYJLM4sKRXz');

// Helper to derive user PDA + ATA based on hash and mint
function deriveUserPdaAndAta(
  userIdHash: Uint8Array,
  programId: PublicKey,
  mint: PublicKey
) {
  const [userPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user'), userIdHash],
    programId
  );
  const ata = getAssociatedTokenAddressSync(
    mint,
    userPda,
    true, // Allows PDA as owner
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return { userPda, ata };
}

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

    if (parsed.trigger === 'direct') {
      // Store pending action
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
      // Execute transaction
      const user = await getUser(fromHash);
      if (user?.pending_actions) {
        // Build Solana TX for p2p_transfer.
        const provider = new AnchorProvider(connection, mockWallet, {
          commitment: 'confirmed',
        }); // Create Anchor provider
        const program = new Program(idl as unknown as Idl, programId, provider); // Program instance
        // Convert hash strings to bytes (Uint8Array)
        const fromHashBytes = Uint8Array.from(Buffer.from(fromHash, 'hex'));
        const toHashBytes = Uint8Array.from(Buffer.from(recipientHash, 'hex'));

        const usdcMint = new PublicKey(
          'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'
        );
        // Derive PDA + ATA for both sender and recipient
        const { userPda: fromUserPda, ata: fromAta } = deriveUserPdaAndAta(
          fromHashBytes,
          programId,
          usdcMint
        );
        const { userPda: toUserPda, ata: toAta } = deriveUserPdaAndAta(
          toHashBytes,
          programId,
          usdcMint
        );

        // Build tx
        const instruction = await program.methods
          .p2p_transfer(
            fromHash, // from_user_id_hash
            recipientHash, // to_user_id_hash
            parsed.amount * 1_000_000 // amount in lamports
          )
          .accounts({
            tella_signer: tellaKeypair.publicKey,
            from_user_account: fromUserPda, // PDA
            from_token_account: fromAta, // Token account
            to_user_account: toUserPda, // PDA
            to_token_account: toAta, // Token account
            token_mint: usdcMint,
            token_program: TOKEN_PROGRAM_ID,
          })
          .instruction();
        const tx = new Transaction().add(instruction);
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

// Test DB and parser.
(async () => {
  const parsed = await parseIntent('Send $10 to +1 (669) 262-8341 for lunch');
  console.log('Parsed intent:', parsed);
})();
