import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";
import { SOLANA_CONFIG } from "../lib/solanaConfig";

export type BatchPhase = "Lobby" | "Locked" | "Active" | "Ended";

export interface BatchState {
  batchId: number;
  phase: BatchPhase;
  totalDeposited: number;
  weeklyYieldPool: number;
  acceptedPredictions: number;
  maxPredictions: number;
  operatorAddress: string;
  userDeposited: number;
  batchStartTime: number;
  participantCount: number;
  minimumDeposit: number;
  userWithdrawn?: boolean;
}

export interface VoteResult {
  fixtureId: number;
  winningOptionId: string | null;
  isSkip: boolean;
  accepted: boolean;
  won: boolean;
}

// Internal mock state tracker (so deposits/withdrawals persist in mock session)
const withdrawnBatches = new Set<number>();

/**
 * ============================================================================
 * SOLANA SMART CONTRACT DEVELOPER PLAYBOOK & REFERENCE GUIDE
 * ============================================================================
 * 
 * 1. PDA (Program Derived Address) Derivations:
 *    - Batch State Account:
 *      const [batchPda] = await PublicKey.findProgramAddress(
 *        [Buffer.from("batch"), new anchor.BN(batchId).toArrayLike(Buffer, "le", 8)],
 *        programId
 *      );
 * 
 *    - User Position / Deposit Account:
 *      const [positionPda] = await PublicKey.findProgramAddress(
 *        [
 *          Buffer.from("user_position"),
 *          new anchor.BN(batchId).toArrayLike(Buffer, "le", 8),
 *          userPublicKey.toBuffer()
 *        ],
 *        programId
 *      );
 * 
 *    - Syndicate Vault PDA (holds deposited USDC for yield generation):
 *      const [vaultPda] = await PublicKey.findProgramAddress(
 *        [Buffer.from("vault"), new anchor.BN(batchId).toArrayLike(Buffer, "le", 8)],
 *        programId
 *      );
 * 
 * 2. On-Chain Data Models (Anchor / Rust equivalents):
 *    
 *    #[account]
 *    pub struct BatchAccount {
 *        pub batch_id: u64,
 *        pub phase: u8,               // 0: Lobby, 1: Locked, 2: Active, 3: Ended
 *        pub total_deposited: u64,    // total USDC staked
 *        pub weekly_yield_pool: u64,  // total yield projected
 *        pub accepted_predictions: u8,
 *        pub max_predictions: u8,
 *        pub operator: Pubkey,
 *        pub start_time: i64,
 *        pub participant_count: u32,
 *        pub minimum_deposit: u64,
 *    }
 * 
 *    #[account]
 *    pub struct UserPositionAccount {
 *        pub amount: u64,
 *        pub withdrawn: bool,
 *    }
 * 
 * ============================================================================
 */

/**
 * Fetch the current state of a batch.
 * 
 * [TODO: Smart Contract Dev]
 * If SOLANA_CONFIG.MOCK_MODE is false, replace this with an RPC call to fetch
 * the on-chain BatchAccount account and deserialize its data.
 */
export async function fetchBatchState(
  batchId: number,
  userAddress: string | null
): Promise<BatchState> {
  if (!SOLANA_CONFIG.MOCK_MODE) {
    /**
     * Boilerplate: Fetching from Solana program via @solana/client or Anchor:
     * 
     * const connection = new Connection(SOLANA_CONFIG.RPC_URL);
     * const batchPda = deriveBatchPda(batchId);
     * const accountInfo = await connection.getAccountInfo(batchPda);
     * if (!accountInfo) throw new Error("Batch not initialized");
     * const batchData = ProgramLayouts.BatchAccount.decode(accountInfo.data);
     * 
     * // Fetch user position if connected:
     * let userDeposited = 0;
     * let userWithdrawn = false;
     * if (userAddress) {
     *   const positionPda = derivePositionPda(batchId, new PublicKey(userAddress));
     *   const posInfo = await connection.getAccountInfo(positionPda);
     *   if (posInfo) {
     *     const posData = ProgramLayouts.UserPosition.decode(posInfo.data);
     *     userDeposited = posData.amount.toNumber();
     *     userWithdrawn = posData.withdrawn;
     *   }
     * }
     */
    console.log(`[SOLANA RPC] Fetching real account state for batch ${batchId}`);
  }

  // --- Mock Implementation ---
  const now = Date.now();
  const isConnected = !!userAddress;

  if (batchId === 5) {
    const participants = isConnected ? 1287 : 1286;
    const tvl = 1_250_000;
    return {
      batchId: 5,
      phase: "Active",
      totalDeposited: tvl,
      weeklyYieldPool: (tvl * 0.05) / 52,
      acceptedPredictions: 4,
      maxPredictions: 5,
      operatorAddress: "OP...",
      userDeposited: isConnected ? 1000 : 0,
      batchStartTime: now - 3600000 * 24,
      participantCount: participants,
      minimumDeposit: 100,
    };
  } else if (batchId < 5) {
    let totalDeposited = 1_000_000;
    let userDeposited = 0;
    let participants = 900;
    let userWithdrawn = false;

    switch (batchId) {
      case -1:
        totalDeposited = 850_000;
        userDeposited = isConnected ? 500 : 0;
        participants = isConnected ? 816 : 815;
        userWithdrawn = true;
        break;
      case 0:
        totalDeposited = 1_000_000;
        userDeposited = isConnected ? 300 : 0;
        participants = isConnected ? 943 : 942;
        userWithdrawn = false;
        break;
      case 1:
        totalDeposited = 1_100_000;
        userDeposited = isConnected ? 1000 : 0;
        participants = isConnected ? 1021 : 1020;
        userWithdrawn = false;
        break;
      case 2:
        totalDeposited = 1_150_000;
        userDeposited = isConnected ? 500 : 0;
        participants = isConnected ? 1106 : 1105;
        userWithdrawn = false;
        break;
      case 3:
        totalDeposited = 1_200_000;
        userDeposited = isConnected ? 200 : 0;
        participants = isConnected ? 1191 : 1190;
        userWithdrawn = false;
        break;
      case 4:
        totalDeposited = 1_220_000;
        userDeposited = 0;
        participants = isConnected ? 1221 : 1220;
        userWithdrawn = false;
        break;
      default:
        totalDeposited = 500_000;
        participants = 500;
    }

    const isWithdrawn = withdrawnBatches.has(batchId) ? true : userWithdrawn;
    const finalUserDeposited = isWithdrawn ? 0 : userDeposited;

    return {
      batchId,
      phase: "Ended",
      totalDeposited,
      weeklyYieldPool: (totalDeposited * 0.05) / 52,
      acceptedPredictions: 4,
      maxPredictions: 5,
      operatorAddress: "OP...",
      userDeposited: finalUserDeposited,
      batchStartTime: now - 3600000 * 24 * (7 * (5 - batchId)),
      participantCount: participants,
      minimumDeposit: 100,
      userWithdrawn: isWithdrawn,
    };
  } else {
    let totalDeposited = 100_000;
    let userDeposited = 0;
    let participants = 10;
    let startTimeOffset = 3600000 * 24 * (batchId - 5);

    switch (batchId) {
      case 6:
        totalDeposited = 420_000;
        userDeposited = isConnected ? 500 : 0;
        participants = isConnected ? 87 : 86;
        startTimeOffset = 3600000 * 6;
        break;
      case 7:
        totalDeposited = 150_000;
        userDeposited = isConnected ? 200 : 0;
        participants = isConnected ? 35 : 34;
        startTimeOffset = 3600000 * 24 * 3;
        break;
      case 8:
        totalDeposited = 75_000;
        userDeposited = 0;
        participants = isConnected ? 13 : 12;
        startTimeOffset = 3600000 * 24 * 7;
        break;
      case 9:
        totalDeposited = 50_000;
        userDeposited = 0;
        participants = isConnected ? 9 : 8;
        startTimeOffset = 3600000 * 24 * 10;
        break;
      case 10:
        totalDeposited = 30_000;
        userDeposited = 0;
        participants = isConnected ? 6 : 5;
        startTimeOffset = 3600000 * 24 * 14;
        break;
    }

    return {
      batchId,
      phase: "Lobby",
      totalDeposited,
      weeklyYieldPool: (totalDeposited * 0.05) / 52,
      acceptedPredictions: 0,
      maxPredictions: 5,
      operatorAddress: "OP...",
      userDeposited,
      batchStartTime: now + startTimeOffset,
      participantCount: participants,
      minimumDeposit: 100,
    };
  }
}

/**
 * Deposit USDC into a lobby batch.
 * 
 * [TODO: Smart Contract Dev]
 * Create and sign a Solana transaction containing the program instruction:
 * `deposit(amount)` passing the required accounts (user token account, syndicate vault).
 */
export async function depositToLobby(
  batchId: number,
  amount: number
): Promise<string> {
  if (!SOLANA_CONFIG.MOCK_MODE) {
    /**
     * Boilerplate: Building and sending deposit instruction using Anchor/Solana client:
     * 
     * const userUSDCAccount = getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
     * const vaultUSDCAccount = getAssociatedTokenAddress(USDC_MINT, vaultPda, true);
     * 
     * const tx = await program.methods
     *   .deposit(new anchor.BN(amount * (10 ** SOLANA_CONFIG.TOKEN_DECIMALS)))
     *   .accounts({
     *     batch: batchPda,
     *     userPosition: positionPda,
     *     userTokenAccount: userUSDCAccount,
     *     vaultTokenAccount: vaultUSDCAccount,
     *     signer: wallet.publicKey,
     *     tokenProgram: TOKEN_PROGRAM_ID,
     *     systemProgram: SystemProgram.programId,
     *   })
     *   .transaction();
     * 
     * const txSignature = await sendTransaction(tx, connection);
     * return txSignature;
     */
    console.log(`[SOLANA TX] Initiating deposit for ${amount} USDC on batch ${batchId}`);
  }

  console.log(`Mock deposit to batch ${batchId}: ${amount} USDC`);
  return "mock-tx-signature";
}

/**
 * Withdraw all deposits from a lobby or ended batch.
 * 
 * [TODO: Smart Contract Dev]
 * Create and sign a Solana transaction containing the program instruction:
 * `withdraw()` to redeem staked USDC back to user's wallet.
 */
export async function withdrawFromLobby(batchId: number): Promise<string> {
  if (!SOLANA_CONFIG.MOCK_MODE) {
    /**
     * Boilerplate: Building and sending withdraw instruction:
     * 
     * const tx = await program.methods
     *   .withdraw()
     *   .accounts({
     *     batch: batchPda,
     *     userPosition: positionPda,
     *     userTokenAccount: userUSDCAccount,
     *     vaultTokenAccount: vaultUSDCAccount,
     *     signer: wallet.publicKey,
     *     tokenProgram: TOKEN_PROGRAM_ID,
     *   })
     *   .transaction();
     * 
     * const txSignature = await sendTransaction(tx, connection);
     * return txSignature;
     */
    console.log(`[SOLANA TX] Initiating withdrawal from batch ${batchId}`);
  }

  console.log(`Mock withdraw from batch ${batchId}`);
  withdrawnBatches.add(batchId);
  return "mock-tx-signature";
}

/**
 * Submit consensus vote for a fixture option.
 * 
 * [TODO: Smart Contract Dev]
 * Create and sign a transaction containing the program instruction:
 * `submitVote(fixtureId, optionId)`.
 */
export async function submitVote(
  fixtureId: number,
  optionId: string
): Promise<string> {
  if (!SOLANA_CONFIG.MOCK_MODE) {
    /**
     * Boilerplate:
     * 
     * const tx = await program.methods
     *   .submitVote(new anchor.BN(fixtureId), optionId)
     *   .accounts({
     *     batch: batchPda,
     *     voteRecord: voteRecordPda,
     *     signer: wallet.publicKey,
     *     systemProgram: SystemProgram.programId,
     *   })
     *   .transaction();
     * 
     * const txSignature = await sendTransaction(tx, connection);
     * return txSignature;
     */
    console.log(`[SOLANA TX] Casting vote for option ${optionId} on fixture ${fixtureId}`);
  }

  console.log(`Mock vote: fixture ${fixtureId}, option ${optionId}`);
  return "mock-tx-signature";
}

/**
 * Fetch simulated votes for active fixtures (Consensus Voting Dashboard)
 */
export async function fetchVotes(
  fixtures: any[]
): Promise<Record<string, number>> {
  if (!SOLANA_CONFIG.MOCK_MODE) {
    // In production, this can call your indexer, backend API or direct program accounts
    console.log("[SOLANA RPC] Fetching consensus voting records");
  }

  const votes: Record<string, number> = {};
  fixtures.forEach((f: any) => {
    f.options.forEach((o: any) => {
      votes[o.id] = Math.floor(Math.random() * 500) + 50;
    });
    votes[`${f.fixtureId}-skip`] = Math.floor(Math.random() * 200) + 20;
  });
  return votes;
}

/**
 * Fetch decisions / results for the matches.
 */
export async function fetchMatchDecisions(
  fixtures: any[]
): Promise<Record<number, VoteResult>> {
  if (!SOLANA_CONFIG.MOCK_MODE) {
    // Fetch settlement status from the blockchain / Oracle state
    console.log("[SOLANA RPC] Fetching oracle match decisions");
  }

  const decisions: Record<number, VoteResult> = {};
  const now = Date.now();
  fixtures.forEach((f: any) => {
    if (f.startTime > now) return;
    const skipId = `${f.fixtureId}-skip`;
    decisions[f.fixtureId] = {
      fixtureId: f.fixtureId,
      winningOptionId:
        Math.random() > 0.4 ? (f.options[0]?.id ?? null) : skipId,
      isSkip: Math.random() < 0.3,
      accepted: Math.random() > 0.2,
      won: Math.random() > 0.5,
    };
  });
  return decisions;
}

/**
 * Submit transaction odds proof to the chain (for settlement / oracle)
 */
export async function submitTxOddsProof(
  fixtureId: number,
  proofData: any
): Promise<string> {
  if (!SOLANA_CONFIG.MOCK_MODE) {
    console.log(`[SOLANA TX] Submitting odds proof for fixture ${fixtureId}`);
  }
  console.log("Mock proof submission");
  return "mock-tx-signature";
}

/**
 * Claim winnings / reward yields.
 */
export async function claimWinnings(): Promise<string> {
  if (!SOLANA_CONFIG.MOCK_MODE) {
    console.log("[SOLANA TX] Claiming batch winnings");
  }
  console.log("Mock claim");
  return "mock-tx-signature";
}

/**
 * Buy a lottery ticket.
 */
export async function buyLotteryTicket(): Promise<string> {
  if (!SOLANA_CONFIG.MOCK_MODE) {
    console.log("[SOLANA TX] Buying lottery ticket");
  }
  console.log("Mock lottery ticket");
  return "mock-tx-signature";
}

/**
 * ============================================================================
 * REAL ON-CHAIN WIRING (undegen_core / yield_vault, devnet)
 * Ported from app/test/join-batch and app/test/cast-vote, the two
 * user-signed instructions verified against the deployed program.
 * ============================================================================
 */

const UNDEGEN_PROGRAM_ID = new PublicKey(SOLANA_CONFIG.PROGRAM_ID);
const YIELD_VAULT_PROGRAM_ID = new PublicKey(SOLANA_CONFIG.YIELD_VAULT_PROGRAM_ID);
const USDC_MINT = new PublicKey(SOLANA_CONFIG.USDC_MINT);
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const JOIN_BATCH_DISCRIMINATOR = Buffer.from([81, 186, 86, 76, 184, 199, 194, 96]);
const CAST_VOTE_DISCRIMINATOR = Buffer.from([20, 212, 15, 189, 69, 180, 69, 151]);
const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);
const VAULT_CONFIG_DISCRIMINATOR = Buffer.from([99, 86, 43, 216, 184, 102, 119, 77]);
const INIT_VAULT_DISCRIMINATOR = Buffer.from([48, 191, 163, 44, 71, 129, 63, 164]);

// Anchor's fixed `associated_token_account` seed constant, reused verbatim from the test pages.
const ATA_SEED = Buffer.from([
  6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172,
  28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);

// Loosely typed on purpose: @solana/react-hooks' wallet.signTransaction takes a
// @solana/kit transaction, not the @solana/web3.js Transaction built here. The
// proven test pages paper over this same mismatch with an `as any` cast; we do
// the same rather than rearchitect signing around @solana/kit.
export interface WalletLike {
  account?: { address?: string | null } | null;
  signTransaction?: (tx: any) => Promise<any>;
}

function writeUInt64LE(value: bigint | number): Buffer {
  const buffer = Buffer.alloc(8);
  new DataView(buffer.buffer).setBigUint64(0, BigInt(value), true);
  return buffer;
}

function deriveAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

// The vault-init/collateral flows are operator-signed; this key is only ever
// needed as a one-time prerequisite (auto-init the shared yield vault) before
// the user's own join_batch instruction runs, mirroring app/test/join-batch.
function getOperatorKeypair(): Keypair {
  const secretKeyEnv = process.env.NEXT_PUBLIC_OPERATOR_SECRET_KEY;
  if (!secretKeyEnv) throw new Error("NEXT_PUBLIC_OPERATOR_SECRET_KEY not set.");
  if (secretKeyEnv.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyEnv)));
  }
  return Keypair.fromSecretKey(bs58.decode(secretKeyEnv));
}

async function sendTxAsOperator(connection: Connection, ix: TransactionInstruction): Promise<string> {
  const signer = getOperatorKeypair();
  const tx = new Transaction().add(ix);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = signer.publicKey;
  tx.sign(signer);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(sig);
  return sig;
}

async function ensureYieldVaultInitialized(connection: Connection): Promise<void> {
  const [vaultConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config"), USDC_MINT.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );

  const info = await connection.getAccountInfo(vaultConfigPda);
  if (info && info.data.slice(0, 8).equals(VAULT_CONFIG_DISCRIMINATOR)) return;

  const [vaultTokenAccountPda] = PublicKey.findProgramAddressSync(
    [vaultConfigPda.toBuffer(), ATA_SEED, USDC_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [reserveTokenAccountPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), USDC_MINT.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );

  const operator = getOperatorKeypair();
  const keys = [
    { pubkey: operator.publicKey, isSigner: true, isWritable: true },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: vaultConfigPda, isSigner: false, isWritable: true },
    { pubkey: vaultTokenAccountPda, isSigner: false, isWritable: true },
    { pubkey: reserveTokenAccountPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: YIELD_VAULT_PROGRAM_ID,
    keys,
    data: INIT_VAULT_DISCRIMINATOR,
  });

  await sendTxAsOperator(connection, ix);
}

async function signAndSend(connection: Connection, tx: Transaction, userPubkey: PublicKey, wallet: WalletLike): Promise<string> {
  tx.feePayer = userPubkey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  const provider = typeof window !== "undefined" ? (window as any).solana : undefined;
  let rawTx: any;
  if (provider) {
    const signedTx = await provider.signTransaction(tx);
    rawTx = signedTx.serialize();
  } else if (wallet.signTransaction) {
    const signed = await wallet.signTransaction(tx as any);
    rawTx = signed instanceof Uint8Array ? signed : signed?.serialize?.() ?? signed;
  } else {
    throw new Error("Wallet does not support signTransaction.");
  }

  const sig = await connection.sendRawTransaction(rawTx, { skipPreflight: false });
  await connection.confirmTransaction(sig);
  return sig;
}

/**
 * Deposit USDC into a batch (real `join_batch` instruction, user-signed).
 * Auto-initializes the shared yield vault if it doesn't exist yet.
 */
export async function joinBatchOnChain(batchId: number, amount: number, wallet: WalletLike): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);

  await ensureYieldVaultInitialized(connection);

  const [vaultConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config"), USDC_MINT.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );

  const batchIdBuffer = writeUInt64LE(BigInt(batchId));
  const [batchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("batch"), batchIdBuffer],
    UNDEGEN_PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(batchPda);
  if (!accountInfo) throw new Error("Batch account not found on-chain.");
  if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) throw new Error("Batch not initialized.");

  const rawAmount = BigInt(Math.floor(amount * 10 ** SOLANA_CONFIG.TOKEN_DECIMALS));
  const data = Buffer.concat([JOIN_BATCH_DISCRIMINATOR, writeUInt64LE(rawAmount)]);

  const userTokenAccount = deriveAssociatedTokenAddress(user, USDC_MINT);
  const batchTokenAccount = deriveAssociatedTokenAddress(batchPda, USDC_MINT);
  const vaultTokenAccount = deriveAssociatedTokenAddress(vaultConfigPda, USDC_MINT);

  const [vaultPositionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), vaultConfigPda.toBuffer(), batchPda.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );
  const [userPositionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_position"), batchPda.toBuffer(), user.toBuffer()],
    UNDEGEN_PROGRAM_ID
  );

  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: batchPda, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: batchTokenAccount, isSigner: false, isWritable: true },
    { pubkey: vaultConfigPda, isSigner: false, isWritable: true },
    { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: vaultPositionPda, isSigner: false, isWritable: true },
    { pubkey: userPositionPda, isSigner: false, isWritable: true },
    { pubkey: YIELD_VAULT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({ programId: UNDEGEN_PROGRAM_ID, keys, data });
  const tx = new Transaction().add(ix);

  return signAndSend(connection, tx, user, wallet);
}

/**
 * Resolve a UI (fixtureId, optionId) pair to the batch's on-chain vote index
 * (0-3 = a bet_terms slot, 4 = skip), using the Redis mapping that propose-match
 * saved when the operator proposed this batch's outcomes.
 */
export async function resolveVoteIndex(batchId: number, fixtureId: number, optionId: string): Promise<number> {
  if (optionId === `${fixtureId}-skip`) return 4;

  const res = await fetch(`/api/batch-mapping?batchId=${batchId}`);
  if (!res.ok) throw new Error("No on-chain proposal mapping found for this batch.");
  const mapping = await res.json();
  const slotsMapping: Record<string, { messageId: string; outcomeIndex: number }> = mapping.slotsMapping || {};

  for (const [indexStr, slot] of Object.entries(slotsMapping)) {
    if (`${slot.messageId}-${slot.outcomeIndex}` === optionId) return Number(indexStr);
  }
  throw new Error("Could not resolve this option to an on-chain vote slot.");
}

/**
 * Cast a consensus vote (real `cast_vote` instruction, user-signed).
 * `index` is 0-3 for a proposed bet_terms slot, or 4 to skip.
 */
export async function castVoteOnChain(batchId: number, index: number, wallet: WalletLike): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);

  const batchIdBuffer = writeUInt64LE(BigInt(batchId));
  const [batchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("batch"), batchIdBuffer],
    UNDEGEN_PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(batchPda);
  if (!accountInfo || !accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) {
    throw new Error("Batch not found or not initialized.");
  }

  const [userPositionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_position"), batchPda.toBuffer(), user.toBuffer()],
    UNDEGEN_PROGRAM_ID
  );

  const data = Buffer.concat([CAST_VOTE_DISCRIMINATOR, Buffer.from([index])]);
  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: batchPda, isSigner: false, isWritable: true },
    { pubkey: userPositionPda, isSigner: false, isWritable: true },
  ];

  const ix = new TransactionInstruction({ programId: UNDEGEN_PROGRAM_ID, keys, data });
  const tx = new Transaction().add(ix);

  return signAndSend(connection, tx, user, wallet);
}
