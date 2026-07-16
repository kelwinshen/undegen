"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Connection, PublicKey } from "@solana/web3.js";
import * as borsh from "@coral-xyz/borsh";
import Header from "@/app/components/live/Header";

const UNDEGEN_PROGRAM_ID_STR = "4KdYywAokwbLWNZ6XFtr6boho1JprUTuhYsoGuu4dVRY";
const DEVNET_RPC = "https://api.devnet.solana.com";

const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);

type LogEntry = {
  time: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
};

// --- NEW LAYOUT (327 Bytes) ---
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

// --- OLD LAYOUT FALLBACK (319 Bytes) ---
const OldBetTermLayout = borsh.struct([
  borsh.i64("fixture_id"),
  borsh.u16("period"),
  borsh.u32("stat_a_key"),
  borsh.option(borsh.u32(), "stat_b_key"),
  // Note: No `op` field here
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

const BATCH_STATUS_NAMES = ["Lobby", "Locked", "AwaitingCollateral", "Active", "Settled", "Cancelled"];

const COMPARISON = { GreaterThan: 0, LessThan: 1, EqualTo: 2 };
const STAT_KEY_PART1_GOALS = 1002;
const STAT_KEY_PART2_GOALS = 1003;

type OddsInfo = { matchText: string; multiplier: string; oddsLabel: string };

// Mirrors test/cast-vote's getBetTermsFromOdds — reconstructs the on-chain
// predicate a TxODDS option would produce, so it can be matched against a
// decoded bet_terms slot to resolve the odds multiplier for that slot.
function getBetTermsFromOdds(option: any) {
  const type = option.marketType;
  const outcome = option.outcome;
  const period = option.period ?? 0;

  if (type === "1X2_PARTICIPANT_RESULT") {
    let comparison = COMPARISON.GreaterThan;
    if (outcome === "part1") comparison = COMPARISON.GreaterThan;
    else if (outcome === "part2") comparison = COMPARISON.LessThan;
    else if (outcome === "draw") comparison = COMPARISON.EqualTo;

    return {
      fixture_id: BigInt(option.fixtureId),
      period,
      stat_a_key: STAT_KEY_PART1_GOALS,
      stat_b_key: STAT_KEY_PART2_GOALS,
      op: null as string | null,
      predicate_threshold: 0,
      predicate_comparison: comparison,
      negation: false,
    };
  }

  if (type === "OVERUNDER_PARTICIPANT_GOALS") {
    const match = option.label.match(/([\d.]+)/);
    if (match) {
      const rawLine = parseFloat(match[0]);
      if (rawLine % 0.5 !== 0) return null;

      const isOver = outcome === "over";
      const comparison = isOver ? COMPARISON.GreaterThan : COMPARISON.LessThan;
      const threshold = isOver ? Math.floor(rawLine) : Math.ceil(rawLine);

      return {
        fixture_id: BigInt(option.fixtureId),
        period,
        stat_a_key: 1004,
        stat_b_key: null as number | null,
        op: null as string | null,
        predicate_threshold: threshold,
        predicate_comparison: comparison,
        negation: false,
      };
    }
  }

  if (type === "ASIANHANDICAP_PARTICIPANT_GOALS") {
    const match = option.label.match(/Handicap ([+-]?\d+(\.\d+)?)/);
    if (!match) return null;

    const line = parseFloat(match[1]);
    if (line % 0.5 !== 0) return null;

    let comparison: number;
    let threshold: number;

    if (outcome === "part1") {
      threshold = Math.floor(-line);
      comparison = COMPARISON.GreaterThan;
    } else {
      threshold = Math.ceil(-line);
      comparison = COMPARISON.LessThan;
    }

    return {
      fixture_id: BigInt(option.fixtureId),
      period,
      stat_a_key: STAT_KEY_PART1_GOALS,
      stat_b_key: STAT_KEY_PART2_GOALS,
      op: "Subtract" as string | null,
      predicate_threshold: threshold,
      predicate_comparison: comparison,
      negation: false,
    };
  }

  return null;
}

// Compares a candidate predicate (bigint/number fields, straight off
// getBetTermsFromOdds) against a decoded bet_terms slot — decodeBatch below
// stringifies fixture_id/stat_a_key/stat_b_key/predicate_threshold/negation
// for display, so both sides are normalized to strings here.
function rawTermsEqual(term: any, candidate: ReturnType<typeof getBetTermsFromOdds>): boolean {
  if (!term || !candidate) return false;
  return (
    term.fixture_id === candidate.fixture_id.toString() &&
    term.period === candidate.period &&
    term.stat_a_key === candidate.stat_a_key.toString() &&
    (term.stat_b_key ?? null) === (candidate.stat_b_key !== null ? candidate.stat_b_key.toString() : null) &&
    (term.op ?? null) === candidate.op &&
    term.predicate_threshold === candidate.predicate_threshold.toString() &&
    term.predicate_comparison === candidate.predicate_comparison &&
    term.negation === candidate.negation.toString()
  );
}

function decodeBatch(data: Buffer): any {
  let decoded;
  
  // Dynamically route the decoder based on account size
  if (data.length === 319) {
    decoded = OldBatchLayout.decode(data);
  } else if (data.length === 327) {
    decoded = BatchLayout.decode(data);
  } else {
    throw new Error(`Unexpected account data size: ${data.length} bytes. Expected 319 (old) or 327 (new).`);
  }

  return {
    ...decoded,
    batch_id: decoded.batch_id.toString(),
    operator: decoded.operator.toBase58(),
    mint: decoded.mint.toBase58(),
    vault_position: decoded.vault_position.toBase58(),
    status: BATCH_STATUS_NAMES[decoded.statusIdx] ?? `Unknown(${decoded.statusIdx})`,
    total_deposited: decoded.total_deposited.toString(),
    bet_size: decoded.bet_size.toString(),
    accumulated_winnings: decoded.accumulated_winnings.toString(),
    kickoff_timestamp: decoded.kickoff_timestamp.toString(),
    win_prize: decoded.win_prize.toString(),
    vote_weights: decoded.vote_weights.map((w: any) => w.toString()),
    collateral_required: decoded.collateral_required.toString(),
    collateral_deposited: decoded.collateral_deposited.toString(),
    proof_deadline: decoded.proof_deadline.toString(),
    bet_terms: decoded.bet_terms.map((term: any) => ({
      ...term,
      fixture_id: term.fixture_id.toString(),
      stat_a_key: term.stat_a_key.toString(),
      stat_b_key: term.stat_b_key ? term.stat_b_key.toString() : null,
      predicate_threshold: term.predicate_threshold.toString(),
      negation: term.negation.toString(),
      op: term.op ? Object.keys(term.op)[0] : null,
    })),
  };
}

export default function BatchDetailsTest() {
  const searchParams = useSearchParams();
  const initialBatchId = searchParams.get("batchId") || "";

  const [batchId, setBatchId] = useState(initialBatchId);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [batchData, setBatchData] = useState<any>(null);
  const [oddsInfo, setOddsInfo] = useState<Record<number, OddsInfo>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { time: Date.now(), type, message }]);
  };

  const handleFetch = async () => {
    setLogs([]);
    setBatchData(null);
    setOddsInfo({});
    const id = parseInt(batchId);
    if (isNaN(id) || id < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = new PublicKey(UNDEGEN_PROGRAM_ID_STR);

      const batchIdBuffer = Buffer.alloc(8);
      new DataView(batchIdBuffer.buffer).setBigUint64(0, BigInt(id), true);

      const [batchPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("batch"), batchIdBuffer],
        programId
      );
      addLog("info", `Batch PDA: ${batchPda.toBase58()}`);

      const accountInfo = await connection.getAccountInfo(batchPda);
      if (!accountInfo) {
        throw new Error("Batch account not found.");
      }
      if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) {
        throw new Error("Discriminator mismatch.");
      }

      const data = accountInfo.data.slice(8);
      addLog("info", `Raw data length without discriminator: ${data.length}`);

      const decoded = decodeBatch(data);
      setBatchData(decoded);

      addLog("success", `Batch decoded successfully via Borsh (${data.length === 319 ? "Old Layout" : "New Layout"}).`);

      try {
        // `all=1` only returns fixtures that haven't started yet (start >=
        // now); `past=1` does an aggressive 5-day lookback and still queries
        // each fixture's *current* odds snapshot. Together they cover a
        // proposed match whether it's still upcoming, already live, or
        // recently finished.
        const [allRes, pastRes] = await Promise.all([
          fetch("/api/txodds?all=1"),
          fetch("/api/txodds?past=1"),
        ]);
        const [allData, pastData] = await Promise.all([allRes.json(), pastRes.json()]);
        const options: any[] = [...(allData.options || []), ...(pastData.options || [])];

        // Redis batch-mapping already records exactly which TxOdds option
        // (messageId + outcomeIndex) each slot was proposed from — the same
        // (messageId, outcomeIndex) key used by resolveVoteIndex/
        // fetchLiveMatchForBatch in undegenProgram.ts. Looking that up
        // directly survives the odds line moving since propose time, unlike
        // re-deriving the predicate from current odds and comparing structurally.
        const optionsByKey = new Map(options.map((o: any) => [`${o.messageId}-${o.outcomeIndex}`, o]));
        const matchMap = new Map<number, { participant1: string; participant2: string }>();
        options.forEach((opt: any) => {
          if (!matchMap.has(opt.fixtureId)) {
            matchMap.set(opt.fixtureId, { participant1: opt.participant1, participant2: opt.participant2 });
          }
        });

        const mappingRes = await fetch(`/api/batch-mapping?batchId=${id}`);
        const slotsMapping: Record<string, { messageId: string; outcomeIndex: number }> = mappingRes.ok
          ? (await mappingRes.json()).slotsMapping || {}
          : {};
        if (!mappingRes.ok) {
          addLog("warning", "No Redis batch-mapping found for this batch — falling back to live odds matching.");
        }

        const info: Record<number, OddsInfo> = {};
        const unresolvedSlots: number[] = [];

        decoded.bet_terms.forEach((term: any, i: number) => {
          if (term.fixture_id === "0") return;
          const slot = slotsMapping[i];
          const matched = slot ? optionsByKey.get(`${slot.messageId}-${slot.outcomeIndex}`) : undefined;
          if (matched) {
            info[i] = {
              matchText: `${matched.participant1} vs ${matched.participant2}`,
              multiplier: matched.odds.toFixed(1) + "x",
              oddsLabel: matched.label,
            };
          } else {
            unresolvedSlots.push(i);
          }
        });

        // Fall back to structural predicate matching for any slot Redis
        // couldn't resolve (mapping missing, or the recorded messageId has
        // aged out of TxOdds's snapshot windows).
        for (const i of unresolvedSlots) {
          const term = decoded.bet_terms[i];
          const fixtureIdNum = Number(term.fixture_id);
          const match = matchMap.get(fixtureIdNum);
          const matchText = match ? `${match.participant1} vs ${match.participant2}` : `Fixture ${term.fixture_id}`;

          let multiplier = "—";
          let oddsLabel = "";
          const fixtureOptions = options.filter((o: any) => o.fixtureId === fixtureIdNum);
          for (const opt of fixtureOptions) {
            const candidate = getBetTermsFromOdds(opt);
            if (candidate && rawTermsEqual(term, candidate)) {
              multiplier = opt.odds.toFixed(1) + "x";
              oddsLabel = opt.label;
              break;
            }
          }

          info[i] = { matchText, multiplier, oddsLabel };
        }

        setOddsInfo(info);
      } catch (e: any) {
        addLog("warning", `Failed to resolve odds: ${e.message}`);
      }

      setResult({ type: "success", message: "Data fetched." });
    } catch (err: any) {
      addLog("error", err.message);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialBatchId) handleFetch();
  }, [initialBatchId]);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col gap-8 border-x border-border-low px-6 py-12">
        <Header />
        <Link href="/test" className="text-xs text-gray-400 hover:text-gray-200 -mb-4">
          ← Back to Test Hub
        </Link>
        <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-6">
          <h2 className="text-xl font-bold">Batch Details (Test)</h2>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Batch ID"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="flex-1 bg-bg1 border border-border-low rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400"
              disabled={loading}
            />
            <button
              onClick={handleFetch}
              disabled={loading}
              className="px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
            >
              {loading ? "Fetching..." : "Fetch"}
            </button>
          </div>
          {result && (
            <div className={`p-3 rounded-lg text-sm ${result.type === "success" ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border border-red-500/30 text-red-300"}`}>
              {result.message}
            </div>
          )}
          {batchData && (
            <div className="mt-4 bg-black/30 rounded-lg p-4 text-sm font-mono space-y-1">
              <h3 className="font-semibold text-white mb-2">Batch Fields</h3>
              {Object.entries(batchData).map(([key, value]) => {
                if (key === "bet_terms" && Array.isArray(value)) {
                  return (
                    <div key={key}>
                      <span className="text-gray-400">{key}:</span>
                      {value.map((terms: any, i: number) => (
                        <div key={i} className="ml-4 text-xs">
                          <span className="text-gray-500">[{i}] </span>
                          <span className="text-emerald-300">fixture: {terms.fixture_id}</span>
                          <span className="text-emerald-300">, period: {terms.period}</span>
                          {terms.stat_a_key !== "0" && (
                            <span className="text-emerald-300">, stat_a: {terms.stat_a_key}</span>
                          )}
                          {terms.stat_b_key && (
                            <span className="text-emerald-300">, stat_b: {terms.stat_b_key}</span>
                          )}
                          {terms.op && (
                            <span className="text-emerald-300">, op: {terms.op}</span>
                          )}
                          <span className="text-emerald-300">, thresh: {terms.predicate_threshold}</span>
                          <span className="text-emerald-300">, comp: {terms.predicate_comparison}</span>
                          <span className="text-emerald-300">, neg: {terms.negation}</span>
                          {oddsInfo[i] && (
                            <div className="ml-4 mt-0.5 flex items-center gap-2">
                              <span className="text-gray-400">{oddsInfo[i].matchText}</span>
                              {oddsInfo[i].oddsLabel && (
                                <span className="text-gray-400">— {oddsInfo[i].oddsLabel}</span>
                              )}
                              <span className="font-bold text-white">{oddsInfo[i].multiplier}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                }
                return (
                  <div key={key}>
                    <span className="text-gray-400">{key}:</span>{" "}
                    <span className="text-emerald-300">{String(value)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {logs.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2">Debug Log</h3>
              <div className="bg-black/30 rounded-lg p-4 max-h-64 overflow-y-auto space-y-1 text-xs font-mono">
                {logs.map((entry, i) => (
                  <div key={i} className={`${entry.type === "error" ? "text-red-400" : entry.type === "success" ? "text-emerald-300" : entry.type === "warning" ? "text-yellow-300" : "text-gray-300"}`}>
                    [{new Date(entry.time).toLocaleTimeString()}] {entry.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}