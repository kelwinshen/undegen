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

const YIELD_VAULT_PROGRAM_ID_STR =
  "EBYBucMwfqYEXc9Hh56TpjwqxvgZDoJjWJoVc8sbFqPS";
import { SOLANA_CONFIG } from "@/app/lib/solanaConfig";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

const INIT_VAULT_DISCRIMINATOR = Buffer.from([
  48, 191, 163, 44, 71, 129, 63, 164,
]);

// ATA seed constant from the IDL
const ATA_SEED = Buffer.from([
  6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172,
  28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);

// Borsh layout for VaultConfig (consistent with other pages)
const VaultConfigLayout = borsh.struct([
  borsh.publicKey("admin"),
  borsh.publicKey("mint"),
  borsh.publicKey("vault_token_account"),
  borsh.publicKey("reserve_token_account"),
  borsh.u64("total_shares"),
  borsh.u64("total_underlying"),
  borsh.u8("bump"),
]);

type LogEntry = {
  time: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
};

export default function InitializeYieldVaultTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { time: Date.now(), type, message }]);
  };

  const handleInit = async () => {
    setLogs([]);
    const secretKeyEnv = process.env.NEXT_PUBLIC_OPERATOR_SECRET_KEY;
    if (!secretKeyEnv) {
      setResult({
        type: "error",
        message: "NEXT_PUBLIC_OPERATOR_SECRET_KEY not set.",
      });
      return;
    }

    setLoading(true);
    setResult(null);

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

      const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);
      const programId = new PublicKey(YIELD_VAULT_PROGRAM_ID_STR);
      const mint = new PublicKey(DEVNET_USDC_MINT);

      // Derive vault config PDA
      const [vaultConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_config"), mint.toBuffer()],
        programId
      );
      addLog("info", `Vault config PDA: ${vaultConfigPda.toBase58()}`);

      // Derive vault token account PDA (ATA owned by vault config)
      const [vaultTokenAccountPda] = PublicKey.findProgramAddressSync(
        [vaultConfigPda.toBuffer(), ATA_SEED, mint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      addLog(
        "info",
        `Vault token account PDA: ${vaultTokenAccountPda.toBase58()}`
      );

      // Derive reserve token account PDA
      const [reserveTokenAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("reserve"), mint.toBuffer()],
        programId
      );
      addLog(
        "info",
        `Reserve token account PDA: ${reserveTokenAccountPda.toBase58()}`
      );

      // Build instruction
      const keys = [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: vaultConfigPda, isSigner: false, isWritable: true },
        { pubkey: vaultTokenAccountPda, isSigner: false, isWritable: true },
        { pubkey: reserveTokenAccountPda, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];

      const ix = new TransactionInstruction({
        programId,
        keys,
        data: INIT_VAULT_DISCRIMINATOR,
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
        message: `Yield vault initialized! Tx: ${sig}`,
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
          <h2 className="text-xl font-bold">Initialize Yield Vault (Test)</h2>
          <p className="text-sm text-gray-400">
            Creates the vault config account for the USDC yield vault. Required
            before joining any batch.
          </p>
          <button
            onClick={handleInit}
            disabled={loading}
            className="px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
          >
            {loading ? "Initializing..." : "Initialize Vault"}
          </button>
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
