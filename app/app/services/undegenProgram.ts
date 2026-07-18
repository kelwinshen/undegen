import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import * as borsh from "@coral-xyz/borsh";
import { SOLANA_CONFIG } from "../lib/solanaConfig";
import undegenCoreIdl from "../lib/idl/undegen_core.json";
import lotteryIdl from "../lib/idl/lottery.json";
import yieldVaultIdl from "../lib/idl/yield_vault.json";

export type BatchPhase = "Lobby" | "Locked" | "Active" | "Ended";

// A single selectable outcome within a Fixture — one TxOdds market/outcome,
// enriched with the human-readable fields the UI renders (label, odds).
// messageId/ts/outcomeIndex are TxOdds's own identity for this price (used
// to re-match a stored bet_terms slot back to a live option); marketType/
// outcome/period drive deriveBetTermFromOption's on-chain term reconstruction
// and aren't set when an Option is instead recovered from a stored slot
// mapping (optionFromStoredSlot) that only captured the display fields.
export interface Option {
  id: string;
  fixtureId: number;
  participant1: string;
  participant2: string;
  odds: number;
  startTime: number;
  label: string;
  messageId: string;
  ts: number;
  outcomeIndex: number;
  marketType?: string;
  outcome?: string;
  period?: number;
  competition?: string;
}

// A real-world match, resolved either from live TxOdds data or reconstructed
// from this batch's on-chain bet_terms — the shape ConsensusVoting renders.
export interface Fixture {
  fixtureId: number;
  participant1: string;
  participant2: string;
  startTime: number;
  options: Option[];
}

// Mirrors on-chain BetTerms (state.rs) — an unused slot has fixtureId 0.
export interface RawBetTerm {
  fixtureId: number;
  period: number;
  statAKey: number;
  statBKey: number | null;
  op: "Add" | "Subtract" | null;
  predicateThreshold: number;
  predicateComparison: number;
  negation: boolean;
}

export interface BatchState {
  batchId: number;
  phase: BatchPhase;
  totalDeposited: number;
  weeklyYieldPool: number;
  // Basis points (1% = 100 bps) — the operator-proposed APY set when this
  // batch was initialized on-chain; weeklyYieldPool is derived from it.
  apyBps: number;
  // Fixed guaranteed payout per bet, set on-chain at start_batch (bet_size in
  // start_batch.rs = weekly yield ÷ MAX_BETS at lock time) — not recomputed
  // client-side, so it stays correct even if this getter's totalDeposited read
  // ever raced a deposit.
  betSize: number;
  acceptedPredictions: number;
  maxPredictions: number;
  operatorAddress: string;
  userDeposited: number;
  userHasVoted: boolean;
  // Real on-chain vote_index (0-3 = a bet_terms slot, 4 = skip) from
  // UserPosition — null when userHasVoted is false. cast_vote allows
  // switching votes (subtracts old weight, applies to new index), so this
  // always reflects the current choice, not just "did they ever vote."
  userVotedIndex: number | null;
  batchStartTime: number;
  participantCount: number;
  minimumDeposit: number;
  userWithdrawn?: boolean;
  // Raw consensus state, needed to resolve this batch's proposed match for display.
  voteWeights: number[]; // [bet0, bet1, bet2, bet3, skip]
  winningVoteIndex: number | null;
  outcome: boolean | null;
  // Real on-chain bet terms (propose_match) — used to reconstruct this
  // batch's match/options directly from chain when the Redis batch-mapping
  // cache is missing or stale.
  betTerms: RawBetTerm[];
  // Null for batches created before `created_at` existed on-chain (no migration).
  createdAt: number | null; // ms
  lobbyExpiresAt: number | null; // ms — createdAt + LOBBY_EXPIRY_SECONDS
  // The raw on-chain BatchStatus name (Lobby/Locked/AwaitingCollateral/
  // Active/Settled/Cancelled) — same value app/test/batch-details reads
  // straight off statusIdx. `phase` above collapses several of these into
  // "Active" for other UI purposes; this is the real, undegraded value for
  // anything (like the Live Batches list) that needs to tell them apart.
  rawStatus: (typeof BATCH_STATUS_NAMES)[number];
  // Real cumulative counts across every bet this batch has settled so far —
  // unlike winningVoteIndex/outcome (which only ever reflect the current,
  // in-flight bet and reset each round), these persist for the batch's
  // whole lifetime. wins + losses + skipped == acceptedPredictions. 0 for
  // batches created before these fields existed on-chain (genuinely
  // untracked, not fabricated — see decodeBatchAccount).
  winsCount: number;
  lossesCount: number;
  skipsCount: number;
  // Total collateral compounded into the vault across every proof-verified
  // win this batch has settled (settle_with_proof's true branch only —
  // default-wins and skip-wins never had collateral to compound, see
  // accumulated_winnings in state.rs). Present on every account layout, so
  // unlike winsCount/lossesCount/skipsCount this is never a fabricated 0.
  accumulatedWinnings: number;
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

// Program IDs come straight off each program's own IDL (lib/idl/*.json,
// generated by `anchor build`) instead of being hardcoded here — redeploying
// under a new address just means regenerating that JSON, nothing to update
// in this file.
const UNDEGEN_PROGRAM_ID = new PublicKey(undegenCoreIdl.address);
const YIELD_VAULT_PROGRAM_ID = new PublicKey(yieldVaultIdl.address);
const LOTTERY_PROGRAM_ID = new PublicKey(lotteryIdl.address);
const USDC_MINT = new PublicKey(SOLANA_CONFIG.USDC_MINT);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

const JOIN_BATCH_DISCRIMINATOR = Buffer.from([
  81, 186, 86, 76, 184, 199, 194, 96,
]);
const LEAVE_BATCH_DISCRIMINATOR = Buffer.from([
  238, 161, 41, 130, 22, 134, 9, 154,
]);
const CLAIM_DISCRIMINATOR = Buffer.from([
  62, 198, 214, 193, 213, 159, 108, 210,
]);
const CLAIM_AND_JOIN_LOTTERY_DISCRIMINATOR = Buffer.from([
  172, 154, 144, 50, 228, 215, 185, 209,
]);
const BUY_TICKET_DISCRIMINATOR = Buffer.from([
  11, 24, 17, 193, 168, 116, 164, 169,
]);
const CLAIM_PRIZE_DISCRIMINATOR = Buffer.from([
  157, 233, 139, 121, 246, 62, 234, 235,
]);
const LOTTERY_CONFIG_DISCRIMINATOR = Buffer.from([
  174, 54, 184, 175, 81, 20, 237, 24,
]);
const LOTTERY_ROUND_DISCRIMINATOR = Buffer.from([
  87, 127, 165, 51, 73, 78, 116, 174,
]);
const LOTTERY_ENTRY_DISCRIMINATOR = Buffer.from([
  63, 18, 152, 113, 215, 246, 221, 250,
]);
const CAST_VOTE_DISCRIMINATOR = Buffer.from([
  20, 212, 15, 189, 69, 180, 69, 151,
]);
const SETTLE_DEFAULT_DISCRIMINATOR = Buffer.from([
  246, 228, 125, 180, 94, 53, 233, 137,
]);
const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);
const PROTOCOL_CONFIG_DISCRIMINATOR = Buffer.from([
  207, 91, 250, 28, 152, 179, 215, 209,
]);

const BATCH_STATUS_NAMES = [
  "Lobby",
  "Locked",
  "AwaitingCollateral",
  "Active",
  "Settled",
  "Cancelled",
] as const;

// Real on-chain program constants (programs/undegen_core/src/constants.rs).
const ON_CHAIN_MAX_BETS = 5;
const ON_CHAIN_LOBBY_EXPIRY_SECONDS = 24 * 60 * 60;

function batchStatusToPhase(statusIdx: number): BatchPhase {
  const name = BATCH_STATUS_NAMES[statusIdx] ?? "Lobby";
  switch (name) {
    case "Lobby":
      return "Lobby";
    // A batch cycles Locked -> AwaitingCollateral -> Active -> Locked across
    // each of its 5 weekly bets (finalize_consensus / deposit_collateral /
    // settle_with_proof) without ever going back to Lobby. All of these —
    // plus the (currently unused) Cancelled status — are still "the batch
    // that's live right now" from the UI's perspective; only Settled is
    // actually done.
    case "Locked":
    case "AwaitingCollateral":
    case "Active":
    case "Cancelled":
      return "Active";
    case "Settled":
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

// Current (342-byte) layout: adds wins_count/losses_count/skips_count after
// created_at. Only batches initialized after these fields were added to the
// program have them — there's no migration for batches created before, see
// state.rs. bets_completed already counted every settled bet regardless of
// outcome; these three break that total down by real result so history
// isn't lost once a later bet's state overwrites the earlier one's.
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
  borsh.u8("wins_count"),
  borsh.u8("losses_count"),
  borsh.u8("skips_count"),
]);

// Previous (339-byte) layout: has created_at but predates wins/losses/skips
// counts.
const TimestampedBatchLayout = borsh.struct([
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

// Previous (84-byte) layout: predates voted_at_round. There's no migration
// for positions created before this field existed — same caveat as Batch's
// appended fields, see state.rs.
const OldUserPositionLayout = borsh.struct([
  borsh.publicKey("batch"),
  borsh.publicKey("owner"),
  borsh.u64("deposited_amount"),
  borsh.u64("vault_shares"),
  borsh.bool("has_voted"),
  borsh.u8("vote_index"),
  borsh.bool("claimed"),
  borsh.u8("bump"),
]);

// Current (85-byte) layout: adds voted_at_round after bump — stamped with
// the batch's bets_completed at the moment of cast_vote, so a stale vote
// left over from an already-settled round can be told apart from a real
// vote on the current round (see state.rs's UserPosition doc comment).
const CurrentUserPositionLayout = borsh.struct([
  borsh.publicKey("batch"),
  borsh.publicKey("owner"),
  borsh.u64("deposited_amount"),
  borsh.u64("vault_shares"),
  borsh.bool("has_voted"),
  borsh.u8("vote_index"),
  borsh.bool("claimed"),
  borsh.u8("bump"),
  borsh.u8("voted_at_round"),
]);

// Defaults voted_at_round to 0 for un-migrated positions — the safest
// approximation available: it reads as "still valid" for a batch's first
// round (bets_completed === 0, the common case for older positions) and as
// stale as soon as the round advances, which is exactly this fix's intent
// rather than a fabricated "always voted" or "never voted" guess.
function decodeUserPositionAccount(data: Buffer) {
  if (data.length === 85) return CurrentUserPositionLayout.decode(data);
  return { ...OldUserPositionLayout.decode(data), voted_at_round: 0 };
}

const ProtocolConfigLayout = borsh.struct([
  borsh.publicKey("admin"),
  borsh.u64("next_batch_id"),
  borsh.u8("bump"),
]);

function decodeBatchAccount(data: Buffer) {
  if (data.length === 319)
    return {
      ...OldBatchLayout.decode(data),
      participant_count: 0,
      created_at: null,
      wins_count: 0,
      losses_count: 0,
      skips_count: 0,
    };
  if (data.length === 327)
    return {
      ...BatchLayout.decode(data),
      participant_count: 0,
      created_at: null,
      wins_count: 0,
      losses_count: 0,
      skips_count: 0,
    };
  if (data.length === 331)
    return {
      ...ParticipantCountBatchLayout.decode(data),
      created_at: null,
      wins_count: 0,
      losses_count: 0,
      skips_count: 0,
    };
  if (data.length === 339)
    return {
      ...TimestampedBatchLayout.decode(data),
      wins_count: 0,
      losses_count: 0,
      skips_count: 0,
    };
  if (data.length === 342) return CurrentBatchLayout.decode(data);
  throw new Error(
    `Unexpected Batch account size: ${data.length} bytes (expected 319, 327, 331, 339 or 342).`
  );
}

function writeUInt64LE(value: bigint | number): Buffer {
  const buffer = Buffer.alloc(8);
  new DataView(buffer.buffer).setBigUint64(0, BigInt(value), true);
  return buffer;
}

function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey
): PublicKey {
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

function deriveUserPositionPda(
  batchPda: PublicKey,
  user: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_position"), batchPda.toBuffer(), user.toBuffer()],
    UNDEGEN_PROGRAM_ID
  );
  return pda;
}

function deriveCollateralPda(batchPda: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), batchPda.toBuffer()],
    UNDEGEN_PROGRAM_ID
  );
  return pda;
}

// --- lottery PDAs (programs/lottery/src/constants.rs) — one shared config
// per mint, rounds numbered off LotteryConfig.current_round_id, one Entry
// per (round, buyer). Permissionless: buy_ticket only requires a signer and
// USDC, no tie to any undegen_core batch.
function deriveLotteryConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lottery_config"), USDC_MINT.toBuffer()],
    LOTTERY_PROGRAM_ID
  );
  return pda;
}

function deriveLotteryRoundPda(roundId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("round"), USDC_MINT.toBuffer(), writeUInt64LE(roundId)],
    LOTTERY_PROGRAM_ID
  );
  return pda;
}

function deriveLotteryEntryPda(
  roundPda: PublicKey,
  buyer: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("entry"), roundPda.toBuffer(), buyer.toBuffer()],
    LOTTERY_PROGRAM_ID
  );
  return pda;
}

const LotteryConfigLayout = borsh.struct([
  borsh.publicKey("admin"),
  borsh.publicKey("mint"),
  borsh.u64("current_round_id"),
  borsh.u8("bump"),
]);

// Order must match RoundStatus exactly (programs/lottery/src/state.rs) — a
// borsh rustEnum's variants are matched positionally by index, not by name.
const LotteryRoundStatusLayout = borsh.rustEnum([
  borsh.struct([], "Open"),
  borsh.struct([], "RandomnessRequested"),
  borsh.struct([], "Drawn"),
  borsh.struct([], "Settled"),
]);

// Field order must match the on-chain Round struct exactly (state.rs).
const LotteryRoundLayout = borsh.struct([
  borsh.u64("round_id"),
  borsh.publicKey("mint"),
  borsh.publicKey("jackpot_token_account"),
  borsh.u64("total_pool"),
  LotteryRoundStatusLayout.replicate("status"),
  borsh.u64("winning_number"),
  borsh.i64("start_time"),
  borsh.publicKey("randomness_account"),
  borsh.u8("bump"),
]);

export type LotteryRoundStatus =
  "Open" | "RandomnessRequested" | "Drawn" | "Settled";

// Minimum time a round must stay open before the admin can request the draw
// (programs/lottery/src/constants.rs's ROUND_DURATION_SECONDS — also in the
// IDL's `constants` array, but hardcoded here like every other on-chain
// constant in this file rather than parsed out of the IDL at runtime).
export const LOTTERY_ROUND_DURATION_SECONDS = 7 * 24 * 60 * 60;

export interface LotteryRoundState {
  roundId: bigint;
  roundPda: string;
  jackpotTokenAccount: string;
  totalPool: number;
  status: LotteryRoundStatus;
  winningNumber: bigint;
  // ms epoch — when start_round created this round (Clock::get() at that
  // instruction). Combined with LOTTERY_ROUND_DURATION_SECONDS, this is when
  // request_randomness (and therefore reveal_winner) first becomes callable.
  startTime: number;
  // This wallet's ticket in this round, if any — null when not connected or
  // no ticket was bought. isWinner mirrors claim_prize.rs's own range check
  // so the UI never re-derives that logic independently.
  myEntry: (LotteryEntryState & { isWinner: boolean }) | null;
}

export interface LotteryConfigState {
  admin: string;
  currentRoundId: bigint;
}

// Shared by fetchActiveLotteryRound and fetchAllLotteryRoundsOnChain so the
// layout decode + unit conversion only lives in one place.
function decodeLotteryRoundAccount(
  roundId: bigint,
  roundPda: PublicKey,
  data: Buffer
): Omit<LotteryRoundState, "myEntry"> {
  const round = LotteryRoundLayout.decode(data.slice(8));
  const status =
    (Object.keys(round.status)[0] as LotteryRoundStatus) ?? "Settled";
  return {
    roundId,
    roundPda: roundPda.toBase58(),
    jackpotTokenAccount: (round.jackpot_token_account as PublicKey).toBase58(),
    totalPool:
      Number(round.total_pool.toString()) / 10 ** SOLANA_CONFIG.TOKEN_DECIMALS,
    status,
    winningNumber: BigInt(round.winning_number.toString()),
    startTime: Number(round.start_time.toString()) * 1000,
  };
}

/** Whether LotteryConfig exists yet at all — false before anyone has called `initialize_lottery`. */
export async function fetchLotteryConfig(): Promise<LotteryConfigState | null> {
  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );
  const lotteryConfigPda = deriveLotteryConfigPda();
  const configInfo = await connection.getAccountInfo(lotteryConfigPda);
  if (
    !configInfo ||
    !configInfo.data.slice(0, 8).equals(LOTTERY_CONFIG_DISCRIMINATOR)
  )
    return null;

  const config = LotteryConfigLayout.decode(configInfo.data.slice(8));
  return {
    admin: (config.admin as PublicKey).toBase58(),
    currentRoundId: BigInt(config.current_round_id.toString()),
  };
}

/**
 * The lottery's single currently-open round for the configured USDC mint —
 * null if the lottery hasn't been initialized yet, or its latest round
 * isn't Open (already drawn/settled and the admin hasn't started a new one).
 * Read-only, no wallet required — anyone can see what's joinable.
 */
export async function fetchActiveLotteryRound(): Promise<LotteryRoundState | null> {
  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );
  const config = await fetchLotteryConfig();
  if (!config) return null;

  const currentRoundId = config.currentRoundId;
  if (currentRoundId <= BigInt(0)) return null;

  const roundPda = deriveLotteryRoundPda(currentRoundId);
  const roundInfo = await connection.getAccountInfo(roundPda);
  if (
    !roundInfo ||
    !roundInfo.data.slice(0, 8).equals(LOTTERY_ROUND_DISCRIMINATOR)
  )
    return null;

  const decoded = decodeLotteryRoundAccount(
    currentRoundId,
    roundPda,
    roundInfo.data
  );
  if (decoded.status !== "Open") return null;

  return { ...decoded, myEntry: null };
}

const LotteryEntryLayout = borsh.struct([
  borsh.publicKey("round"),
  borsh.publicKey("owner"),
  borsh.u64("amount"),
  borsh.u64("start_offset"),
  borsh.u64("end_offset"),
  borsh.bool("claimed"),
  borsh.u8("bump"),
]);

export interface LotteryEntryState {
  amount: number;
  startOffset: bigint;
  endOffset: bigint;
  claimed: boolean;
}

/**
 * Bulk-fetch every round in `roundIds` (one `getMultipleAccountsInfo` for all
 * Round PDAs, one for all Entry PDAs when `userAddress` is given) — same
 * two-call shape as `fetchAllBatchesOnChain`, so a full round-history list
 * doesn't cost one RPC round-trip per round. `roundIds` should be 1..
 * `currentRoundId` (from `fetchLotteryConfig`); round 0 never exists since
 * `current_round_id` starts at 1 after the first `start_round`.
 */
export async function fetchAllLotteryRoundsOnChain(
  roundIds: bigint[],
  userAddress: string | null
): Promise<LotteryRoundState[]> {
  if (roundIds.length === 0) return [];
  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );

  const roundPdas = roundIds.map((id) => deriveLotteryRoundPda(id));

  const CHUNK_SIZE = 100;
  const roundAccountInfos: (
    import("@solana/web3.js").AccountInfo<Buffer> | null
  )[] = [];
  for (let i = 0; i < roundPdas.length; i += CHUNK_SIZE) {
    const chunk = roundPdas.slice(i, i + CHUNK_SIZE);
    const infos = await connection.getMultipleAccountsInfo(chunk);
    roundAccountInfos.push(...infos);
  }

  const decoded: Omit<LotteryRoundState, "myEntry">[] = [];
  const decodedRoundPdas: PublicKey[] = [];
  roundIds.forEach((roundId, i) => {
    const info = roundAccountInfos[i];
    if (!info) return;
    if (!info.data.slice(0, 8).equals(LOTTERY_ROUND_DISCRIMINATOR)) return;
    try {
      decoded.push(decodeLotteryRoundAccount(roundId, roundPdas[i], info.data));
      decodedRoundPdas.push(roundPdas[i]);
    } catch {
      // Unrecognized account size (e.g. a pre-migration Round created before
      // start_time/randomness_account existed) — skip, don't crash the whole load.
    }
  });

  const entriesByRoundPda = new Map<string, LotteryEntryState>();
  if (userAddress) {
    const user = new PublicKey(userAddress);
    const entryPdas = decodedRoundPdas.map((roundPda) =>
      deriveLotteryEntryPda(roundPda, user)
    );
    const entryInfos: (import("@solana/web3.js").AccountInfo<Buffer> | null)[] =
      [];
    for (let i = 0; i < entryPdas.length; i += CHUNK_SIZE) {
      const chunk = entryPdas.slice(i, i + CHUNK_SIZE);
      const infos = await connection.getMultipleAccountsInfo(chunk);
      entryInfos.push(...infos);
    }
    decodedRoundPdas.forEach((roundPda, i) => {
      const info = entryInfos[i];
      if (!info || !info.data.slice(0, 8).equals(LOTTERY_ENTRY_DISCRIMINATOR))
        return;
      const entry = LotteryEntryLayout.decode(info.data.slice(8));
      const amountRaw = BigInt(entry.amount.toString());
      if (amountRaw <= BigInt(0)) return;
      entriesByRoundPda.set(roundPda.toBase58(), {
        amount: Number(amountRaw) / 10 ** SOLANA_CONFIG.TOKEN_DECIMALS,
        startOffset: BigInt(entry.start_offset.toString()),
        endOffset: BigInt(entry.end_offset.toString()),
        claimed: Boolean(entry.claimed),
      });
    });
  }

  return decoded.map((round) => {
    const entry = entriesByRoundPda.get(round.roundPda) ?? null;
    const myEntry = entry
      ? {
          ...entry,
          isWinner:
            round.winningNumber >= entry.startOffset &&
            round.winningNumber < entry.endOffset,
        }
      : null;
    return { ...round, myEntry };
  });
}

/**
 * Buy a lottery ticket for `amount` USDC in the currently open round (real
 * `buy_ticket` instruction, user-signed) — permissionless, no relationship
 * to any undegen_core batch required. Ported from
 * programs/lottery/src/instructions/buy_ticket.rs's account list.
 */
export async function buyTicketOnChain(
  amount: number,
  wallet: WalletLike
): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );

  const activeRound = await fetchActiveLotteryRound();
  if (!activeRound) throw new Error("No open lottery round to join right now.");

  const roundPda = new PublicKey(activeRound.roundPda);
  const jackpotTokenAccount = new PublicKey(activeRound.jackpotTokenAccount);
  const buyerTokenAccount = deriveAssociatedTokenAddress(user, USDC_MINT);
  const entryPda = deriveLotteryEntryPda(roundPda, user);

  const rawAmount = BigInt(
    Math.floor(amount * 10 ** SOLANA_CONFIG.TOKEN_DECIMALS)
  );
  const data = Buffer.concat([
    BUY_TICKET_DISCRIMINATOR,
    writeUInt64LE(rawAmount),
  ]);

  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: roundPda, isSigner: false, isWritable: true },
    { pubkey: jackpotTokenAccount, isSigner: false, isWritable: true },
    { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: entryPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: LOTTERY_PROGRAM_ID,
    keys,
    data,
  });
  const tx = new Transaction().add(ix);

  return signAndSend(connection, tx, user, wallet);
}

/**
 * Claim a Drawn round's jackpot (real `claim_prize` instruction, user-signed)
 * — reverts unless this wallet's Entry range covers the round's
 * winning_number and it hasn't been claimed yet. Ported from
 * programs/lottery/src/instructions/claim_prize.rs's account list.
 */
export async function claimPrizeOnChain(
  roundId: bigint,
  wallet: WalletLike
): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );

  const roundPda = deriveLotteryRoundPda(roundId);
  const roundInfo = await connection.getAccountInfo(roundPda);
  if (
    !roundInfo ||
    !roundInfo.data.slice(0, 8).equals(LOTTERY_ROUND_DISCRIMINATOR)
  ) {
    throw new Error(`Round ${roundId} not found on-chain.`);
  }
  const round = decodeLotteryRoundAccount(roundId, roundPda, roundInfo.data);

  const jackpotTokenAccount = new PublicKey(round.jackpotTokenAccount);
  const winnerTokenAccount = deriveAssociatedTokenAddress(user, USDC_MINT);
  const entryPda = deriveLotteryEntryPda(roundPda, user);

  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: roundPda, isSigner: false, isWritable: true },
    { pubkey: jackpotTokenAccount, isSigner: false, isWritable: true },
    { pubkey: winnerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: entryPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: LOTTERY_PROGRAM_ID,
    keys,
    data: CLAIM_PRIZE_DISCRIMINATOR,
  });
  const tx = new Transaction().add(ix);

  return signAndSend(connection, tx, user, wallet);
}

// Loosely typed on purpose: @solana/react-hooks' wallet.signTransaction takes a
// @solana/kit transaction, not the @solana/web3.js Transaction built here. The
// proven test pages paper over this same mismatch with an `as any` cast; we do
// the same rather than rearchitect signing around @solana/kit.
export interface WalletLike {
  account?: { address?: string | null } | null;
  signTransaction?: (tx: any) => Promise<any>;
}

async function signAndSend(
  connection: Connection,
  tx: Transaction,
  userPubkey: PublicKey,
  wallet: WalletLike
): Promise<string> {
  tx.feePayer = userPubkey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  const provider =
    typeof window !== "undefined" ? (window as any).solana : undefined;
  let rawTx: any;
  if (provider) {
    const signedTx = await provider.signTransaction(tx);
    rawTx = signedTx.serialize();
  } else if (wallet.signTransaction) {
    const signed = await wallet.signTransaction(tx as any);
    rawTx =
      signed instanceof Uint8Array ? signed : (signed?.serialize?.() ?? signed);
  } else {
    throw new Error("Wallet does not support signTransaction.");
  }

  const sig = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
  });
  await connection.confirmTransaction(sig);
  return sig;
}

/**
 * The connected wallet's real USDC balance (devnet test USDC, SOLANA_CONFIG.USDC_MINT),
 * in human units. Returns 0 if the wallet has no USDC associated token account yet
 * (e.g. they've never held this mint) rather than throwing.
 */
export async function fetchUsdcBalance(userAddress: string): Promise<number> {
  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );
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

// Single long-lived connection reserved for real-time WebSocket account
// subscriptions. web3.js only opens the socket lazily, the moment something
// calls .onAccountChange on it, and keeps it alive as long as this connection
// has active subscriptions — the throwaway `new Connection(...)` used by every
// one-off RPC call above never subscribes, so it never pays for a socket.
// Reusing one instance here (instead of a fresh Connection per subscribe call)
// means switching batches/wallets reuses the same socket instead of opening a
// new one every time.
const realtimeConnection = new Connection(
  SOLANA_CONFIG.RPC_URL,
  SOLANA_CONFIG.COMMITMENT
);

/**
 * Pushes a signal — no payload, callers refetch via fetchUsdcBalance above so
 * there's only one place owning the decode/decimals logic — the instant
 * `userAddress`'s USDC associated token account changes on-chain (deposit,
 * withdrawal, or any external transfer). Safe to call before the ATA exists:
 * the subscription just fires the first time it's created. Returns an
 * unsubscribe function; always call it (on wallet change or unmount) or the
 * socket leaks a listener.
 */
export function subscribeToUsdcAccount(
  userAddress: string,
  onChange: () => void
): () => void {
  const user = new PublicKey(userAddress);
  const ata = deriveAssociatedTokenAddress(user, USDC_MINT);
  const subId = realtimeConnection.onAccountChange(
    ata,
    () => onChange(),
    SOLANA_CONFIG.COMMITMENT
  );
  return () => {
    realtimeConnection.removeAccountChangeListener(subId).catch(() => {});
  };
}

/**
 * Pushes a signal the instant `batchId`'s Batch account changes on-chain
 * (any wallet's deposit/withdraw/vote/settlement — not just this one), plus
 * `userAddress`'s UserPosition for it if given. Callers refetch via
 * fetchBatchOnChain/fetchAllBatchesOnChain to reuse the real decode logic.
 * Returns a single unsubscribe that tears down both listeners.
 */
export function subscribeToBatchAccount(
  batchId: number,
  userAddress: string | null,
  onChange: () => void
): () => void {
  const batchPda = deriveBatchPda(batchId);
  const subIds = [
    realtimeConnection.onAccountChange(
      batchPda,
      () => onChange(),
      SOLANA_CONFIG.COMMITMENT
    ),
  ];
  if (userAddress) {
    const userPositionPda = deriveUserPositionPda(
      batchPda,
      new PublicKey(userAddress)
    );
    subIds.push(
      realtimeConnection.onAccountChange(
        userPositionPda,
        () => onChange(),
        SOLANA_CONFIG.COMMITMENT
      )
    );
  }
  return () => {
    subIds.forEach((id) =>
      realtimeConnection.removeAccountChangeListener(id).catch(() => {})
    );
  };
}

/**
 * The highest batch ID that's actually been initialized on-chain, ported from
 * app/test/join-batch's "Load Latest Batch ID". Returns -1 if none exist yet.
 */
export async function fetchLatestBatchId(): Promise<number> {
  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    UNDEGEN_PROGRAM_ID
  );
  const info = await connection.getAccountInfo(configPda);
  if (!info || !info.data.slice(0, 8).equals(PROTOCOL_CONFIG_DISCRIMINATOR))
    return -1;
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
function buildBatchState(
  batchId: number,
  decoded: ReturnType<typeof decodeBatchAccount>,
  userDeposited: number,
  userHasVoted: boolean = false,
  userVotedIndex: number | null = null,
  userClaimed: boolean = false
): BatchState {
  const totalDeposited =
    Number(decoded.total_deposited) / 10 ** SOLANA_CONFIG.TOKEN_DECIMALS;
  const apyBps = decoded.apy_bps as number;
  const voteWeights: number[] = (decoded.vote_weights as any[]).map((w) =>
    Number(w)
  );
  const winningVoteIndex: number | null = decoded.winning_vote_index ?? null;
  const outcome: boolean | null = decoded.outcome ?? null;
  const createdAt: number | null =
    decoded.created_at != null ? Number(decoded.created_at) * 1000 : null;
  const lobbyExpiresAt: number | null =
    createdAt != null ? createdAt + ON_CHAIN_LOBBY_EXPIRY_SECONDS * 1000 : null;
  const betTerms: RawBetTerm[] = (decoded.bet_terms as any[]).map((term) => ({
    fixtureId: Number(term.fixture_id),
    period: term.period as number,
    statAKey: term.stat_a_key as number,
    statBKey: term.stat_b_key != null ? (term.stat_b_key as number) : null,
    op: term.op
      ? (("Add" in term.op ? "Add" : "Subtract") as "Add" | "Subtract")
      : null,
    predicateThreshold: term.predicate_threshold as number,
    predicateComparison: term.predicate_comparison as number,
    negation: term.negation as boolean,
  }));

  const rawStatus = BATCH_STATUS_NAMES[decoded.statusIdx] ?? "Lobby";

  return {
    batchId,
    phase: batchStatusToPhase(decoded.statusIdx),
    totalDeposited,
    weeklyYieldPool: (totalDeposited * (apyBps / 10000)) / 52,
    apyBps,
    betSize: Number(decoded.bet_size) / 10 ** SOLANA_CONFIG.TOKEN_DECIMALS,
    acceptedPredictions: decoded.bets_completed as number,
    maxPredictions: ON_CHAIN_MAX_BETS,
    operatorAddress: decoded.operator.toBase58(),
    userDeposited,
    userHasVoted,
    userVotedIndex,
    // `claim` (not `leave_batch`) is what actually pays out a Settled batch —
    // this is UserPosition.claimed, distinct from userHasVoted/userDeposited,
    // and is what "already claimed vs. still claimable" should key off.
    userWithdrawn: userClaimed,
    batchStartTime: Number(decoded.kickoff_timestamp) * 1000,
    participantCount: Number(decoded.participant_count ?? 0),
    minimumDeposit: 0, // no program-enforced minimum; see doc comment above
    voteWeights,
    winningVoteIndex,
    outcome,
    betTerms,
    createdAt,
    lobbyExpiresAt,
    rawStatus,
    winsCount: Number(decoded.wins_count ?? 0),
    lossesCount: Number(decoded.losses_count ?? 0),
    skipsCount: Number(decoded.skips_count ?? 0),
    accumulatedWinnings:
      Number(decoded.accumulated_winnings) / 10 ** SOLANA_CONFIG.TOKEN_DECIMALS,
  };
}

export async function fetchBatchOnChain(
  batchId: number,
  userAddress: string | null
): Promise<BatchState> {
  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );
  const batchPda = deriveBatchPda(batchId);

  const accountInfo = await connection.getAccountInfo(batchPda);
  if (!accountInfo) throw new Error(`Batch ${batchId} not found on-chain.`);
  if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) {
    throw new Error(`Batch ${batchId} discriminator mismatch.`);
  }

  const decoded = decodeBatchAccount(accountInfo.data.slice(8));

  let userDeposited = 0;
  let userHasVoted = false;
  let userVotedIndex: number | null = null;
  let userClaimed = false;
  if (userAddress) {
    const userPositionPda = deriveUserPositionPda(
      batchPda,
      new PublicKey(userAddress)
    );
    const posInfo = await connection.getAccountInfo(userPositionPda);
    if (posInfo && posInfo.data.length >= 8) {
      const pos = decodeUserPositionAccount(posInfo.data.slice(8));
      userDeposited =
        Number(pos.deposited_amount) / 10 ** SOLANA_CONFIG.TOKEN_DECIMALS;
      // A vote stamped with an earlier round than the batch's current
      // bets_completed is stale — it belongs to an already-settled bet
      // whose vote_weights were already zeroed out on-chain.
      userHasVoted =
        Boolean(pos.has_voted) &&
        Number(pos.voted_at_round) === Number(decoded.bets_completed);
      userVotedIndex = userHasVoted ? (pos.vote_index as number) : null;
      userClaimed = Boolean(pos.claimed);
    }
  }

  return buildBatchState(
    batchId,
    decoded,
    userDeposited,
    userHasVoted,
    userVotedIndex,
    userClaimed
  );
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
export async function fetchAllBatchesOnChain(
  batchIds: number[],
  userAddress: string | null
): Promise<BatchState[]> {
  if (batchIds.length === 0) return [];
  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );

  const batchPdas = batchIds.map((id) => deriveBatchPda(id));

  const CHUNK_SIZE = 100;
  const batchAccountInfos: (
    import("@solana/web3.js").AccountInfo<Buffer> | null
  )[] = [];
  for (let i = 0; i < batchPdas.length; i += CHUNK_SIZE) {
    const chunk = batchPdas.slice(i, i + CHUNK_SIZE);
    const infos = await connection.getMultipleAccountsInfo(chunk);
    batchAccountInfos.push(...infos);
  }

  const decodedByIndex: {
    batchId: number;
    batchPda: PublicKey;
    decoded: ReturnType<typeof decodeBatchAccount>;
  }[] = [];
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
  let userHasVotedByBatchId = new Map<number, boolean>();
  let userVotedIndexByBatchId = new Map<number, number | null>();
  let userClaimedByBatchId = new Map<number, boolean>();
  if (userAddress) {
    const user = new PublicKey(userAddress);
    const positionPdas = decodedByIndex.map(({ batchPda }) =>
      deriveUserPositionPda(batchPda, user)
    );
    const positionInfos: (
      import("@solana/web3.js").AccountInfo<Buffer> | null
    )[] = [];
    for (let i = 0; i < positionPdas.length; i += CHUNK_SIZE) {
      const chunk = positionPdas.slice(i, i + CHUNK_SIZE);
      const infos = await connection.getMultipleAccountsInfo(chunk);
      positionInfos.push(...infos);
    }
    decodedByIndex.forEach(({ batchId, decoded }, i) => {
      const posInfo = positionInfos[i];
      if (posInfo && posInfo.data.length >= 8) {
        const pos = decodeUserPositionAccount(posInfo.data.slice(8));
        // Stale-round check — see fetchBatchOnChain's identical comment.
        const hasVoted =
          Boolean(pos.has_voted) &&
          Number(pos.voted_at_round) === Number(decoded.bets_completed);
        userDepositedByBatchId.set(
          batchId,
          Number(pos.deposited_amount) / 10 ** SOLANA_CONFIG.TOKEN_DECIMALS
        );
        userHasVotedByBatchId.set(batchId, hasVoted);
        userVotedIndexByBatchId.set(
          batchId,
          hasVoted ? (pos.vote_index as number) : null
        );
        userClaimedByBatchId.set(batchId, Boolean(pos.claimed));
      }
    });
  }

  return decodedByIndex.map(({ batchId, decoded }) =>
    buildBatchState(
      batchId,
      decoded,
      userDepositedByBatchId.get(batchId) ?? 0,
      userHasVotedByBatchId.get(batchId) ?? false,
      userVotedIndexByBatchId.get(batchId) ?? null,
      userClaimedByBatchId.get(batchId) ?? false
    )
  );
}

// Mirrors the encoding in app/test/propose-match/page.tsx's getBetTermsBuffer,
// run in reverse: given a live TxOdds option, derive what its bet_terms would
// be if it were the one this slot proposed. Lets us recover a batch's real
// match/options straight from on-chain bet_terms when the Redis batch-mapping
// cache (written as a separate, non-atomic step by propose-match) is missing.
const STAT_KEY_PART1_GOALS = 1;
const STAT_KEY_PART2_GOALS = 2;
const CMP_GREATER_THAN = 0;
const CMP_LESS_THAN = 1;
const CMP_EQUAL_TO = 2;

function deriveBetTermFromOption(
  option: Option
): Omit<RawBetTerm, "fixtureId" | "period" | "negation"> | null {
  const { marketType, outcome, label } = option;

  if (marketType === "1X2_PARTICIPANT_RESULT") {
    let comparison: number;
    if (outcome === "part1") comparison = CMP_GREATER_THAN;
    else if (outcome === "part2") comparison = CMP_LESS_THAN;
    else if (outcome === "draw") comparison = CMP_EQUAL_TO;
    else return null;
    return {
      statAKey: STAT_KEY_PART1_GOALS,
      statBKey: STAT_KEY_PART2_GOALS,
      op: "Subtract",
      predicateThreshold: 0,
      predicateComparison: comparison,
    };
  }

  if (marketType === "OVERUNDER_PARTICIPANT_GOALS") {
    const match = label.match(/([\d.]+)/);
    if (!match) return null;
    const rawLine = parseFloat(match[0]);
    if (rawLine % 0.5 !== 0) return null;
    const isOver = outcome === "over";
    return {
      statAKey: STAT_KEY_PART1_GOALS,
      statBKey: STAT_KEY_PART2_GOALS,
      op: "Add",
      predicateThreshold: isOver ? Math.floor(rawLine) : Math.ceil(rawLine),
      predicateComparison: isOver ? CMP_GREATER_THAN : CMP_LESS_THAN,
    };
  }

  if (marketType === "ASIANHANDICAP_PARTICIPANT_GOALS") {
    const match = label.match(/Handicap ([+-]?\d+(\.\d+)?)/);
    if (!match) return null;
    const line = parseFloat(match[1]);
    if (line % 0.5 !== 0) return null;
    const isPart1 = outcome === "part1";
    return {
      statAKey: STAT_KEY_PART1_GOALS,
      statBKey: STAT_KEY_PART2_GOALS,
      op: "Subtract",
      predicateThreshold: isPart1 ? Math.floor(-line) : Math.ceil(-line),
      predicateComparison: isPart1 ? CMP_GREATER_THAN : CMP_LESS_THAN,
    };
  }

  return null;
}

// Slot index (0-3) -> the live TxOdds option that produced it, recovered by
// re-deriving each candidate's would-be bet term and comparing against what's
// actually stored on-chain for that slot.
function matchBetTermsToOptions(
  betTerms: RawBetTerm[],
  candidates: Option[]
): Map<number, Option> {
  const matches = new Map<number, Option>();
  betTerms.forEach((term, slotIndex) => {
    if (term.fixtureId <= 0) return; // unused slot
    const option = candidates.find((o) => {
      if (o.fixtureId !== term.fixtureId) return false;
      if ((o.period ?? 0) !== term.period) return false;
      if (term.negation) return false; // derive never produces a negated term, so it can't match one
      const derived = deriveBetTermFromOption(o);
      return (
        !!derived &&
        derived.statAKey === term.statAKey &&
        derived.statBKey === term.statBKey &&
        derived.op === term.op &&
        derived.predicateThreshold === term.predicateThreshold &&
        derived.predicateComparison === term.predicateComparison
      );
    });
    if (option) matches.set(slotIndex, option);
  });
  return matches;
}

// The default /api/txodds fetch (no query params) only returns fixtures
// starting before next batch-end — a match already underway falls outside
// that window and simply won't be in whatever's already loaded. Mirrors
// test/cast-vote's pattern of always re-fetching with all=1 (no start-time
// upper bound) rather than trusting a possibly-stale/filtered options list.
async function getFixtureCandidates(
  fixtureId: number,
  preloaded: Option[]
): Promise<Option[]> {
  const preloadedMatch = preloaded.filter((o) => o.fixtureId === fixtureId);
  if (preloadedMatch.length > 0) return preloadedMatch;

  try {
    const [allRes, pastRes] = await Promise.all([
      fetch("/api/txodds?all=1"),
      fetch("/api/txodds?past=1"),
    ]);
    const allData = allRes.ok ? await allRes.json() : {};
    const pastData = pastRes.ok ? await pastRes.json() : {};
    const freshOptions: Option[] = [
      ...(allData.options || []),
      ...(pastData.options || []),
    ];
    return freshOptions.filter((o) => o.fixtureId === fixtureId);
  } catch {
    return [];
  }
}

// Mirrors test/cast-vote's statName/predicateText — turns a raw bet_terms
// slot into a plain-English sentence ("Argentina goals > 0 (Full Time)")
// using real participant names when known, without needing a matched option.
function statName(key: number, team1: string, team2: string): string {
  const baseKey = key % 1000;
  const team = baseKey % 2 === 1 ? team1 : team2;

  let statType = "";
  switch (baseKey) {
    case 1:
    case 2:
      statType = "Goals";
      break;
    case 3:
    case 4:
      statType = "Yellow Cards";
      break;
    case 5:
    case 6:
      statType = "Red Cards";
      break;
    case 7:
    case 8:
      statType = "Corners";
      break;
    default:
      statType = `Stat ${baseKey}`;
  }

  return `${team} ${statType}`;
}

function describeBetTerm(
  term: RawBetTerm,
  team1: string,
  team2: string
): string {
  let periodStr = "";
  switch (term.period) {
    case 0:
      periodStr = "Full Time";
      break;
    case 1000:
      periodStr = "1st Half";
      break;
    case 2000:
      periodStr = "Halftime";
      break;
    case 3000:
      periodStr = "2nd Half";
      break;
    case 4000:
      periodStr = "ET1";
      break;
    case 5000:
      periodStr = "ET2";
      break;
    case 6000:
      periodStr = "Penalty Shootout";
      break;
    case 7000:
      periodStr = "ETTotal";
      break;
    default:
      periodStr = `Period ${term.period}`;
  }
  const compSymbol =
    term.predicateComparison === 0
      ? ">"
      : term.predicateComparison === 1
        ? "<"
        : "==";
  const expr =
    term.op && term.statBKey != null
      ? `(${statName(term.statAKey, team1, team2)} ${term.op === "Add" ? "+" : "-"} ${statName(term.statBKey, team1, team2)})`
      : statName(term.statAKey, team1, team2);
  let predicate = `${expr} ${compSymbol} ${term.predicateThreshold}`;
  if (term.negation) predicate = `NOT (${predicate})`;
  return `${predicate} (${periodStr})`;
}

export interface BetTermProposal {
  slotIndex: number;
  term: RawBetTerm;
  matchText: string;
  kickoff: string;
  // Raw kickoff timestamp (ms) — null when the fixture didn't resolve.
  // Lets the UI render a live countdown instead of just the formatted string.
  kickoffTime: number | null;
  predicate: string;
  multiplier: string;
  oddsLabel: string;
}

// Shape written by propose-match to Redis's slotsMapping. The messageId/ts/
// outcomeIndex identity is always present (older writes have only this);
// the readable fields are optional since they were only added later — any
// mapping written before that stays a valid, if unresolved, degrade path.
interface StoredSlotMapping {
  messageId: string;
  ts: number;
  outcomeIndex: number;
  participant1?: string;
  participant2?: string;
  startTime?: number;
  label?: string;
  odds?: number;
}

// Reconstructs an Option straight from what propose_match captured, for when
// the live TxOdds feed no longer has this fixture (already started, or aged
// out of the dev API's window) so key-matching against it can't succeed.
function optionFromStoredSlot(
  slot: StoredSlotMapping,
  fixtureId: number
): Option | null {
  if (!slot.participant1 || !slot.participant2 || !slot.startTime) return null;
  return {
    id: slot.messageId,
    fixtureId,
    participant1: slot.participant1,
    participant2: slot.participant2,
    odds: slot.odds ?? 0,
    startTime: slot.startTime,
    label: slot.label ?? `${slot.participant1} vs ${slot.participant2}`,
    messageId: slot.messageId,
    ts: slot.ts,
    outcomeIndex: slot.outcomeIndex,
  };
}

/**
 * Human-readable summary of every non-empty bet_terms slot on a batch,
 * mirroring test/cast-vote's proposalsList: real participant names + kickoff
 * time when the fixture is found in TxOdds, real odds/label when the exact
 * bet_terms slot matches a live option, and a plain predicate sentence
 * (from the raw on-chain fields alone) otherwise — so a proposal is never
 * shown as bare numbers just because odds matching didn't resolve.
 */
export async function describeBatchBetTerms(
  batchState: BatchState,
  preloadedOptions: Option[]
): Promise<BetTermProposal[]> {
  const proposals: BetTermProposal[] = [];

  // Fetch Redis mapping for this batch
  let slotsMapping: Record<string, StoredSlotMapping> = {};
  try {
    const mapRes = await fetch(
      `/api/batch-mapping?batchId=${batchState.batchId}`
    );
    if (mapRes.ok) {
      const mapData = await mapRes.json();
      slotsMapping = mapData.slotsMapping || {};
    }
  } catch (err) {
    console.error("Failed to fetch batch-mapping from Redis:", err);
  }

  for (let slotIndex = 0; slotIndex < batchState.betTerms.length; slotIndex++) {
    const term = batchState.betTerms[slotIndex];
    if (term.fixtureId <= 0) continue;

    const candidates = await getFixtureCandidates(
      term.fixtureId,
      preloadedOptions
    );
    const first = candidates[0] as Option | undefined;
    // The live TxOdds candidate lookup fails once a fixture ages out of the
    // feed (already started, or simply no longer returned) — fall back to
    // what propose_match captured at proposal time so team names/kickoff
    // still render instead of "Fixture <id>".
    const storedSlot = slotsMapping[slotIndex];
    const team1 = first?.participant1 ?? storedSlot?.participant1 ?? "Team 1";
    const team2 = first?.participant2 ?? storedSlot?.participant2 ?? "Team 2";
    const kickoffTimeMs = first?.startTime ?? storedSlot?.startTime ?? null;

    let multiplier = "—";
    let oddsLabel = storedSlot?.label ?? "";
    const matched = matchBetTermsToOptions([term], candidates).get(0);
    if (matched) {
      oddsLabel = matched.label;
    }

    // Now get the exact multiplier from validation endpoint using Redis messageId/ts if available
    const slotData = slotsMapping[slotIndex];
    if (slotData && slotData.messageId && slotData.ts !== undefined) {
      try {
        const valRes = await fetch(
          `/api/odds/validation?messageId=${encodeURIComponent(slotData.messageId)}&ts=${slotData.ts}`
        );
        if (valRes.ok) {
          const valData = await valRes.json();
          const odds = valData.odds;
          const prices = odds?.Prices ?? odds?.prices;
          if (prices) {
            const price = prices[slotData.outcomeIndex];
            if (price !== undefined) {
              const calculatedOdds = Number(price) / 1000;
              multiplier = `${calculatedOdds.toFixed(2)}x`;
            }
          }
        }
      } catch (err) {
        console.error(
          `Failed to fetch validation odds for slot ${slotIndex}:`,
          err
        );
      }
    }

    // Fall back to matched candidate's odds, then the stored proposal-time
    // odds, if the live validation lookup wasn't resolved.
    if (multiplier === "—" && matched) {
      multiplier = `${matched.odds.toFixed(2)}x`;
    } else if (multiplier === "—" && storedSlot?.odds) {
      multiplier = `${storedSlot.odds.toFixed(2)}x`;
    }

    // Temporary trace — remove once odds-matching is confirmed working live.
    // Shows exactly why a slot did/didn't resolve to a live option.
    console.debug(`[describeBatchBetTerms] slot ${slotIndex}`, {
      term,
      candidateCount: candidates.length,
      candidates: candidates.map((o) => ({
        id: o.id,
        marketType: o.marketType,
        outcome: o.outcome,
        period: o.period,
        label: o.label,
        odds: o.odds,
        derived: deriveBetTermFromOption(o),
      })),
      matchedOptionId: matched?.id ?? null,
      validationMultiplier: multiplier,
    });

    proposals.push({
      slotIndex,
      term,
      matchText:
        kickoffTimeMs != null
          ? `${team1} vs ${team2}`
          : `Fixture ${term.fixtureId}`,
      kickoff:
        kickoffTimeMs != null ? new Date(kickoffTimeMs).toLocaleString() : "",
      kickoffTime: kickoffTimeMs,
      predicate: describeBetTerm(term, team1, team2),
      multiplier,
      oddsLabel,
    });
  }

  return proposals;
}

/**
 * Resolve a UI (fixtureId, optionId) pair to the batch's on-chain vote index
 * (0-3 = a bet_terms slot, 4 = skip). Tries the Redis mapping propose-match
 * saved first (cheap, already-labeled); falls back to re-deriving the mapping
 * straight from the batch's real bet_terms if that cache is missing.
 */
export async function resolveVoteIndex(
  batchId: number,
  fixtureId: number,
  optionId: string,
  batchState?: BatchState,
  allOptions?: Option[]
): Promise<number> {
  if (optionId === `${fixtureId}-skip`) return 4;

  const res = await fetch(`/api/batch-mapping?batchId=${batchId}`);
  if (res.ok) {
    const mapping = await res.json();
    const slotsMapping: Record<
      string,
      { messageId: string; outcomeIndex: number }
    > = mapping.slotsMapping || {};
    // Redis stores each slot by (messageId, outcomeIndex) — the raw TxOdds
    // identity — not by Option.id (fixtureId-marketType-params-outcome-period),
    // so look candidates up by that same key before comparing to optionId.
    const optionsByKey = new Map(
      (allOptions ?? []).map((o) => [`${o.messageId}-${o.outcomeIndex}`, o])
    );
    for (const [indexStr, slot] of Object.entries(slotsMapping)) {
      const option = optionsByKey.get(`${slot.messageId}-${slot.outcomeIndex}`);
      if (option && option.id === optionId) return Number(indexStr);
    }
  }

  if (batchState) {
    const candidates = await getFixtureCandidates(fixtureId, allOptions ?? []);
    const matches = matchBetTermsToOptions(batchState.betTerms, candidates);
    for (const [slotIndex, option] of matches) {
      if (option.id === optionId) return slotIndex;
    }
  }

  throw new Error("Could not resolve this option to an on-chain vote slot.");
}

/**
 * The inverse of resolveVoteIndex: given a batch's already-fetched on-chain
 * state and the full /api/txodds option catalog, reconstruct the single real
 * match this batch proposed — its options, real vote_weights as tallies, and
 * the real decided outcome (if winning_vote_index has been set). Tries the
 * Redis batch-mapping cache first; if it's missing (propose-match's Redis
 * write is a separate, non-atomic step from the on-chain propose_match tx, so
 * it can be absent even when bet_terms is real), falls back to matching the
 * batch's on-chain bet_terms directly against live /api/txodds options.
 * Returns nulls only if nothing's been proposed for this batch at all yet.
 */
export async function fetchLiveMatchForBatch(
  batchId: number,
  batchState: BatchState,
  allOptions: Option[]
): Promise<{
  fixture: Fixture | null;
  votes: Record<string, number>;
  decision: VoteResult | null;
}> {
  const res = await fetch(`/api/batch-mapping?batchId=${batchId}`);
  let resolvedSlots: { slotIndex: number; option: Option }[] = [];
  let slotsMapping: Record<string, StoredSlotMapping> = {};

  if (res.ok) {
    const mapping = await res.json();
    slotsMapping = mapping.slotsMapping || {};
    // Same (messageId, outcomeIndex) keying as resolveVoteIndex — this is the
    // raw TxOdds identity slotsMapping was written with, not Option.id.
    const optionsByKey = new Map(
      allOptions.map((o) => [`${o.messageId}-${o.outcomeIndex}`, o])
    );
    for (const [indexStr, slot] of Object.entries(slotsMapping)) {
      // Prefer the live TxOdds option (fresher odds) but fall back to the
      // readable fields captured at propose_match time — the fixture can
      // age out of TxOdds's live/historical windows entirely (already
      // started, or simply no longer returned by the feed), which would
      // otherwise leave this slot unresolved and the UI showing a bare
      // "Fixture <id>" instead of real team names.
      const option =
        optionsByKey.get(`${slot.messageId}-${slot.outcomeIndex}`) ??
        optionFromStoredSlot(slot, mapping.fixtureId);
      if (option) resolvedSlots.push({ slotIndex: Number(indexStr), option });
    }
  }

  if (resolvedSlots.length === 0) {
    // Redis cache missing/empty — fall back to the batch's real bet_terms.
    const fixtureId = batchState.betTerms.find(
      (t) => t.fixtureId > 0
    )?.fixtureId;
    if (fixtureId) {
      const candidates = await getFixtureCandidates(fixtureId, allOptions);
      const matches = matchBetTermsToOptions(batchState.betTerms, candidates);
      resolvedSlots = Array.from(matches, ([slotIndex, option]) => ({
        slotIndex,
        option,
      }));
    }
  }

  // Load precise proposed odds from validation archive for each resolved slot
  for (const slot of resolvedSlots) {
    const slotData = slotsMapping[slot.slotIndex];
    if (slotData && slotData.messageId && slotData.ts !== undefined) {
      try {
        const valRes = await fetch(
          `/api/odds/validation?messageId=${encodeURIComponent(slotData.messageId)}&ts=${slotData.ts}`
        );
        if (valRes.ok) {
          const valData = await valRes.json();
          const odds = valData.odds;
          const prices = odds?.Prices ?? odds?.prices;
          if (prices) {
            const price = prices[slotData.outcomeIndex];
            if (price !== undefined) {
              slot.option.odds = Number(price) / 1000;
            }
          }
        }
      } catch (err) {
        console.error(
          `Failed to fetch validation odds for slot ${slot.slotIndex}:`,
          err
        );
      }
    }
  }

  resolvedSlots.sort((a, b) => a.slotIndex - b.slotIndex);

  if (resolvedSlots.length === 0) {
    return { fixture: null, votes: {}, decision: null };
  }

  const fixtureId = resolvedSlots[0].option.fixtureId;
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
    const winner = resolvedSlots.find(
      (s) => s.slotIndex === batchState.winningVoteIndex
    );
    decision = {
      fixtureId,
      winningOptionId: isSkip
        ? `${fixtureId}-skip`
        : (winner?.option.id ?? null),
      isSkip,
      accepted: !isSkip,
      won: batchState.outcome === true,
    };
  }

  return { fixture, votes, decision };
}

/**
 * Deposit USDC into a batch (real `join_batch` instruction, user-signed).
 * Assumes the shared yield vault has already been initialized by the
 * operator out-of-band — the frontend never signs on the operator's behalf.
 */
export async function joinBatchOnChain(
  batchId: number,
  amount: number,
  wallet: WalletLike
): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );

  const [vaultConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config"), USDC_MINT.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );

  const batchPda = deriveBatchPda(batchId);
  const accountInfo = await connection.getAccountInfo(batchPda);
  if (!accountInfo) throw new Error("Batch account not found on-chain.");
  if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR))
    throw new Error("Batch not initialized.");

  const rawAmount = BigInt(
    Math.floor(amount * 10 ** SOLANA_CONFIG.TOKEN_DECIMALS)
  );
  const data = Buffer.concat([
    JOIN_BATCH_DISCRIMINATOR,
    writeUInt64LE(rawAmount),
  ]);

  const userTokenAccount = deriveAssociatedTokenAddress(user, USDC_MINT);
  const batchTokenAccount = deriveAssociatedTokenAddress(batchPda, USDC_MINT);
  const vaultTokenAccount = deriveAssociatedTokenAddress(
    vaultConfigPda,
    USDC_MINT
  );

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

  const ix = new TransactionInstruction({
    programId: UNDEGEN_PROGRAM_ID,
    keys,
    data,
  });
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
export async function leaveBatchOnChain(
  batchId: number,
  amount: number,
  wallet: WalletLike
): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );

  const [vaultConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config"), USDC_MINT.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );

  const batchPda = deriveBatchPda(batchId);
  const accountInfo = await connection.getAccountInfo(batchPda);
  if (!accountInfo) throw new Error("Batch account not found on-chain.");
  if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR))
    throw new Error("Batch not initialized.");

  const userTokenAccount = deriveAssociatedTokenAddress(user, USDC_MINT);
  const batchTokenAccount = deriveAssociatedTokenAddress(batchPda, USDC_MINT);
  const vaultTokenAccount = deriveAssociatedTokenAddress(
    vaultConfigPda,
    USDC_MINT
  );
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

  const rawAmount = BigInt(
    Math.floor(amount * 10 ** SOLANA_CONFIG.TOKEN_DECIMALS)
  );
  const data = Buffer.concat([
    LEAVE_BATCH_DISCRIMINATOR,
    writeUInt64LE(rawAmount),
  ]);

  const ix = new TransactionInstruction({
    programId: UNDEGEN_PROGRAM_ID,
    keys,
    data,
  });
  const tx = new Transaction().add(ix);

  return signAndSend(connection, tx, user, wallet);
}

/**
 * Claim a Settled batch's full payout — principal plus this user's
 * proportional share of the batch's accumulated winnings, both paid out in
 * one transaction (real `claim` instruction, user-signed). Only valid once
 * `batch.status == Settled`; `leave_batch`/`withdraw` is Lobby-only and will
 * revert for an Ended batch. Ported from
 * programs/undegen_core/src/instructions/claim.rs's account list — no
 * amount argument, it always pays out this user's whole position and marks
 * it claimed (a second call reverts with AlreadyClaimed).
 */
export async function claimOnChain(
  batchId: number,
  wallet: WalletLike
): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );

  const [vaultConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config"), USDC_MINT.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );

  const batchPda = deriveBatchPda(batchId);
  const accountInfo = await connection.getAccountInfo(batchPda);
  if (!accountInfo) throw new Error("Batch account not found on-chain.");
  if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR))
    throw new Error("Batch not initialized.");

  const userTokenAccount = deriveAssociatedTokenAddress(user, USDC_MINT);
  const batchTokenAccount = deriveAssociatedTokenAddress(batchPda, USDC_MINT);
  const vaultTokenAccount = deriveAssociatedTokenAddress(
    vaultConfigPda,
    USDC_MINT
  );
  const [vaultPositionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), vaultConfigPda.toBuffer(), batchPda.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );
  const userPositionPda = deriveUserPositionPda(batchPda, user);

  // Account order must match Claim's #[derive(Accounts)] field order exactly
  // (Anchor accounts are positional) — note user_position comes right after
  // batch here, unlike leave_batch where it's near the end.
  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: batchPda, isSigner: false, isWritable: true },
    { pubkey: userPositionPda, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: batchTokenAccount, isSigner: false, isWritable: true },
    { pubkey: vaultConfigPda, isSigner: false, isWritable: true },
    { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: vaultPositionPda, isSigner: false, isWritable: true },
    { pubkey: YIELD_VAULT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: UNDEGEN_PROGRAM_ID,
    keys,
    data: CLAIM_DISCRIMINATOR,
  });
  const tx = new Transaction().add(ix);

  return signAndSend(connection, tx, user, wallet);
}

/**
 * Same payout as `claim`, except the "reward" leg (this user's share of the
 * batch's accumulated winnings) is wagered straight into the lottery's
 * currently open round instead of landing in their wallet — principal is
 * still always claimed to the wallet. Real `claim_and_join_lottery`
 * instruction (undegen_core), user-signed; reverts if there's no Open
 * round (call fetchActiveLotteryRound first to check). Ported from
 * programs/undegen_core/src/instructions/claim_and_join_lottery.rs's
 * account list.
 */
export async function claimAndJoinLotteryOnChain(
  batchId: number,
  wallet: WalletLike
): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );

  const activeRound = await fetchActiveLotteryRound();
  if (!activeRound) throw new Error("No open lottery round to join right now.");

  const [vaultConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config"), USDC_MINT.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );

  const batchPda = deriveBatchPda(batchId);
  const accountInfo = await connection.getAccountInfo(batchPda);
  if (!accountInfo) throw new Error("Batch account not found on-chain.");
  if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR))
    throw new Error("Batch not initialized.");

  const userTokenAccount = deriveAssociatedTokenAddress(user, USDC_MINT);
  const batchTokenAccount = deriveAssociatedTokenAddress(batchPda, USDC_MINT);
  const vaultTokenAccount = deriveAssociatedTokenAddress(
    vaultConfigPda,
    USDC_MINT
  );
  const [vaultPositionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), vaultConfigPda.toBuffer(), batchPda.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );
  const userPositionPda = deriveUserPositionPda(batchPda, user);

  const lotteryRoundPda = new PublicKey(activeRound.roundPda);
  const lotteryJackpotTokenAccount = new PublicKey(
    activeRound.jackpotTokenAccount
  );
  const lotteryEntryPda = deriveLotteryEntryPda(lotteryRoundPda, user);

  // Account order must match ClaimAndJoinLottery's #[derive(Accounts)] field
  // order exactly (Anchor accounts are positional).
  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: batchPda, isSigner: false, isWritable: true },
    { pubkey: userPositionPda, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: batchTokenAccount, isSigner: false, isWritable: true },
    { pubkey: vaultConfigPda, isSigner: false, isWritable: true },
    { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: vaultPositionPda, isSigner: false, isWritable: true },
    { pubkey: lotteryRoundPda, isSigner: false, isWritable: true },
    { pubkey: lotteryJackpotTokenAccount, isSigner: false, isWritable: true },
    { pubkey: lotteryEntryPda, isSigner: false, isWritable: true },
    { pubkey: YIELD_VAULT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: LOTTERY_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: UNDEGEN_PROGRAM_ID,
    keys,
    data: CLAIM_AND_JOIN_LOTTERY_DISCRIMINATOR,
  });
  const tx = new Transaction().add(ix);

  return signAndSend(connection, tx, user, wallet);
}

// yield_vault's own account layouts (programs/yield_vault/src/state.rs) —
// small enough to decode directly rather than pulling in the whole program's
// IDL just for a read-only preview.
const VaultConfigLayout = borsh.struct([
  borsh.publicKey("admin"),
  borsh.publicKey("mint"),
  borsh.publicKey("vault_token_account"),
  borsh.publicKey("reserve_token_account"),
  borsh.u64("total_shares"),
  borsh.u64("total_underlying"),
  borsh.u8("bump"),
]);

const VaultPositionLayout = borsh.struct([
  borsh.publicKey("owner"),
  borsh.publicKey("vault"),
  borsh.u64("shares"),
  borsh.u8("bump"),
]);

/**
 * Client-side replica of claim.rs's actual payout math, using the same live
 * on-chain balances it reads (the yield_vault's real shares/underlying
 * exchange rate, and the batch_token_account's real USDC balance) — not
 * BatchState's apyBps/betSize-derived estimates, which describe *planned*
 * capital, not what's actually sitting in these accounts by the time a user
 * claims. Returns null if there's nothing to preview (no deposit here, or
 * the position/vault accounts don't exist yet).
 */
export async function previewClaimAmount(
  batchId: number,
  userAddress: string
): Promise<{ principal: number; earnings: number; total: number } | null> {
  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );
  const user = new PublicKey(userAddress);
  const batchPda = deriveBatchPda(batchId);

  const [vaultConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config"), USDC_MINT.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );
  const [vaultPositionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), vaultConfigPda.toBuffer(), batchPda.toBuffer()],
    YIELD_VAULT_PROGRAM_ID
  );
  const userPositionPda = deriveUserPositionPda(batchPda, user);
  const batchTokenAccount = deriveAssociatedTokenAddress(batchPda, USDC_MINT);

  const [batchInfo, vaultConfigInfo, vaultPositionInfo, userPositionInfo] =
    await connection.getMultipleAccountsInfo([
      batchPda,
      vaultConfigPda,
      vaultPositionPda,
      userPositionPda,
    ]);

  if (!batchInfo || !userPositionInfo) return null;
  if (!batchInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) return null;

  const decodedBatch = decodeBatchAccount(batchInfo.data.slice(8));
  const pos = decodeUserPositionAccount(userPositionInfo.data.slice(8));

  const userDeposited = BigInt(pos.deposited_amount.toString());
  const totalDeposited = BigInt(decodedBatch.total_deposited.toString());
  if (userDeposited <= BigInt(0) || totalDeposited <= BigInt(0)) return null;

  // Step 1 (mirrors claim.rs): this user's share of the vault position,
  // converted to underlying at the vault's current exchange rate, capped at
  // their original deposit — same `.min(user_deposited)` claim.rs applies.
  let withdrawUnderlying = BigInt(0);
  if (vaultConfigInfo && vaultPositionInfo) {
    const vaultState = VaultConfigLayout.decode(vaultConfigInfo.data.slice(8));
    const positionState = VaultPositionLayout.decode(
      vaultPositionInfo.data.slice(8)
    );
    const totalShares = BigInt(vaultState.total_shares.toString());
    const totalUnderlying = BigInt(vaultState.total_underlying.toString());
    const positionShares = BigInt(positionState.shares.toString());
    if (totalShares > BigInt(0) && totalUnderlying > BigInt(0)) {
      const userShares = (positionShares * userDeposited) / totalDeposited;
      const userUnderlying = (userShares * totalUnderlying) / totalShares;
      withdrawUnderlying =
        userUnderlying < userDeposited ? userUnderlying : userDeposited;
    }
  }

  // Step 2 (mirrors claim.rs): this user's proportional share of whatever
  // real USDC balance the batch is currently holding — the batch's actual
  // settled winnings/leftover capital, not a derived estimate of it.
  let userBatchShare = BigInt(0);
  try {
    const balanceRes =
      await connection.getTokenAccountBalance(batchTokenAccount);
    const batchBalance = BigInt(balanceRes.value.amount);
    if (batchBalance > BigInt(0)) {
      userBatchShare = (batchBalance * userDeposited) / totalDeposited;
    }
  } catch {
    // batch_token_account doesn't exist yet (init_if_needed, never funded) — nothing to share.
  }

  const decimals = 10 ** SOLANA_CONFIG.TOKEN_DECIMALS;
  const principal = Number(withdrawUnderlying) / decimals;
  const earnings = Number(userBatchShare) / decimals;
  return { principal, earnings, total: principal + earnings };
}

/**
 * Cast a consensus vote (real `cast_vote` instruction, user-signed).
 * `index` is 0-3 for a proposed bet_terms slot, or 4 to skip.
 */
export async function castVoteOnChain(
  batchId: number,
  index: number,
  wallet: WalletLike
): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );
  const batchPda = deriveBatchPda(batchId);

  const accountInfo = await connection.getAccountInfo(batchPda);
  if (
    !accountInfo ||
    !accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)
  ) {
    throw new Error("Batch not found or not initialized.");
  }

  const userPositionPda = deriveUserPositionPda(batchPda, user);

  const data = Buffer.concat([CAST_VOTE_DISCRIMINATOR, Buffer.from([index])]);
  const keys = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: batchPda, isSigner: false, isWritable: true },
    { pubkey: userPositionPda, isSigner: false, isWritable: true },
  ];

  const ix = new TransactionInstruction({
    programId: UNDEGEN_PROGRAM_ID,
    keys,
    data,
  });
  const tx = new Transaction().add(ix);

  return signAndSend(connection, tx, user, wallet);
}

/**
 * Settle a batch's current bet as a default user-win (real `settle_default`
 * instruction) — callable by anyone once the operator has gone silent past
 * the proof deadline; no signer account required by the instruction itself,
 * the connected wallet only pays the tx fee.
 */
export async function settleDefaultOnChain(
  batchId: number,
  wallet: WalletLike
): Promise<string> {
  const address = wallet.account?.address;
  if (!address) throw new Error("Wallet not connected.");
  const user = new PublicKey(address);

  const connection = new Connection(
    SOLANA_CONFIG.RPC_URL,
    SOLANA_CONFIG.COMMITMENT
  );
  const batchPda = deriveBatchPda(batchId);

  const accountInfo = await connection.getAccountInfo(batchPda);
  if (
    !accountInfo ||
    !accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)
  ) {
    throw new Error("Batch not found or not initialized.");
  }

  const collateralTokenAccount = deriveCollateralPda(batchPda);
  const batchTokenAccount = deriveAssociatedTokenAddress(batchPda, USDC_MINT);

  const keys = [
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: batchPda, isSigner: false, isWritable: true },
    { pubkey: collateralTokenAccount, isSigner: false, isWritable: true },
    { pubkey: batchTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: UNDEGEN_PROGRAM_ID,
    keys,
    data: SETTLE_DEFAULT_DISCRIMINATOR,
  });
  const tx = new Transaction().add(ix);

  return signAndSend(connection, tx, user, wallet);
}
