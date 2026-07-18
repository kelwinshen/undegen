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
import * as borsh from "@coral-xyz/borsh";
import bs58 from "bs58";
import Header from "@/app/components/Header";
import undegenCoreIdl from "@/app/lib/idl/undegen_core.json";

const UNDEGEN_PROGRAM_ID = new PublicKey(undegenCoreIdl.address);
const DEVNET_RPC = "https://api.devnet.solana.com";

const START_BATCH_DISCRIMINATOR = Buffer.from([147, 69, 236, 227, 64, 168, 57, 68]);
const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);
const PROTOCOL_CONFIG_DISCRIMINATOR = Buffer.from([207, 91, 250, 28, 152, 179, 215, 209]);

type LogEntry = {
  time: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
};

const BATCH_STATUS_NAMES = ["Lobby", "Locked", "AwaitingCollateral", "Active", "Settled", "Cancelled"];

const ProtocolConfigLayout = borsh.struct([
  borsh.publicKey("authority"),
  borsh.u64("next_batch_id"),
]);

const BetTermLayout = borsh.struct([
  borsh.i64("fixture_id"),
  borsh.u16("period"),
  borsh.u32("stat_a_key"),
  borsh.option(borsh.u32(), "stat_b_key"),
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

export default function StartBatchTest() {
  const [batchIdInput, setBatchIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [latestBatchId, setLatestBatchId] = useState<number | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);

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

  const fetchLatestBatchId = async () => {
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = UNDEGEN_PROGRAM_ID;
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("protocol_config")],
        programId
      );
      const info = await connection.getAccountInfo(configPda);
      
      if (info && info.data.slice(0, 8).equals(PROTOCOL_CONFIG_DISCRIMINATOR)) {
        const decodedConfig = ProtocolConfigLayout.decode(info.data.slice(8));
        const latestId = Number(decodedConfig.next_batch_id) - 1;
        
        if (latestId >= 0) {
          setLatestBatchId(latestId);
          setBatchIdInput(latestId.toString());

          const batchIdBuffer = Buffer.alloc(8);
          new DataView(batchIdBuffer.buffer).setBigUint64(0, BigInt(latestId), true);
          
          const [batchPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("batch"), batchIdBuffer],
            programId
          );
          
          const batchInfo = await connection.getAccountInfo(batchPda);
          if (batchInfo && batchInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) {
            const decodedBatch = BatchLayout.decode(batchInfo.data.slice(8));
            setBatchStatus(BATCH_STATUS_NAMES[decodedBatch.statusIdx] || "Unknown");
          } else {
            setBatchStatus(null);
          }
        }
      }
    } catch (e) {
      // ignore
    }
  };

  const handleStart = async () => {
    setLogs([]);
    const id = parseInt(batchIdInput);
    if (isNaN(id) || id < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = UNDEGEN_PROGRAM_ID;
      const operator = getOperatorKeypair();

      const batchIdBuffer = Buffer.alloc(8);
      new DataView(batchIdBuffer.buffer).setBigUint64(0, BigInt(id), true);

      const [batchPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("batch"), batchIdBuffer],
        programId
      );
      addLog("info", `Batch PDA: ${batchPda.toBase58()}`);

      const accountInfo = await connection.getAccountInfo(batchPda);
      if (!accountInfo) throw new Error("Batch account not found.");
      if (!accountInfo.owner.equals(programId)) throw new Error("Batch PDA not owned by Undegen.");
      if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) throw new Error("Batch not initialized.");

      const decodedBatch = BatchLayout.decode(accountInfo.data.slice(8));
      const statusName = BATCH_STATUS_NAMES[decodedBatch.statusIdx] || "Unknown";
      addLog("info", `Current batch status: ${statusName}`);

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: operator.publicKey, isSigner: true, isWritable: false },
          { pubkey: batchPda, isSigner: false, isWritable: true },
        ],
        data: START_BATCH_DISCRIMINATOR,
      });

      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = operator.publicKey;
      tx.sign(operator);
      
      addLog("info", "Sending start_batch transaction...");
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      addLog("info", `Sent. Signature: ${sig}`);
      await connection.confirmTransaction(sig);
      addLog("success", "Confirmed");
      setResult({ type: "success", message: `Batch ${id} started. Tx: ${sig}` });
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
          <h2 className="text-xl font-bold">Start Batch (Test)</h2>
          <p className="text-sm text-gray-400">
            Transitions a batch from Lobby to Locked (or whatever the program requires). The batch
            must be in <strong>Lobby</strong> status.
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <input
                type="number"
                placeholder="Batch ID"
                value={batchIdInput}
                onChange={(e) => setBatchIdInput(e.target.value)}
                className="w-full bg-bg1 border border-border-low rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400"
                disabled={loading}
              />
            </div>
            <button
              onClick={fetchLatestBatchId}
              disabled={loading}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-400 transition disabled:opacity-50"
            >
              Load Latest Batch ID
            </button>
          </div>
          {latestBatchId !== null && (
            <p className="text-xs text-gray-400">
              Latest batch ID: {latestBatchId}
              {batchStatus ? ` (Status: ${batchStatus})` : ""}
            </p>
          )}
          <button
            onClick={handleStart}
            disabled={loading || !batchIdInput}
            className="px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
          >
            {loading ? "Starting..." : "Start Batch"}
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