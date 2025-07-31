// src/intent_gateway.ts
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
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
import { getUser, updateUser } from './db.ts';

// Load env vars.
dotenv.config();

const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
const secretKey = JSON.parse(readFileSync(keypairPath, 'utf-8')); // Array of 64 bytes
const tellaKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

console.log('Loaded local wallet:', tellaKeypair.publicKey.toBase58());

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

// Create Anchor provider
const provider = new AnchorProvider(connection, mockWallet, {
  commitment: 'confirmed',
});

// Program instance
const program = new Program(idl as unknown as Idl, provider);

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

export async function initUserIfNeeded(
  userHash: string,
  userHashBytes: Uint8Array,
  userPda: PublicKey,
  ata: PublicKey
) {
  // Get user info from db
  const user = await getUser(userHash);
  if (!user || user.wallet_init !== 1) {
    const ix = await program.methods
      .initializeUser(userHashBytes)
      .accounts({
        tellaSigner: tellaKeypair.publicKey,
        userAccount: userPda,
        userTokenAccount: ata,
        tokenMint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = tellaKeypair.publicKey;

    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [tellaKeypair],
      { commitment: 'processed' }
    );
    console.log(`Initialized user ${userHash}: ${signature}`);

    // Update DB post-success
    await updateUser(userHash, { wallet_init: true });
  }
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
