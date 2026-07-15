import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";
import * as borsh from "@coral-xyz/borsh";
import { SOLANA_CONFIG } from "../lib/solanaConfig";
import { Option, Fixture } from "../lib/dummyData";

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
  // Raw consensus state, needed to resolve this batch's proposed match for display.
  voteWeights: number[]; // [bet0, bet1, bet2, bet3, skip]
  winningVoteIndex: number | null;
  outcome: boolean | null;
  // Null for batches created before `created_at` existed on-chain (no migration).
  createdAt: number | null; // ms
  lobbyExpiresAt: number | null; // ms — createdAt + LOBBY_EXPIRY_SECONDS
}

export interface VoteResult {
  fixtureId: number;
  winningOptionId: string | null;
  isSkip: boolean;
  accepted: boolean;
  won: boolean;
}

/**
 * ============================================================================
 * REAL ON-CHAIN WIRING (undegen_core / yield_vault, devnet)
 * PDA derivations, discriminators and Borsh layouts ported from the proven
 * app/test/* pages (batch-details, join-batch, cast-vote) and cross-checked
 * against programs/undegen_core/src/state.rs and the generated IDL. No mocks.
 * ============================================================================
 */

const UNDEGEN_PROGRAM_ID = new PublicKey(SOLANA_CONFIG.PROGRAM_ID);
const YIELD_VAULT_PROGRAM_ID = new PublicKey(SOLANA_CONFIG.YIELD_VAULT_PROGRAM_ID);
const USDC_MINT = new PublicKey(SOLANA_CONFIG.USDC_MINT);
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const JOIN_BATCH_DISCRIMINATOR = Buffer.from([81, 186, 86, 76, 184, 199, 194, 96]);
const LEAVE_BATCH_DISCRIMINATOR = Buffer.from([238, 161, 41, 130, 22, 134, 9, 154]);
const CAST_VOTE_DISCRIMINATOR = Buffer.from([20, 212, 15, 189, 69, 180, 69, 151]);
const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);
const VAULT_CONFIG_DISCRIMINATOR = Buffer.from([99, 86, 43, 216, 184, 102, 119, 77]);
const INIT_VAULT_DISCRIMINATOR = Buffer.from([48, 191, 163, 44, 71, 129, 63, 164]);
const PROTOCOL_CONFIG_DISCRIMINATOR = Buffer.from([207, 91, 250, 28, 152, 179, 215, 209]);

// Anchor's fixed `associated_token_account` seed constant, reused verbatim from the test pages.
const ATA_SEED = Buffer.from([
  6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172,
  28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);

const BATCH_STATUS_NAMES = ["Lobby", "Locked", "AwaitingCollateral", "Active", "Settled", "Cancelled"] as const;

// Real on-chain program constants (programs/undegen_core/src/constants.rs).
const ON_CHAIN_MAX_BETS = 5;
const ON_CHAIN_LOBBY_EXPIRY_SECONDS = 24 * 60 * 60;

function batchStatusToPhase(statusIdx: number): BatchPhase {
  const name = BATCH_STATUS_NAMES[statusIdx] ?? "Lobby";
  switch (name) {
    case "Lobby":
      return "Lobby";
    case "Locked":
    case "AwaitingCollateral":
      return "Locked";
    case "Active":
      return "Active";
    case "Settled":
    case "Cancelled":
      return "Ended";
  }
}

// --- Borsh layouts, ported from app/test/batch-details and app/test/cast-vote ---
const BinaryOpLayout = borsh.rustEnum([
  borsh.struct([], "Add"),
  borsh.struct([], "Subtract"),
]);

const BetTermLayout = borsh.struct([
  borsh.i64("fixture_id"),
  borsh.u16("period"),
  borsh.u32("stat_a_key"),
  borsh.option(borsh.u32(), "stat_b_key"),
  borsh.option(BinaryOpLayout, "op"),
  borsh.i32("predicate_threshold"),
  borsh.u8("predicate_comparison"),
  borsh.bool("negation"),
]);

// Current (339-byte) layout: adds created_at after participant_count.
// Only batches initialized after that field was added to the program have
// it — there's no migration for batches created before, see state.rs.
const CurrentBatchLayout = borsh.struct([
  borsh.u64("batch_id"),
  borsh.publicKey("operator"),
  borsh.publicKey("mint"),
  borsh.u8("bump"),
  borsh.publicKey("vault_position"),
  borsh.u8("statusIdx"),
  borsh.u64("total_deposited"),
  borsh.u16("apy_bps"),
  borsh.u64("bet_size"),
  borsh.u8("bets_completed"),
  borsh.u64("accumulated_winnings"),
  borsh.u16("operator_yield_bps"),
  borsh.array(BetTermLayout, 4, "bet_terms"),
  borsh.i64("kickoff_timestamp"),
  borsh.u64("win_prize"),
  borsh.array(borsh.u64(), 5, "vote_weights"),
  borsh.option(borsh.u8(), "winning_vote_index"),
  borsh.u64("collateral_required"),
  borsh.u64("collateral_deposited"),
  borsh.i64("proof_deadline"),
  borsh.option(borsh.bool(), "outcome"),
  borsh.u32("participant_count"),
  borsh.i64("created_at"),
]);

// Previous (331-byte) layout: has participant_count but predates created_at.
const ParticipantCountBatchLayout = borsh.struct([
  borsh.u64("batch_id"),
  borsh.publicKey("operator"),
  borsh.publicKey("mint"),
  borsh.u8("bump"),
  borsh.publicKey("vault_position"),
  borsh.u8("statusIdx"),
  borsh.u64("total_deposited"),
  borsh.u16("apy_bps"),
  borsh.u64("bet_size"),
  borsh.u8("bets_completed"),
  borsh.u64("accumulated_winnings"),
  borsh.u16("operator_yield_bps"),
  borsh.array(BetTermLayout, 4, "bet_terms"),
  borsh.i64("kickoff_timestamp"),
  borsh.u64("win_prize"),
  borsh.array(borsh.u64(), 5, "vote_weights"),
  borsh.option(borsh.u8(), "winning_vote_index"),
  borsh.u64("collateral_required"),
  borsh.u64("collateral_deposited"),
  borsh.i64("proof_deadline"),
  borsh.option(borsh.bool(), "outcome"),
  borsh.u32("participant_count"),
]);

// Previous (327-byte) layout, includes the `op` field but predates
// participant_count/created_at. Still exists on-chain for batches created
// before that upgrade — decoded read-only here, both fields default to
// unset for these (genuinely untracked, not fabricated).
const BatchLayout = borsh.struct([
  borsh.u64("batch_id"),
  borsh.publicKey("operator"),
  borsh.publicKey("mint"),
  borsh.u8("bump"),
  borsh.publicKey("vault_position"),
  borsh.u8("statusIdx"),
  borsh.u64("total_deposited"),
  borsh.u16("apy_bps"),
  borsh.u64("bet_size"),
  borsh.u8("bets_completed"),
  borsh.u64("accumulated_winnings"),
  borsh.u16("operator_yield_bps"),
  borsh.array(BetTermLayout, 4, "bet_terms"),
  borsh.i64("kickoff_timestamp"),
  borsh.u64("win_prize"),
  borsh.array(borsh.u64(), 5, "vote_weights"),
  borsh.option(borsh.u8(), "winning_vote_index"),
  borsh.u64("collateral_required"),
  borsh.u64("collateral_deposited"),
  borsh.i64("proof_deadline"),
  borsh.option(borsh.bool(), "outcome"),
]);

// Older (319-byte) layout, predates the `op` field — kept for batches created pre-migration.
const OldBetTermLayout = borsh.struct([
  borsh.i64("fixture_id"),
  borsh.u16("period"),
  borsh.u32("stat_a_key"),
  borsh.option(borsh.u32(), "stat_b_key"),
  borsh.i32("predicate_threshold"),
  borsh.u8("predicate_comparison"),
  borsh.bool("negation"),
]);

const OldBatchLayout = borsh.struct([
  borsh.u64("batch_id"),
  borsh.publicKey("operator"),
  borsh.publicKey("mint"),
  borsh.u8("bump"),
  borsh.publicKey("vault_position"),
  borsh.u8("statusIdx"),
  borsh.u64("total_deposited"),
  borsh.u16("apy_bps"),
  borsh.u64("bet_size"),
  borsh.u8("bets_completed"),
  borsh.u64("accumulated_winnings"),
  borsh.u16("operator_yield_bps"),
  borsh.array(OldBetTermLayout, 4, "bet_terms"),
  borsh.i64("kickoff_timestamp"),
  borsh.u64("win_prize"),
  borsh.array(borsh.u64(), 5, "vote_weights"),
  borsh.option(borsh.u8(), "winning_vote_index"),
  borsh.u64("collateral_required"),
  borsh.u64("collateral_deposited"),
  borsh.i64("proof_deadline"),
  borsh.option(borsh.bool(), "outcome"),
]);

const UserPositionLayout = borsh.struct([
  borsh.publicKey("batch"),
  borsh.publicKey("owner"),
  borsh.u64("deposited_amount"),
  borsh.u64("vault_shares"),
  borsh.bool("has_voted"),
  borsh.u8("vote_index"),
  borsh.bool("claimed"),
  borsh.u8("bump"),
]);

const ProtocolConfigLayout = borsh.struct([
  borsh.publicKey("admin"),
  borsh.u64("next_batch_id"),
  borsh.u8("bump"),
]);

function decodeBatchAccount(data: Buffer) {
  if (data.length === 319) return { ...OldBatchLayout.decode(data), participant_count: 0, created_at: null };
  if (data.length === 327) return { ...BatchLayout.decode(data), participant_count: 0, created_at: null };
  if (data.length === 331) return { ...ParticipantCountBatchLayout.decode(data), created_at: null };
  if (data.length === 339) return CurrentBatchLayout.decode(data);
  throw new Error(`Unexpected Batch account size: ${data.length} bytes (expected 319, 327, 331 or 339).`);
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

function deriveBatchPda(batchId: number): PublicKey {
  const [batchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("batch"), writeUInt64LE(BigInt(batchId))],
    UNDEGEN_PROGRAM_ID
  );
  return batchPda;
}

function deriveUserPositionPda(batchPda: PublicKey, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_position"), batchPda.toBuffer(), user.toBuffer()],
    UNDEGEN_PROGRAM_ID
  );
  return pda;
}

// Loosely typed on purpose: @solana/react-hooks' wallet.signTransaction takes a
// @solana/kit transaction, not the @solana/web3.js Transaction built here. The
// proven test pages paper over this same mismatch with an `as any` cast; we do
// the same rather than rearchitect signing around @solana/kit.
export interface WalletLike {
  account?: { address?: string | null } | null;
  signTransaction?: (tx: any) => Promise<any>;
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
 * The connected wallet's real USDC balance (devnet test USDC, SOLANA_CONFIG.USDC_MINT),
 * in human units. Returns 0 if the wallet has no USDC associated token account yet
 * (e.g. they've never held this mint) rather than throwing.
 */
export async function fetchUsdcBalance(userAddress: string): Promise<number> {
  const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);
  const user = new PublicKey(userAddress);
  const ata = deriveAssociatedTokenAddress(user, USDC_MINT);

  try {
    const balance = await connection.getTokenAccountBalance(ata);
    return balance.value.uiAmount ?? 0;
  } catch {
    // Most common cause: the ATA doesn't exist yet (wallet never received this mint).
    return 0;
  }
}

/**
 * The highest batch ID that's actually been initialized on-chain, ported from
 * app/test/join-batch's "Load Latest Batch ID". Returns -1 if none exist yet.
 */
export async function fetchLatestBatchId(): Promise<number> {
  const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    UNDEGEN_PROGRAM_ID
  );
  const info = await connection.getAccountInfo(configPda);
  if (!info || !info.data.slice(0, 8).equals(PROTOCOL_CONFIG_DISCRIMINATOR)) return -1;
  const config = ProtocolConfigLayout.decode(info.data.slice(8));
  return Number(config.next_batch_id) - 1;
}

/**
 * Fetch a batch's real on-chain state (Batch account + the connected user's
 * UserPosition, if any). Ported from app/test/batch-details, app/test/join-batch
 * and app/test/cast-vote.
 *
 * `participantCount` is real for batches created after the participant_count
 * field was added to the program (331-byte accounts) — incremented/decremented
 * by join_batch/leave_batch. Older, un-migrated batches (319/327-byte) don't
 * have it on-chain at all, so it reads as 0 for those — not fabricated.
 *
 * `minimumDeposit` has no on-chain source either way: join_batch only
 * requires amount > 0, there is no program-enforced minimum — left at 0
 * rather than inventing a number.
 */
function buildBatchState(batchId: number, decoded: ReturnType<typeof decodeBatchAccount>, userDeposited: number): BatchState {
  const totalDeposited = Number(decoded.total_deposited) / 10 ** SOLANA_CONFIG.TOKEN_DECIMALS;
  const apyBps = decoded.apy_bps as number;
  const voteWeights: number[] = (decoded.vote_weights as any[]).map((w) => Number(w));
  const winningVoteIndex: number | null = decoded.winning_vote_index ?? null;
  const outcome: boolean | null = decoded.outcome ?? null;
  const createdAt: number | null = decoded.created_at != null ? Number(decoded.created_at) * 1000 : null;
  const lobbyExpiresAt: number | null = createdAt != null ? createdAt + ON_CHAIN_LOBBY_EXPIRY_SECONDS * 1000 : null;

  return {
    batchId,
    phase: batchStatusToPhase(decoded.statusIdx),
    totalDeposited,
    weeklyYieldPool: (totalDeposited * (apyBps / 10000)) / 52,
    acceptedPredictions: decoded.bets_completed as number,
    maxPredictions: ON_CHAIN_MAX_BETS,
    operatorAddress: decoded.operator.toBase58(),
    userDeposited,
    batchStartTime: Number(decoded.kickoff_timestamp) * 1000,
    participantCount: Number(decoded.participant_count ?? 0),
    minimumDeposit: 0, // no program-enforced minimum; see doc comment above
    voteWeights,
    winningVoteIndex,
    outcome,
    createdAt,
    lobbyExpiresAt,
  };
}

export async function fetchBatchOnChain(batchId: number, userAddress: string | null): Promise<BatchState> {
  const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);
  const batchPda = deriveBatchPda(batchId);

  const accountInfo = await connection.getAccountInfo(batchPda);
  if (!accountInfo) throw new Error(`Batch ${batchId} not found on-chain.`);
  if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) {
    throw new Error(`Batch ${batchId} discriminator mismatch.`);
  }

  const decoded = decodeBatchAccount(accountInfo.data.slice(8));

  let userDeposited = 0;
  if (userAddress) {
    const userPositionPda = deriveUserPositionPda(batchPda, new PublicKey(userAddress));
    const posInfo = await connection.getAccountInfo(userPositionPda);
    if (posInfo && posInfo.data.length >= 8) {
      const pos = UserPositionLayout.decode(posInfo.data.slice(8));
      userDeposited = Number(pos.deposited_amount) / 10 ** SOLANA_CONFIG.TOKEN_DECIMALS;
    }
  }

  return buildBatchState(batchId, decoded, userDeposited);
}

/**
 * Bulk-fetch every batch in `batchIds` in just two RPC calls total (one
 * getMultipleAccountsInfo for all Batch PDAs, one for all UserPosition PDAs),
 * instead of fetchBatchOnChain's one-or-two calls PER batch. Loading all ~32+
 * batches individually and in parallel was hammering the public devnet RPC
 * hard enough to get silently rate-limited — failed fetches just vanished
 * from the list via Promise.allSettled, which is why some batches (including
 * freshly initialized ones) could intermittently disappear from the UI.
 * getMultipleAccountsInfo caps out at 100 pubkeys per call; batches beyond
 * that are chunked.
 */
export async function fetchAllBatchesOnChain(batchIds: number[], userAddress: string | null): Promise<BatchState[]> {
  if (batchIds.length === 0) return [];
  const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);

  const batchPdas = batchIds.map((id) => deriveBatchPda(id));

  const CHUNK_SIZE = 100;
  const batchAccountInfos: (import("@solana/web3.js").AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < batchPdas.length; i += CHUNK_SIZE) {
    const chunk = batchPdas.slice(i, i + CHUNK_SIZE);
    const infos = await connection.getMultipleAccountsInfo(chunk);
    batchAccountInfos.push(...infos);
  }

  const decodedByIndex: { batchId: number; batchPda: PublicKey; decoded: ReturnType<typeof decodeBatchAccount> }[] = [];
  batchIds.forEach((batchId, i) => {
    const info = batchAccountInfos[i];
    if (!info) return;
    if (!info.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) return;
    try {
      const decoded = decodeBatchAccount(info.data.slice(8));
      decodedByIndex.push({ batchId, batchPda: batchPdas[i], decoded });
    } catch {
      // Unrecognized account size (e.g. a pre-migration layout we don't handle) — skip, don't crash the whole load.
    }
  });

  let userDepositedByBatchId = new Map<number, number>();
  if (userAddress) {
    const user = new PublicKey(userAddress);
    const positionPdas = decodedByIndex.map(({ batchPda }) => deriveUserPositionPda(batchPda, user));
    const positionInfos: (import("@solana/web3.js").AccountInfo<Buffer> | null)[] = [];
    for (let i = 0; i < positionPdas.length; i += CHUNK_SIZE) {
      const chunk = positionPdas.slice(i, i + CHUNK_SIZE);
      const infos = await connection.getMultipleAccountsInfo(chunk);
      positionInfos.push(...infos);
    }
    decodedByIndex.forEach(({ batchId }, i) => {
      const posInfo = positionInfos[i];
      if (posInfo && posInfo.data.length >= 8) {
        const pos = UserPositionLayout.decode(posInfo.data.slice(8));
        userDepositedByBatchId.set(batchId, Number(pos.deposited_amount) / 10 ** SOLANA_CONFIG.TOKEN_DECIMALS);
      }
    });
  }

  return decodedByIndex.map(({ batchId, decoded }) =>
    buildBatchState(batchId, decoded, userDepositedByBatchId.get(batchId) ?? 0)
  );
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
 * The inverse of resolveVoteIndex: given a batch's already-fetched on-chain
 * state and the full /api/txodds option catalog, reconstruct the single real
 * match this batch proposed (via propose_match + the Redis batch-mapping) —
 * its options, real vote_weights as tallies, and the real decided outcome
 * (if winning_vote_index has been set). Returns nulls if nothing's been
 * proposed for this batch yet (still Lobby/Locked, pre-propose_match).
 */
export async function fetchLiveMatchForBatch(
  batchId: number,
  batchState: BatchState,
  allOptions: Option[]
): Promise<{ fixture: Fixture | null; votes: Record<string, number>; decision: VoteResult | null }> {
  const res = await fetch(`/api/batch-mapping?batchId=${batchId}`);
  if (!res.ok) return { fixture: null, votes: {}, decision: null };

  const mapping = await res.json();
  const slotsMapping: Record<string, { messageId: string; ts: number; outcomeIndex: number }> =
    mapping.slotsMapping || {};

  const optionsById = new Map(allOptions.map((o) => [o.id, o]));
  const resolvedSlots: { slotIndex: number; option: Option }[] = [];
  for (const [indexStr, slot] of Object.entries(slotsMapping)) {
    const option = optionsById.get(`${slot.messageId}-${slot.outcomeIndex}`);
    if (option) resolvedSlots.push({ slotIndex: Number(indexStr), option });
  }
  resolvedSlots.sort((a, b) => a.slotIndex - b.slotIndex);

  if (resolvedSlots.length === 0) {
    return { fixture: null, votes: {}, decision: null };
  }

  const fixtureId = Number(mapping.fixtureId) || resolvedSlots[0].option.fixtureId;
  const first = resolvedSlots[0].option;
  const fixture: Fixture = {
    fixtureId,
    participant1: first.participant1,
    participant2: first.participant2,
    startTime: first.startTime,
    options: resolvedSlots.map((s) => s.option),
  };

  const votes: Record<string, number> = {};
  for (const { slotIndex, option } of resolvedSlots) {
    votes[option.id] = batchState.voteWeights[slotIndex] ?? 0;
  }
  votes[`${fixtureId}-skip`] = batchState.voteWeights[4] ?? 0;

  let decision: VoteResult | null = null;
  if (batchState.winningVoteIndex !== null) {
    const isSkip = batchState.winningVoteIndex === 4;
    const winner = resolvedSlots.find((s) => s.slotIndex === batchState.winningVoteIndex);
    decision = {
      fixtureId,
      winningOptionId: isSkip ? `${fixtureId}-skip` : winner?.option.id ?? null,
      isSkip,
      accepted: !isSkip,
      won: batchState.outcome === true,
    };
  }

  return { fixture, votes, decision };
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

  const batchPda = deriveBatchPda(batchId);
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
  const userPositionPda = deriveUserPositionPda(batchPda, user);

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
 * Leave a batch still in Lobby, redeeming `amount` of the user's deposit back
 * to their wallet — partial or full (real `leave_batch` instruction,
 * user-signed). Ported from
 * programs/undegen_core/src/instructions/leave_batch.rs's account list —
 * there's no app/test page for this one, so this is the first real use.
 */
export async function leaveBatchOnChain(batchId: number, amount: number, wallet: WalletLike): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);

  const [vaultConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config"), USDC_MINT.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );

  const batchPda = deriveBatchPda(batchId);
  const accountInfo = await connection.getAccountInfo(batchPda);
  if (!accountInfo) throw new Error("Batch account not found on-chain.");
  if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) throw new Error("Batch not initialized.");

  const userTokenAccount = deriveAssociatedTokenAddress(user, USDC_MINT);
  const batchTokenAccount = deriveAssociatedTokenAddress(batchPda, USDC_MINT);
  const vaultTokenAccount = deriveAssociatedTokenAddress(vaultConfigPda, USDC_MINT);
  const [vaultPositionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), vaultConfigPda.toBuffer(), batchPda.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );
  const userPositionPda = deriveUserPositionPda(batchPda, user);

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

  const rawAmount = BigInt(Math.floor(amount * 10 ** SOLANA_CONFIG.TOKEN_DECIMALS));
  const data = Buffer.concat([LEAVE_BATCH_DISCRIMINATOR, writeUInt64LE(rawAmount)]);

  const ix = new TransactionInstruction({ programId: UNDEGEN_PROGRAM_ID, keys, data });
  const tx = new Transaction().add(ix);

  return signAndSend(connection, tx, user, wallet);
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
  const batchPda = deriveBatchPda(batchId);

  const accountInfo = await connection.getAccountInfo(batchPda);
  if (!accountInfo || !accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) {
    throw new Error("Batch not found or not initialized.");
  }

  const userPositionPda = deriveUserPositionPda(batchPda, user);

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
