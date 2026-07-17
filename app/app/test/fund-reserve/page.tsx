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
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as borsh from "@coral-xyz/borsh";
import bs58 from "bs58";
import Header from "@/app/components/Header";

const YIELD_VAULT_PROGRAM_ID_STR = "EBYBucMwfqYEXc9Hh56TpjwqxvgZDoJjWJoVc8sbFqPS";
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const FUND_RESERVE_DISCRIMINATOR = Buffer.from([17, 82, 71, 222, 117, 210, 58, 12]);

const VAULT_CONFIG_DISCRIMINATOR = Buffer.from([99, 86, 43, 216, 184, 102, 119, 77]);

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

function writeUInt64LE(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  new DataView(buffer.buffer).setBigUint64(0, value, true);
  return buffer;
}

export default function FundReserveTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [vaultConfigPda, setVaultConfigPda] = useState<PublicKey | null>(null);
  const [vaultData, setVaultData] = useState<any>(null);
  const [amount, setAmount] = useState("");

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
        yieldVaultProgramId,
      );
      setVaultConfigPda(pda);
      addLog("info", `Vault Config PDA: ${pda.toBase58()}`);

      const accountInfo = await connection.getAccountInfo(pda);
      if (!accountInfo) {
        throw new Error("Vault config account not found. Has the vault been initialized?");
      }

      if (!accountInfo.data.slice(0, 8).equals(VAULT_CONFIG_DISCRIMINATOR)) {
        throw new Error("Account is not a VaultConfig.");
      }

      const dataBuffer = Buffer.from(accountInfo.data.slice(8));
      const decoded = VaultConfigLayout.decode(dataBuffer);
      setVaultData(decoded);
      addLog("success", "Vault config loaded.");
      addLog("info", `Admin: ${decoded.admin.toBase58()}`);
      addLog("info", `Reserve: ${decoded.reserve_token_account.toBase58()}`);
    } catch (err: any) {
      addLog("error", err.message);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleFundReserve = async () => {
    if (!vaultConfigPda || !vaultData) {
      setResult({ type: "error", message: "Load vault config first." });
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setResult({ type: "error", message: "Enter a valid USDC amount." });
      return;
    }

    setLoading(true);
    setResult(null);
    setLogs([]);

    try {
      const operator = getOperatorKeypair();
      addLog("info", `Operator: ${operator.publicKey.toBase58()}`);

      const connection = new Connection(DEVNET_RPC, "confirmed");
      const yieldVaultProgramId = new PublicKey(YIELD_VAULT_PROGRAM_ID_STR);
      const mint = new PublicKey(DEVNET_USDC_MINT);

      const reserveTokenAccount = vaultData.reserve_token_account;
      const adminTokenAccount = await getAssociatedTokenAddress(mint, operator.publicKey);

      const rawAmount = BigInt(Math.floor(parsedAmount * 1e6));
      addLog("info", `Amount: ${rawAmount} (base units)`);

      const data = Buffer.concat([
        FUND_RESERVE_DISCRIMINATOR,
        writeUInt64LE(rawAmount),
      ]);

      const keys = [
        { pubkey: operator.publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultConfigPda, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: reserveTokenAccount, isSigner: false, isWritable: true },
        { pubkey: adminTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ];

      const ix = new TransactionInstruction({
        programId: yieldVaultProgramId,
        keys,
        data,
      });

      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = operator.publicKey;
      tx.sign(operator);

      addLog("info", "Sending fund_reserve transaction...");
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(sig);
      addLog("success", "Confirmed");
      setResult({ type: "success", message: `Reserve funded! Tx: ${sig}` });
    } catch (err: any) {
      addLog("error", err.message);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col gap-8 border-x border-border-low px-6 py-12">
        <Header />
        <Link href="/test" className="text-xs text-gray-400 hover:text-gray-200 -mb-4">
          ← Back to Test Hub
        </Link>
        <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-6">
          <h2 className="text-xl font-bold">Fund Reserve (Test)</h2>
          <p className="text-sm text-gray-400">
            Deposit USDC into the yield vault's reserve from the operator (admin)
            wallet. Only the vault admin can call this.
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
                  <strong>Reserve:</strong>{" "}
                  {vaultData.reserve_token_account.toBase58()}
                </span>
              </div>

              <input
                type="number"
                placeholder="Amount (USDC)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-bg1 border border-border-low rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400"
                disabled={loading}
              />

              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-300">
                The contract enforces admin access. Once loaded, the operator
                keypair (from env) is used as the signer.
              </div>

              <button
                onClick={handleFundReserve}
                disabled={!vaultData || loading}
                className="w-full mt-4 px-6 py-3 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
              >
                {loading ? "Funding..." : "Fund Reserve"}
              </button>
            </div>
          )}

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