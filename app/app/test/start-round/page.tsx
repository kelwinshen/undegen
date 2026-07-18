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
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

const START_ROUND_DISCRIMINATOR = Buffer.from([
  144, 144, 43, 7, 193, 42, 217, 215,
]);
const LOTTERY_CONFIG_DISCRIMINATOR = Buffer.from([
  174, 54, 184, 175, 81, 20, 237, 24,
]);

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

function writeUInt64LE(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  new DataView(buffer.buffer).setBigUint64(0, value, true);
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

export default function StartRoundTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [nextRoundId, setNextRoundId] = useState<string | null>(null);

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { time: Date.now(), type, message }]);
  };

  const handleStart = async () => {
    setLogs([]);
    setResult(null);
    setNextRoundId(null);
    const secretKeyEnv = process.env.NEXT_PUBLIC_OPERATOR_SECRET_KEY;
    if (!secretKeyEnv) {
      setResult({
        type: "error",
        message: "NEXT_PUBLIC_OPERATOR_SECRET_KEY not set.",
      });
      return;
    }

    setLoading(true);

    try {
      let adminKeypair: Keypair;
      addLog("info", "Loading admin keypair...");
      if (secretKeyEnv.startsWith("[")) {
        adminKeypair = Keypair.fromSecretKey(
          Uint8Array.from(JSON.parse(secretKeyEnv))
        );
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
      const configInfo = await connection.getAccountInfo(lotteryConfigPda);
      if (
        !configInfo ||
        !configInfo.data.slice(0, 8).equals(LOTTERY_CONFIG_DISCRIMINATOR)
      ) {
        throw new Error(
          "LotteryConfig not found — initialize the lottery first."
        );
      }
      const config = LotteryConfigLayout.decode(configInfo.data.slice(8));
      const roundId = BigInt(config.current_round_id.toString()) + BigInt(1);
      setNextRoundId(roundId.toString());
      addLog("info", `Next round ID: ${roundId}`);

      const [roundPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("round"), mint.toBuffer(), writeUInt64LE(roundId)],
        LOTTERY_PROGRAM_ID
      );
      addLog("info", `Round PDA: ${roundPda.toBase58()}`);

      const jackpotTokenAccount = deriveAssociatedTokenAddress(roundPda, mint);
      addLog(
        "info",
        `Jackpot token account: ${jackpotTokenAccount.toBase58()}`
      );

      const ix = new TransactionInstruction({
        programId: LOTTERY_PROGRAM_ID,
        keys: [
          { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: lotteryConfigPda, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: roundPda, isSigner: false, isWritable: true },
          { pubkey: jackpotTokenAccount, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          {
            pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data: START_ROUND_DISCRIMINATOR,
      });

      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = adminKeypair.publicKey;
      tx.sign(adminKeypair);
      addLog("info", "Sending transaction...");
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });
      await connection.confirmTransaction(sig);
      addLog("success", "Confirmed");
      setResult({
        type: "success",
        message: `Round ${roundId} started! Tx: ${sig}`,
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
        <Link
          href="/test"
          className="text-xs text-gray-400 hover:text-gray-200 -mb-4"
        >
          ← Back to Test Hub
        </Link>
        <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-6">
          <h2 className="text-xl font-bold">Start Round (Test)</h2>
          <p className="text-sm text-gray-400">
            Starts the next lottery round (current_round_id + 1), creating its
            Round account and jackpot token account. Requires LotteryConfig to
            already exist.
          </p>
          <button
            onClick={handleStart}
            disabled={loading}
            className="px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
          >
            {loading ? "Starting..." : "Start Round"}
          </button>
          {nextRoundId && (
            <div className="p-3 rounded-lg text-sm bg-bg1 border border-border-low">
              Round ID: <span className="font-mono">{nextRoundId}</span>
            </div>
          )}
          {result && (
            <div
              className={`p-3 rounded-lg text-sm ${result.type === "success" ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border border-red-500/30 text-red-300"}`}
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
