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
import Header from "@/app/components/home/Header";

const UNDEGEN_PROGRAM_ID_STR = "BgAM2mzfbFhcA1F3AfjfnV1nzyTJXb6bSz5BX7Wufwma";
const DEVNET_RPC = "https://api.devnet.solana.com";

const INIT_PROTOCOL_DISCRIMINATOR = Buffer.from([188, 233, 252, 106, 134, 146, 202, 91]);

// Borsh layout for ProtocolConfig (consistent with other pages)
const ProtocolConfigLayout = borsh.struct([
  borsh.publicKey("admin"),
  borsh.u64("next_batch_id"),
  borsh.u8("bump"),
]);

type LogEntry = {
  time: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
};

export default function InitializeProtocolTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { time: Date.now(), type, message }]);
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
      const programId = new PublicKey(UNDEGEN_PROGRAM_ID_STR);
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("protocol_config")],
        programId
      );
      addLog("info", `Config PDA: ${configPda.toBase58()}`);

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: INIT_PROTOCOL_DISCRIMINATOR,
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
      setResult({ type: "success", message: `Protocol initialized! Tx: ${sig}` });
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
          <h2 className="text-xl font-bold">Initialize Protocol (Test)</h2>
          <p className="text-sm text-gray-400">Creates the ProtocolConfig account. Must be done once.</p>
          <button onClick={handleInit} disabled={loading}
            className="px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50">
            {loading ? "Initializing..." : "Initialize Protocol"}
          </button>
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