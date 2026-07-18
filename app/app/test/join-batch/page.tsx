"use client";

import { useState } from "react";
import Link from "next/link";
import { useWalletConnection } from "@solana/react-hooks";
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
import undegenCoreIdl from "@/app/lib/idl/undegen_core.json";
import yieldVaultIdl from "@/app/lib/idl/yield_vault.json";

const UNDEGEN_PROGRAM_ID = new PublicKey(undegenCoreIdl.address);
const YIELD_VAULT_PROGRAM_ID = new PublicKey(yieldVaultIdl.address);
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const JOIN_BATCH_DISCRIMINATOR = Buffer.from([81, 186, 86, 76, 184, 199, 194, 96]);
const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);
const PROTOCOL_CONFIG_DISCRIMINATOR = Buffer.from([207, 91, 250, 28, 152, 179, 215, 209]);
const VAULT_CONFIG_DISCRIMINATOR = Buffer.from([99, 86, 43, 216, 184, 102, 119, 77]);

const INIT_VAULT_DISCRIMINATOR = Buffer.from([48, 191, 163, 44, 71, 129, 63, 164]);

const ATA_SEED = Buffer.from([
  6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172,
  28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);

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

// Minimal batch layout – we only need the status field
const BatchStatusLayout = borsh.struct([
  borsh.u64("batch_id"),
  borsh.publicKey("operator"),
  borsh.publicKey("mint"),
  borsh.u8("bump"),
  borsh.publicKey("vault_position"),
  borsh.u8("status"),       // ← index of BatchStatus enum
]);

const BATCH_STATUS_NAMES = ["Lobby", "Locked", "AwaitingCollateral", "Active", "Settled", "Cancelled"];

function writeUInt64LE(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  new DataView(buffer.buffer).setBigUint64(0, value, true);
  return buffer;
}

function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

export default function JoinBatchTest() {
  const { wallet, status } = useWalletConnection();
  const connected = status === "connected";

  const [batchIdInput, setBatchIdInput] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [latestBatchId, setLatestBatchId] = useState<number | null>(null);

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

  const sendTxAsOperator = async (ix: TransactionInstruction): Promise<string> => {
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

  const initializeVaultIfNeeded = async (connection: Connection): Promise<void> => {
    const mint = new PublicKey(DEVNET_USDC_MINT);
    const yieldVaultProgramId = YIELD_VAULT_PROGRAM_ID;
    const [vaultConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_config"), mint.toBuffer()],
      yieldVaultProgramId
    );

    const vaultConfigInfo = await connection.getAccountInfo(vaultConfigPda);
    if (vaultConfigInfo && vaultConfigInfo.data.slice(0, 8).equals(VAULT_CONFIG_DISCRIMINATOR)) {
      addLog("success", "Yield vault config already exists.");
      return;
    }

    addLog("warning", "Yield vault config not found — initializing now...");

    const [vaultTokenAccountPda] = PublicKey.findProgramAddressSync(
      [vaultConfigPda.toBuffer(), ATA_SEED, mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const [reserveTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), mint.toBuffer()],
      yieldVaultProgramId
    );

    const operator = getOperatorKeypair();
    const keys = [
      { pubkey: operator.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: vaultConfigPda, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAccountPda, isSigner: false, isWritable: true },
      { pubkey: reserveTokenAccountPda, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({
      programId: yieldVaultProgramId,
      keys,
      data: INIT_VAULT_DISCRIMINATOR,
    });

    const sig = await sendTxAsOperator(ix);
    addLog("success", `Yield vault initialized. Tx: ${sig}`);
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
        // Borsh decode ProtocolConfig
        const config = ProtocolConfigLayout.decode(info.data.slice(8));
        const latestId = Number(config.next_batch_id) - 1;
        if (latestId >= 0) {
          setLatestBatchId(latestId);
          setBatchIdInput(latestId.toString());
        }
      }
    } catch (e) {
      // ignore
    }
  };

  const handleJoin = async () => {
    setLogs([]);
    if (!connected || !wallet?.account?.address) {
      setResult({ type: "error", message: "Connect your wallet first." });
      return;
    }

    const inputId = parseInt(batchIdInput);
    if (isNaN(inputId) || inputId < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }

    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      setResult({ type: "error", message: "Invalid amount" });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const undegenProgramId = UNDEGEN_PROGRAM_ID;
      const mint = new PublicKey(DEVNET_USDC_MINT);
      const user = new PublicKey(wallet.account.address);

      // 1. Ensure yield vault exists
      await initializeVaultIfNeeded(connection);

      const yieldVaultProgramId = YIELD_VAULT_PROGRAM_ID;
      const [vaultConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_config"), mint.toBuffer()],
        yieldVaultProgramId
      );

      // 2. Fetch batch account
      const batchIdBuffer = writeUInt64LE(BigInt(inputId));
      const [batchPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("batch"), batchIdBuffer],
        undegenProgramId
      );
      addLog("info", `Batch PDA: ${batchPda.toBase58()}`);

      const accountInfo = await connection.getAccountInfo(batchPda);
      if (!accountInfo) throw new Error("Batch account not found. Use 'Load Latest Batch ID'.");
      if (!accountInfo.owner.equals(undegenProgramId)) throw new Error("Batch PDA not owned by Undegen.");
      if (!accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) throw new Error("Batch not initialized.");

      // Borsh decode batch status
      const batchDecoded = BatchStatusLayout.decode(accountInfo.data.slice(8));
      const statusName = BATCH_STATUS_NAMES[batchDecoded.status] ?? "Unknown";
      addLog("info", `Batch status: ${statusName}`);

      if (statusName !== "Lobby") {
        throw new Error(`Batch not in Lobby (current: ${statusName}).`);
      }

      // 3. Build and send join transaction
      const rawAmount = BigInt(Math.floor(depositAmount * 1e6));
      const dataInst = Buffer.concat([JOIN_BATCH_DISCRIMINATOR, writeUInt64LE(rawAmount)]);

      const userTokenAccount = getAssociatedTokenAddress(user, mint);
      const batchTokenAccount = getAssociatedTokenAddress(batchPda, mint);
      const vaultTokenAccount = getAssociatedTokenAddress(vaultConfigPda, mint);

      const [vaultPositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), vaultConfigPda.toBuffer(), batchPda.toBuffer()],
        yieldVaultProgramId
      );

      const [userPositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), batchPda.toBuffer(), user.toBuffer()],
        undegenProgramId
      );

      addLog("info", `User ATA: ${userTokenAccount.toBase58()}`);
      addLog("info", `Batch ATA: ${batchTokenAccount.toBase58()}`);
      addLog("info", `Vault ATA: ${vaultTokenAccount.toBase58()}`);
      addLog("info", `Vault position: ${vaultPositionPda.toBase58()}`);
      addLog("info", `User position: ${userPositionPda.toBase58()}`);

      const keys = [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: batchPda, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: batchTokenAccount, isSigner: false, isWritable: true },
        { pubkey: vaultConfigPda, isSigner: false, isWritable: true },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: vaultPositionPda, isSigner: false, isWritable: true },
        { pubkey: userPositionPda, isSigner: false, isWritable: true },
        { pubkey: yieldVaultProgramId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];

      const ix = new TransactionInstruction({ programId: undegenProgramId, keys, data: dataInst });
      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user;

      addLog("info", "Requesting wallet signature...");
      const provider = (window as any).solana;
      if (provider) {
        const signedTx = await provider.signTransaction(tx);
        const sig = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false });
        addLog("info", `Sent. Signature: ${sig}`);
        await connection.confirmTransaction(sig);
        addLog("success", "Confirmed");
        setResult({ type: "success", message: `Joined batch with ${depositAmount} USDC. Tx: ${sig}` });
      } else if (wallet.signTransaction) {
        const signed = await wallet.signTransaction(tx as any);
        const rawTx = signed instanceof Uint8Array ? signed : (signed as any).serialize?.() ?? signed;
        const sig = await connection.sendRawTransaction(rawTx, { skipPreflight: false });
        addLog("info", `Sent. Signature: ${sig}`);
        await connection.confirmTransaction(sig);
        addLog("success", "Confirmed");
        setResult({ type: "success", message: `Joined batch with ${depositAmount} USDC. Tx: ${sig}` });
      } else {
        throw new Error("Wallet does not support signTransaction");
      }
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
          <h2 className="text-xl font-bold">Join Batch (Test)</h2>
          <p className="text-sm text-gray-400">
            Enter a batch ID and deposit USDC. The yield vault is auto‑initialized if missing.
            The batch must be in <strong>Lobby</strong> status.
          </p>
          {!connected && (
            <p className="text-xs text-yellow-300">Connect your wallet (devnet) to join a batch.</p>
          )}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <input
                type="number"
                placeholder="Batch ID"
                value={batchIdInput}
                onChange={(e) => setBatchIdInput(e.target.value)}
                className="w-full bg-bg1 border border-border-low rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400"
                disabled={loading || !connected}
              />
            </div>
            <button
              onClick={fetchLatestBatchId}
              disabled={loading || !connected}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-400 transition disabled:opacity-50"
            >
              Load Latest Batch ID
            </button>
          </div>
          {latestBatchId !== null && (
            <p className="text-xs text-gray-400">Latest batch ID: {latestBatchId}</p>
          )}
          <input
            type="number"
            placeholder="Amount (USDC)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-bg1 border border-border-low rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400"
            disabled={loading || !connected}
          />
          <button
            onClick={handleJoin}
            disabled={loading || !connected || !batchIdInput || !amount}
            className="px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
          >
            {loading ? "Joining..." : "Join Batch"}
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