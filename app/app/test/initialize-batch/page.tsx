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
import Header from "@/app/components/live/Header";

const UNDEGEN_PROGRAM_ID_STR = "4KdYywAokwbLWNZ6XFtr6boho1JprUTuhYsoGuu4dVRY";
const YIELD_VAULT_PROGRAM_ID_STR = "EBYBucMwfqYEXc9Hh56TpjwqxvgZDoJjWJoVc8sbFqPS";
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const INIT_BATCH_DISCRIMINATOR = Buffer.from([126, 44, 205, 90, 220, 105, 105, 193]);
const INIT_PROTOCOL_DISCRIMINATOR = Buffer.from([188, 233, 252, 106, 134, 146, 202, 91]);
const VAULT_CONFIG_DISCRIMINATOR = Buffer.from([99, 86, 43, 216, 184, 102, 119, 77]);
const PROTOCOL_CONFIG_DISCRIMINATOR = Buffer.from([207, 91, 250, 28, 152, 179, 215, 209]);

const ANNUAL_APY_PERCENT = 4;

type LogEntry = {
  time: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
};

// ---------- Borsh layouts ----------
const ProtocolConfigLayout = borsh.struct([
  borsh.publicKey("admin"),
  borsh.u64("next_batch_id"),
  borsh.u8("bump"),
]);

const VaultConfigLayout = borsh.struct([
  borsh.publicKey("admin"),
  borsh.publicKey("mint"),
  borsh.publicKey("vault_token_account"),
  borsh.publicKey("reserve_token_account"),
  borsh.u64("total_shares"),
  borsh.u64("total_underlying"),
  borsh.u8("bump"),
]);

function writeUInt64LE(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  new DataView(buffer.buffer).setBigUint64(0, value, true);
  return buffer;
}

function writeU16LE(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

export default function InitializeBatchTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [createdBatchId, setCreatedBatchId] = useState<string | null>(null);

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

  const sendTx = async (ix: TransactionInstruction, signer: Keypair): Promise<string> => {
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const tx = new Transaction().add(ix);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = signer.publicKey;
    tx.sign(signer);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(sig);
    return sig;
  };

  const handleInitialize = async () => {
    setLogs([]);
    setCreatedBatchId(null);
    setResult(null);

    const annualRate = ANNUAL_APY_PERCENT / 100;
    const weeklyRate = Math.pow(1 + annualRate, 1 / 52) - 1;
    const weeklyBps = Math.round(weeklyRate * 10000);
    const effectiveAnnualRate = Math.pow(1 + weeklyBps / 10000, 52) - 1;
    const effectiveAnnualApy = (effectiveAnnualRate * 100).toFixed(2);

    addLog("info", `Fixed annual APY: ${ANNUAL_APY_PERCENT}%`);
    addLog("info", `Weekly rate: ${(weeklyRate * 100).toFixed(4)}% → ${weeklyBps} bps`);
    addLog("info", `Effective annual APY: ${effectiveAnnualApy}%`);

    setLoading(true);

    try {
      const operator = getOperatorKeypair();
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = new PublicKey(UNDEGEN_PROGRAM_ID_STR);
      const mint = new PublicKey(DEVNET_USDC_MINT);

      // Ensure protocol config exists
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("protocol_config")],
        programId
      );
      let configInfo = await connection.getAccountInfo(configPda);
      if (!configInfo) {
        addLog("warning", "Protocol config not found — initializing now...");
        const initIx = new TransactionInstruction({
          programId,
          keys: [
            { pubkey: operator.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: INIT_PROTOCOL_DISCRIMINATOR,
        });
        const sig = await sendTx(initIx, operator);
        addLog("success", `Protocol initialized (${sig.slice(0, 12)}…)`);
        configInfo = await connection.getAccountInfo(configPda);
      }

      if (!configInfo || !configInfo.data.slice(0, 8).equals(PROTOCOL_CONFIG_DISCRIMINATOR)) {
        throw new Error("Protocol config account invalid.");
      }

      // Borsh decode ProtocolConfig
      const protocolConfig = ProtocolConfigLayout.decode(configInfo.data.slice(8));
      const nextBatchId = protocolConfig.next_batch_id;
      addLog("info", `Next batch ID: ${nextBatchId.toString()}`);

      // Optional vault TVL check
      const vaultProgramId = new PublicKey(YIELD_VAULT_PROGRAM_ID_STR);
      const [vaultConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_config"), mint.toBuffer()],
        vaultProgramId
      );
      try {
        const vaultConfigInfo = await connection.getAccountInfo(vaultConfigPda);
        if (vaultConfigInfo && vaultConfigInfo.data.slice(0, 8).equals(VAULT_CONFIG_DISCRIMINATOR)) {
          const vaultConfig = VaultConfigLayout.decode(vaultConfigInfo.data.slice(8));
          const totalUnderlying = vaultConfig.total_underlying;
          const requiredWeeklyTick = Number(totalUnderlying) * weeklyRate;
          addLog("success", `Vault TVL: ${Number(totalUnderlying).toLocaleString()} raw units`);
          addLog("info", `Required weekly tick_yield: ${requiredWeeklyTick.toFixed(0)} raw units`);
        } else {
          addLog("warning", "Yield vault not initialized.");
        }
      } catch (vaultErr: any) {
        addLog("warning", `Could not read vault: ${vaultErr.message}`);
      }

      // Derive batch PDA
      const batchIdBuffer = writeUInt64LE(nextBatchId);
      const [batchPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("batch"), batchIdBuffer],
        programId
      );
      addLog("success", `Batch PDA: ${batchPda.toBase58()}`);

      // Build instruction
      const data = Buffer.concat([INIT_BATCH_DISCRIMINATOR, writeU16LE(weeklyBps)]);
      const keys = [
        { pubkey: operator.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: batchPda, isSigner: false, isWritable: true },
        { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];

      const ix = new TransactionInstruction({ programId, keys, data });
      addLog("success", "Instruction built");

      const sig = await sendTx(ix, operator);
      addLog("info", `Batch tx: ${sig}`);
      addLog("success", "Confirmed");

      setCreatedBatchId(nextBatchId.toString());
      setResult({
        type: "success",
        message: `Batch ${nextBatchId.toString()} initialized. Weekly: ${weeklyBps} bps, Effective APY: ${effectiveAnnualApy}%.`,
      });
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
          <h2 className="text-xl font-bold">Initialize Batch (Test)</h2>
          <p className="text-sm text-gray-400">
            Creates a new batch with a fixed annual APY of <strong>{ANNUAL_APY_PERCENT}%</strong>.
            Protocol config is initialized automatically if missing.
          </p>
          <button
            onClick={handleInitialize}
            disabled={loading}
            className="px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
          >
            {loading ? "Initializing..." : "Initialize Batch"}
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
              {createdBatchId && (
                <div className="mt-2">
                  <Link
                    href={`/test/batch-details?batchId=${createdBatchId}`}
                    className="underline text-emerald-300 hover:text-emerald-200"
                  >
                    View Batch Details →
                  </Link>
                </div>
              )}
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