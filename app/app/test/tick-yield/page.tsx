"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  Keypair,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as borsh from "@coral-xyz/borsh";
import bs58 from "bs58";
import Header from "@/app/components/Header";

const YIELD_VAULT_PROGRAM_ID_STR =
  "EBYBucMwfqYEXc9Hh56TpjwqxvgZDoJjWJoVc8sbFqPS";
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const TICK_YIELD_DISCRIMINATOR = new Uint8Array([
  248, 127, 86, 235, 147, 179, 220, 137,
]);

const VAULT_CONFIG_DISCRIMINATOR = new Uint8Array([
  99, 86, 43, 216, 184, 102, 119, 77,
]);

// Borsh layout for VaultConfig to decode admin and status
const VaultConfigLayout = borsh.struct([
  borsh.publicKey("admin"),
  borsh.publicKey("mint"),
  borsh.publicKey("vault_token_account"),
  borsh.publicKey("reserve_token_account"),
  borsh.u64("total_shares"),
  borsh.u64("total_underlying"),
  borsh.u8("bump"),
]);

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function uint8ArrayEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export default function TickYield() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [vaultConfigPda, setVaultConfigPda] = useState<PublicKey | null>(null);
  const [vaultData, setVaultData] = useState<any>(null);

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const getOperatorKeypair = (): Keypair => {
    const secretKeyEnv = process.env.NEXT_PUBLIC_OPERATOR_SECRET_KEY;
    if (!secretKeyEnv)
      throw new Error("NEXT_PUBLIC_OPERATOR_SECRET_KEY not set.");
    if (secretKeyEnv.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyEnv)));
    }
    return Keypair.fromSecretKey(bs58.decode(secretKeyEnv));
  };

  const fetchVaultConfig = async () => {
    setLogs([]);
    setVaultConfigPda(null);
    setVaultData(null);
    setResult(null);

    setLoading(true);
    try {
      const connection = new Connection(DEVNET_RPC);
      const yieldVaultProgramId = new PublicKey(YIELD_VAULT_PROGRAM_ID_STR);
      const mint = new PublicKey(DEVNET_USDC_MINT);

      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_config"), mint.toBuffer()],
        yieldVaultProgramId
      );
      setVaultConfigPda(pda);
      addLog(`Vault Config PDA: ${pda.toBase58()}`);

      const accountInfo = await connection.getAccountInfo(pda);
      if (!accountInfo) {
        throw new Error(
          "Vault config account not found. Has the vault been initialized?"
        );
      }

      if (
        !uint8ArrayEqual(
          accountInfo.data.slice(0, 8),
          VAULT_CONFIG_DISCRIMINATOR
        )
      ) {
        throw new Error("Account is not a VaultConfig.");
      }

      const dataBuffer = Buffer.from(accountInfo.data.slice(8));
      const decoded = VaultConfigLayout.decode(dataBuffer);
      setVaultData(decoded);
      addLog("Vault config loaded successfully.");
      addLog(`Admin: ${decoded.admin.toBase58()}`);
      addLog(`Total Underlying: ${decoded.total_underlying.toString()}`);
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTickYield = async () => {
    if (!vaultConfigPda) {
      setResult({ type: "error", message: "Load vault config first." });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const connection = new Connection(DEVNET_RPC);
      const yieldVaultProgramId = new PublicKey(YIELD_VAULT_PROGRAM_ID_STR);
      const mint = new PublicKey(DEVNET_USDC_MINT);
      const operator = getOperatorKeypair();

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        vaultConfigPda,
        true
      );

      const [reserveTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("reserve"), mint.toBuffer()],
        yieldVaultProgramId
      );

      addLog(`Vault Token Account: ${vaultTokenAccount.toBase58()}`);
      addLog(`Reserve Token Account: ${reserveTokenAccount.toBase58()}`);

      const data = Buffer.from(TICK_YIELD_DISCRIMINATOR);

      const keys = [
        { pubkey: operator.publicKey, isSigner: true, isWritable: false },
        { pubkey: vaultConfigPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: reserveTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ];

      const ix = new TransactionInstruction({
        programId: yieldVaultProgramId,
        keys,
        data,
      });
      const cuIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000,
      });

      const { blockhash } = await connection.getLatestBlockhash();

      const messageV0 = new TransactionMessage({
        payerKey: operator.publicKey,
        recentBlockhash: blockhash,
        instructions: [cuIx, ix],
      }).compileToV0Message([]);

      const tx = new VersionedTransaction(messageV0);
      tx.sign([operator]);

      addLog("Sending tick_yield transaction...");
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });
      await connection.confirmTransaction(sig);
      setResult({ type: "success", message: `Success! Tx: ${sig}` });
      addLog(`Transaction confirmed: ${sig}`);
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col gap-8 border-x border-border-low px-6 py-12">
        <Header />
        <Link
          href="/test"
          className="text-xs text-gray-400 hover:text-gray-200 -mb-4"
        >
          ← Back to Test Hub
        </Link>
        <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-6">
          <h2 className="text-xl font-bold">Tick Yield (Test)</h2>
          <p className="text-sm text-gray-400">
            Triggers yield compounding by moving funds from the reserve to the
            vault. Only the vault admin (operator) can call this.
          </p>

          <div className="flex gap-2">
            <button
              onClick={fetchVaultConfig}
              disabled={loading}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-400 transition disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load Vault Config"}
            </button>
          </div>

          {vaultData && (
            <div className="space-y-4">
              <div className="text-sm text-gray-400 p-3 bg-black/20 rounded-lg border border-border-low">
                <span className="block">
                  <strong>Admin:</strong> {vaultData.admin.toBase58()}
                </span>
                <span className="block">
                  <strong>Total Underlying:</strong>{" "}
                  {vaultData.total_underlying.toString()}
                </span>
              </div>

              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-300">
                The button is enabled once the vault config is loaded. The
                contract will enforce admin access and that there is something
                to grow.
              </div>

              <button
                onClick={handleTickYield}
                disabled={!vaultData || loading}
                className="w-full mt-4 px-6 py-3 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
              >
                {loading ? "Ticking..." : "Tick Yield"}
              </button>
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
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2 text-gray-400">
                Execution Log
              </h3>
              <div className="bg-black/40 rounded-lg p-4 max-h-64 overflow-y-auto space-y-1 text-xs font-mono border border-border-low">
                {logs.map((msg, i) => (
                  <div
                    key={i}
                    className={
                      msg.includes("Error") || msg.includes("Failed")
                        ? "text-red-400"
                        : msg.includes("Success") || msg.includes("success")
                          ? "text-emerald-300"
                          : "text-gray-400"
                    }
                  >
                    {msg}
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
