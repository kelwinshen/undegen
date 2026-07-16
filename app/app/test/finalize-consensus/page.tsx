"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";
import * as borsh from "@coral-xyz/borsh";
import Header from "@/app/components/live/Header";

const UNDEGEN_PROGRAM_ID_STR = "4KdYywAokwbLWNZ6XFtr6boho1JprUTuhYsoGuu4dVRY";
const DEVNET_RPC = "https://api.devnet.solana.com";

const FINALIZE_CONSENSUS_DISCRIMINATOR = Buffer.from([158, 21, 141, 117, 251, 129, 243, 22]);
const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);

type LogEntry = {
  time: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
};

// 1. Add the missing BinaryOpLayout
const BinaryOpLayout = borsh.rustEnum([
  borsh.struct([], "Add"),
  borsh.struct([], "Subtract"),
]);

// 2. Update BetTermLayout to include `op`
const BetTermLayout = borsh.struct([
  borsh.i64("fixture_id"),
  borsh.u16("period"),
  borsh.u32("stat_a_key"),
  borsh.option(borsh.u32(), "stat_b_key"),
  borsh.option(BinaryOpLayout, "op"), // <-- Added missing field
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
  borsh.array(BetTermLayout, 4, "bet_terms"), // <-- Uses updated layout
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

function writeUInt64LE(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  new DataView(buffer.buffer).setBigUint64(0, value, true);
  return buffer;
}

export default function FinalizeConsensusTest() {
  const [batchId, setBatchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [batchPda, setBatchPda] = useState<PublicKey | null>(null);
  const [batchStatus, setBatchStatus] = useState<string>("");
  const [winningVoteIndex, setWinningVoteIndex] = useState<number | null>(null);

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { time: Date.now(), type, message }]);
  };

  const getOperatorKeypair = (): Keypair => {
    const secretKeyEnv = process.env.NEXT_PUBLIC_OPERATOR_SECRET_KEY;
    if (!secretKeyEnv) throw new Error("NEXT_PUBLIC_OPERATOR_SECRET_KEY not set.");
    if (secretKeyEnv.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyEnv)));
    }
    return Keypair.fromSecretKey(bs58.decode(secretKeyEnv));
  };

  const sendTx = async (ix: TransactionInstruction): Promise<string> => {
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const signer = getOperatorKeypair();
    const tx = new Transaction().add(ix);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = signer.publicKey;
    tx.sign(signer);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(sig);
    return sig;
  };

  const handleFetch = async () => {
    setLogs([]);
    setBatchPda(null);
    setBatchStatus("");
    setWinningVoteIndex(null);
    setResult(null);

    const id = parseInt(batchId);
    if (isNaN(id) || id < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }

    setLoading(true);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = new PublicKey(UNDEGEN_PROGRAM_ID_STR);

      const batchIdBuffer = writeUInt64LE(BigInt(id));
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("batch"), batchIdBuffer],
        programId
      );

      const accountInfo = await connection.getAccountInfo(pda);
      if (!accountInfo || !accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) {
        throw new Error("Batch not found or not initialized.");
      }

      // 3. This will now successfully decode without byte-shift errors
      const batch = BatchLayout.decode(accountInfo.data.slice(8));
      const statusName = BATCH_STATUS_NAMES[batch.statusIdx] ?? "Unknown";
      setBatchPda(pda);
      setBatchStatus(statusName);
      setWinningVoteIndex(batch.winning_vote_index ?? null);

      addLog("info", `Batch status: ${statusName}`);
      addLog("info", `Winning vote index: ${batch.winning_vote_index ?? "none"}`);
      addLog("info", `Collateral required: ${batch.collateral_required.toString()}`);
      setResult({ type: "success", message: "Batch loaded." });
    } catch (err: any) {
      addLog("error", err.message);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleFinalize = async () => {
    if (!batchPda) {
      addLog("error", "Load a batch first.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const programId = new PublicKey(UNDEGEN_PROGRAM_ID_STR);

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: batchPda, isSigner: false, isWritable: true },
        ],
        data: FINALIZE_CONSENSUS_DISCRIMINATOR,
      });

      const sig = await sendTx(ix);
      addLog("success", `Consensus finalized. Tx: ${sig}`);
      setResult({ type: "success", message: `Consensus finalized. Tx: ${sig}` });
    } catch (err: any) {
      addLog("error", err.message);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col gap-8 border-x border-border-low px-6 py-12">
        <Header />
        <Link href="/test" className="text-xs text-gray-400 hover:text-gray-200 -mb-4">
          ← Back to Test Hub
        </Link>
        <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-6">
          <h2 className="text-xl font-bold">Finalize Consensus (Test)</h2>
          <p className="text-sm text-gray-400">
            Load a batch, check its status, and finalize the consensus. This triggers the
            determination of the winning vote index.
          </p>
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
              disabled={loading || !batchId}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-400 transition disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load Batch"}
            </button>
          </div>
          {batchStatus && (
            <div className="text-xs text-gray-400">
              Status: <span className="text-emerald-300">{batchStatus}</span>
              {winningVoteIndex !== null && (
                <> · Winning vote index: {winningVoteIndex}</>
              )}
            </div>
          )}
          <button
            onClick={handleFinalize}
            disabled={loading || !batchPda}
            className="w-full px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
          >
            {loading ? "Finalizing..." : "Finalize Consensus"}
          </button>
          {result && (
            <div
              className={`p-3 rounded-lg text-sm ${
                result.type === "success"
                  ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                  : "bg-red-500/10 border border-red-500/30 text-red-300"
              }`}
            >
              {result.message}
            </div>
          )}
          {logs.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2">Execution Log</h3>
              <div className="bg-black/30 rounded-lg p-4 max-h-64 overflow-y-auto space-y-1 text-xs font-mono">
                {logs.map((entry, i) => (
                  <div
                    key={i}
                    className={`${
                      entry.type === "error"
                        ? "text-red-400"
                        : entry.type === "success"
                        ? "text-emerald-300"
                        : entry.type === "warning"
                        ? "text-yellow-300"
                        : "text-gray-300"
                    }`}
                  >
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