"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Connection, PublicKey } from "@solana/web3.js";
import * as borsh from "@coral-xyz/borsh";
import Header from "@/app/components/Header";

import undegenCoreIdl from "@/app/lib/idl/undegen_core.json";

const UNDEGEN_PROGRAM_ID = new PublicKey(undegenCoreIdl.address);
const DEVNET_RPC = "https://api.devnet.solana.com";

const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);

type LogEntry = {
  time: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
};

// --- BATCH LAYOUT (Compliant with the latest IDL specs) ---
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
  borsh.u8("statusIdx"), // Maps to BatchStatus enum
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

const BATCH_STATUS_NAMES = [
  "Lobby",
  "Locked",
  "AwaitingCollateral",
  "Active",
  "Settled",
  "Cancelled",
];

function decodeBatch(data: Buffer): any {
  // Solana accounts have a fixed size allocated on-chain (e.g. from INIT_SPACE + padding).
  // Borsh will successfully decode up to the end of your defined struct layout and safely
  // ignore any trailing allocation headroom. We check for a minimum required bound instead.
  if (data.length < 327) {
    throw new Error(
      `Unexpected account data size: ${data.length} bytes. Expected at least 327 bytes based on the IDL layout.`
    );
  }

  const decoded = BatchLayout.decode(data);

  return {
    ...decoded,
    batch_id: decoded.batch_id.toString(),
    operator: decoded.operator.toBase58(),
    mint: decoded.mint.toBase58(),
    vault_position: decoded.vault_position.toBase58(),
    status:
      BATCH_STATUS_NAMES[decoded.statusIdx] ?? `Unknown(${decoded.statusIdx})`,
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
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [batchData, setBatchData] = useState<any>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { time: Date.now(), type, message }]);
  };

  const handleFetch = async () => {
    setLogs([]);
    setBatchData(null);
    const id = parseInt(batchId);
    if (isNaN(id) || id < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = UNDEGEN_PROGRAM_ID;

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

      addLog(
        "success",
        `Batch decoded successfully via Borsh (${data.length} bytes processed).`
      );
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
        <Link
          href="/test"
          className="text-xs text-gray-400 hover:text-gray-200 -mb-4"
        >
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
            <div
              className={`p-3 rounded-lg text-sm ${result.type === "success" ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border border-red-500/30 text-red-300"}`}
            >
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
                          <span className="text-emerald-300">
                            fixture: {terms.fixture_id}
                          </span>
                          <span className="text-emerald-300">
                            , period: {terms.period}
                          </span>
                          {terms.stat_a_key !== "0" && (
                            <span className="text-emerald-300">
                              , stat_a: {terms.stat_a_key}
                            </span>
                          )}
                          {terms.stat_b_key && (
                            <span className="text-emerald-300">
                              , stat_b: {terms.stat_b_key}
                            </span>
                          )}
                          {terms.op && (
                            <span className="text-emerald-300">
                              , op: {terms.op}
                            </span>
                          )}
                          <span className="text-emerald-300">
                            , thresh: {terms.predicate_threshold}
                          </span>
                          <span className="text-emerald-300">
                            , comp: {terms.predicate_comparison}
                          </span>
                          <span className="text-emerald-300">
                            , neg: {terms.negation}
                          </span>
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
                  <div
                    key={i}
                    className={`${entry.type === "error" ? "text-red-400" : entry.type === "success" ? "text-emerald-300" : entry.type === "warning" ? "text-yellow-300" : "text-gray-300"}`}
                  >
                    [{new Date(entry.time).toLocaleTimeString()}]{" "}
                    {entry.message}
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
