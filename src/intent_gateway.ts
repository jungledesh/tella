// src/intent_gateway.ts
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
const { Program, AnchorProvider, BN } = anchor;
import type { Idl } from '@coral-xyz/anchor';
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
  signTransaction: async <T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> => {
    if ('partialSign' in tx) {
      tx.partialSign(tellaKeypair);
    }
    return tx;
  },
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> => {
    txs.forEach((tx) => {
      if ('partialSign' in tx) {
        tx.partialSign(tellaKeypair);
      }
    });
    return txs;
  },
};

// Solana connection (devnet for MVP).
export const connection = new Connection(
  'https://api.devnet.solana.com',
  'confirmed'
);

// Program ID from the actual IDL
export const programId = new PublicKey(
  '6mRsosPgBPjRgAxpvX4qZnJjchWSJmbqJYYJLM4sKRXz'
);

// USDC mint
export const usdcMint = new PublicKey(
  'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'
);

// Helper to derive user PDA + ATA based on hash and mint
export function deriveUserPdaAndAta(
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

// Function to execute P2P transfer
export async function executeP2pTransfer(
  fromHashBytes: Uint8Array,
  toHashBytes: Uint8Array,
  amount: number,
  fromUserPda: PublicKey,
  fromAta: PublicKey,
  toUserPda: PublicKey,
  toAta: PublicKey
): Promise<string> {
  // Create Anchor provider
  const provider = new AnchorProvider(connection, mockWallet, {
    commitment: 'confirmed',
  });

  // Program instance
  const program = new Program(idl as unknown as Idl, provider);

  // Build tx
  const instruction = await program.methods
    .p2PTransfer(
      fromHashBytes, // from_user_id_hash
      toHashBytes, // to_user_id_hash
      new BN(amount * 1_000_000) // amount in lamports
    )
    .accounts({
      tellaSigner: tellaKeypair.publicKey,
      fromUserAccount: fromUserPda, // PDA
      fromTokenAccount: fromAta, // Token account
      toUserAccount: toUserPda, // PDA
      toTokenAccount: toAta, // Token account
      tokenMint: usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
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
  return signature;
}
