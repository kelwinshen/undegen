"use client";

import { useState } from "react";
import Link from "next/link";
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
import Header from "@/app/components/Header";
import lotteryIdl from "@/app/lib/idl/lottery.json";

const LOTTERY_PROGRAM_ID = new PublicKey(lotteryIdl.address);
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const INIT_LOTTERY_DISCRIMINATOR = Buffer.from([113, 199, 243, 247, 73, 217, 33, 11]);
const LOTTERY_CONFIG_DISCRIMINATOR = Buffer.from([174, 54, 184, 175, 81, 20, 237, 24]);

// Borsh layout for LotteryConfig (consistent with app/services/undegenProgram.ts)
const LotteryConfigLayout = borsh.struct([
  borsh.publicKey("admin"),
  borsh.publicKey("mint"),
  borsh.u64("current_round_id"),
  borsh.u8("bump"),
]);

type LogEntry = {
  time: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
};

export default function InitializeLotteryTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [existingConfig, setExistingConfig] = useState<{ admin: string; currentRoundId: string } | null>(null);

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { time: Date.now(), type, message }]);
  };

  const handleCheck = async () => {
    setLogs([]);
    setExistingConfig(null);
    setResult(null);
    setLoading(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const mint = new PublicKey(DEVNET_USDC_MINT);
      const [lotteryConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("lottery_config"), mint.toBuffer()],
        LOTTERY_PROGRAM_ID
      );
      addLog("info", `LotteryConfig PDA: ${lotteryConfigPda.toBase58()}`);

      const info = await connection.getAccountInfo(lotteryConfigPda);
      if (!info || !info.data.slice(0, 8).equals(LOTTERY_CONFIG_DISCRIMINATOR)) {
        addLog("warning", "LotteryConfig not found — not yet initialized.");
        setResult({ type: "error", message: "LotteryConfig does not exist yet." });
        return;
      }

      const decoded = LotteryConfigLayout.decode(info.data.slice(8));
      setExistingConfig({
        admin: (decoded.admin as PublicKey).toBase58(),
        currentRoundId: decoded.current_round_id.toString(),
      });
      addLog("success", "LotteryConfig already exists.");
      setResult({ type: "success", message: "LotteryConfig found." });
    } catch (err: any) {
      addLog("error", err.message);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleInit = async () => {
    setLogs([]);
    const secretKeyEnv = process.env.NEXT_PUBLIC_OPERATOR_SECRET_KEY;
    if (!secretKeyEnv) {
      setResult({ type: "error", message: "NEXT_PUBLIC_OPERATOR_SECRET_KEY not set." });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      let adminKeypair: Keypair;
      addLog("info", "Loading admin keypair...");
      if (secretKeyEnv.startsWith("[")) {
        adminKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyEnv)));
      } else {
        adminKeypair = Keypair.fromSecretKey(bs58.decode(secretKeyEnv));
      }
      addLog("success", `Admin: ${adminKeypair.publicKey.toBase58()}`);

      const connection = new Connection(DEVNET_RPC, "confirmed");
      const mint = new PublicKey(DEVNET_USDC_MINT);
      const [lotteryConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("lottery_config"), mint.toBuffer()],
        LOTTERY_PROGRAM_ID
      );
      addLog("info", `LotteryConfig PDA: ${lotteryConfigPda.toBase58()}`);

      const ix = new TransactionInstruction({
        programId: LOTTERY_PROGRAM_ID,
        keys: [
          { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: lotteryConfigPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: INIT_LOTTERY_DISCRIMINATOR,
      });

      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = adminKeypair.publicKey;
      tx.sign(adminKeypair);
      addLog("info", "Sending transaction...");
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(sig);
      addLog("success", "Confirmed");
      setResult({ type: "success", message: `Lottery initialized! Tx: ${sig}` });
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
          <h2 className="text-xl font-bold">Initialize Lottery (Test)</h2>
          <p className="text-sm text-gray-400">Creates the LotteryConfig account for the devnet USDC mint. Must be done once before start_round.</p>
          <div className="flex gap-2">
            <button onClick={handleCheck} disabled={loading}
              className="px-6 py-2 border border-border-low rounded-lg hover:border-emerald-400 transition disabled:opacity-50">
              {loading ? "Checking..." : "Check Status"}
            </button>
            <button onClick={handleInit} disabled={loading}
              className="px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50">
              {loading ? "Initializing..." : "Initialize Lottery"}
            </button>
          </div>
          {existingConfig && (
            <div className="p-3 rounded-lg text-sm bg-bg1 border border-border-low space-y-1">
              <p>Admin: <span className="font-mono text-xs">{existingConfig.admin}</span></p>
              <p>Current Round ID: <span className="font-mono">{existingConfig.currentRoundId}</span></p>
            </div>
          )}
          {result && (
            <div className={`p-3 rounded-lg text-sm ${result.type === "success" ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border border-red-500/30 text-red-300"}`}>
              {result.message}
            </div>
          )}
          {logs.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2">Execution Log</h3>
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
