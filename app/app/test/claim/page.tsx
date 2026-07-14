"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useWalletConnection } from "@solana/react-hooks";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import * as borsh from "@coral-xyz/borsh";
import Header from "@/app/components/home/Header";

const UNDEGEN_PROGRAM_ID_STR = "BgAM2mzfbFhcA1F3AfjfnV1nzyTJXb6bSz5BX7Wufwma";
const YIELD_VAULT_PROGRAM_ID_STR = "EBYBucMwfqYEXc9Hh56TpjwqxvgZDoJjWJoVc8sbFqPS";
const DEVNET_RPC = "https://api.devnet.solana.com";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const CLAIM_DISCRIMINATOR = new Uint8Array([
  62, 198, 214, 193, 213, 159, 108, 210,
]);

const BATCH_DISCRIMINATOR = new Uint8Array([
  156, 194, 70, 44, 22, 88, 137, 44,
]);

function uint8ArrayEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

const BetTermLayout = borsh.struct([
  borsh.i64("fixture_id"),
  borsh.u16("period"),
  borsh.u32("stat_a_key"),
  borsh.option(borsh.u32(), "stat_b_key"),
  borsh.option(
    borsh.rustEnum([
      borsh.struct([], "Add"),
      borsh.struct([], "Subtract"),
    ]),
    "op",
  ),
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

const STATUS_NAMES = [
  "Lobby",
  "Locked",
  "AwaitingCollateral",
  "Active",
  "Settled",
  "Cancelled",
];

function writeUInt64LE(value: number | bigint | string): Buffer {
  const buffer = Buffer.alloc(8);
  new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setBigUint64(
    0,
    BigInt(value),
    true,
  );
  return buffer;
}

function getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

function describeTerm(term: any): string {
  if (BigInt(term.fixture_id) === BigInt(0)) return "empty slot";
  const compMap: Record<number, string> = { 0: ">", 1: "<", 2: "==" };
  const compStr = compMap[term.predicate_comparison] ?? "?";
  let statAName = `Stat ${term.stat_a_key}`;
  if (term.stat_a_key === 1002) statAName = "Home Goals";
  if (term.stat_a_key === 1003) statAName = "Away Goals";
  if (term.stat_a_key === 1004) statAName = "Total Goals";
  if (term.stat_b_key !== null) {
    let statBName = `Stat ${term.stat_b_key}`;
    if (term.stat_b_key === 1002) statBName = "Home Goals";
    if (term.stat_b_key === 1003) statBName = "Away Goals";
    const opStr = term.op?.Subtract !== undefined ? "-" : "+";
    return `${statAName} ${opStr} ${statBName} ${compStr} ${term.predicate_threshold}`;
  }
  return `${statAName} ${compStr} ${term.predicate_threshold}`;
}

export default function ClaimTest() {
  const searchParams = useSearchParams();
  const batchIdParam = searchParams.get("batchId") || "";

  const { wallet, status } = useWalletConnection();
  const connected = status === "connected";

  const [batchId, setBatchId] = useState(batchIdParam);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [batchPda, setBatchPda] = useState<PublicKey | null>(null);
  const [batchData, setBatchData] = useState<any>(null);
  const [userPositionExists, setUserPositionExists] = useState<boolean | null>(null);

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const fetchBatch = async () => {
    setLogs([]);
    setBatchPda(null);
    setBatchData(null);
    setResult(null);
    setUserPositionExists(null);

    const id = parseInt(batchId);
    if (isNaN(id) || id < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }

    setLoading(true);
    try {
      const connection = new Connection(DEVNET_RPC);
      const programId = new PublicKey(UNDEGEN_PROGRAM_ID_STR);
      const batchIdBuffer = writeUInt64LE(id);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("batch"), Buffer.from(batchIdBuffer)],
        programId,
      );
      setBatchPda(pda);
      addLog(`Batch PDA: ${pda.toBase58()}`);

      const accountInfo = await connection.getAccountInfo(pda);
      if (!accountInfo) throw new Error("Account not found. Check batch ID and network.");

      if (!uint8ArrayEqual(accountInfo.data.slice(0, 8), BATCH_DISCRIMINATOR))
        throw new Error("Account is not a batch.");

      const MIN_BATCH_DATA_LEN = 8 + 256;
      if (accountInfo.data.length < MIN_BATCH_DATA_LEN)
        throw new Error(`Batch account data too short (${accountInfo.data.length} bytes).`);

      const dataBuffer = Buffer.from(accountInfo.data.slice(8));
      let decoded;
      try {
        decoded = BatchLayout.decode(dataBuffer);
      } catch (decodeErr: any) {
        throw new Error(`Failed to decode batch: ${decodeErr.message}. Data length: ${dataBuffer.length}.`);
      }

      setBatchData(decoded);
      addLog("Batch loaded successfully.");

      // Check if the connected user has a position account
      if (connected && wallet?.account?.address) {
        const user = new PublicKey(wallet.account.address);
        const [userPosPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("user_position"), pda.toBuffer(), user.toBuffer()],
          programId,
        );
        const posInfo = await connection.getAccountInfo(userPosPda);
        setUserPositionExists(posInfo !== null && posInfo.data.length > 0);
        if (!posInfo) {
          addLog("Warning: You haven't joined this batch yet. Claim will fail without a UserPosition account.");
        }
      }
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!connected || !wallet?.account?.address) {
      setResult({ type: "error", message: "Connect your wallet first." });
      return;
    }

    if (!batchPda || !batchData) {
      setResult({ type: "error", message: "Load batch data first." });
      return;
    }

    if (userPositionExists === false) {
      setResult({ type: "error", message: "You have not joined this batch. No position to claim from." });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = new PublicKey(UNDEGEN_PROGRAM_ID_STR);
      const yieldVaultProgramId = new PublicKey(YIELD_VAULT_PROGRAM_ID_STR);
      const user = new PublicKey(wallet.account.address);
      const mint = new PublicKey(batchData.mint);

      // Derive PDAs – must match the seeds used in the protocol
      const [userPositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), batchPda.toBuffer(), user.toBuffer()],
        programId,
      );
      const userTokenAccount = getAssociatedTokenAddress(user, mint);
      const batchTokenAccount = getAssociatedTokenAddress(batchPda, mint);

      // CORRECT vault_config derivation: ["vault_config", mint]
      const [vaultConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_config"), mint.toBuffer()],
        yieldVaultProgramId,
      );
      const vaultTokenAccount = getAssociatedTokenAddress(vaultConfigPda, mint);
      const vaultPosition = batchData.vault_position;

      addLog(`User: ${user.toBase58()}`);
      addLog(`User Position: ${userPositionPda.toBase58()}`);
      addLog(`Batch Token Account: ${batchTokenAccount.toBase58()}`);
      addLog(`Vault Config: ${vaultConfigPda.toBase58()}`);
      addLog(`Vault Position: ${vaultPosition.toBase58()}`);

      const data = Buffer.from(CLAIM_DISCRIMINATOR);

      const keys = [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: batchPda, isSigner: false, isWritable: true },
        { pubkey: userPositionPda, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: batchTokenAccount, isSigner: false, isWritable: true },
        { pubkey: vaultConfigPda, isSigner: false, isWritable: true },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: vaultPosition, isSigner: false, isWritable: true },
        { pubkey: yieldVaultProgramId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];

      const ix = new TransactionInstruction({ programId, keys, data });
      const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

      const tx = new Transaction().add(cuIx, ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user;

      addLog("Requesting wallet signature...");

      const provider = (window as any).solana;
      if (provider) {
        const signedTx = await provider.signTransaction(tx);
        const sig = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false });
        addLog(`Sent. Signature: ${sig}`);
        await connection.confirmTransaction(sig);
        setResult({ type: "success", message: `Claimed successfully! Tx: ${sig}` });
      } else if (wallet.signTransaction) {
        const signed = await wallet.signTransaction(tx as any);
        const rawTx = signed instanceof Uint8Array ? signed : (signed as any).serialize?.() ?? signed;
        const sig = await connection.sendRawTransaction(rawTx, { skipPreflight: false });
        addLog(`Sent. Signature: ${sig}`);
        await connection.confirmTransaction(sig);
        setResult({ type: "success", message: `Claimed successfully! Tx: ${sig}` });
      } else {
        throw new Error("Wallet does not support signTransaction");
      }
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (batchIdParam) fetchBatch();
  }, [batchIdParam]);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col gap-8 border-x border-border-low px-6 py-12">
        <Header />
        <Link href="/test" className="text-xs text-gray-400 hover:text-gray-200 -mb-4">
          ← Back to Test Hub
        </Link>
        <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-6">
          <h2 className="text-xl font-bold">Claim (Test)</h2>
          <p className="text-sm text-gray-400">
            Load a batch and claim your share of the winnings (or refund). You
            must have previously joined the batch. The contract enforces that
            the batch is settled and you haven't already claimed. Connect your
            wallet to proceed.
          </p>

          {!connected && (
            <p className="text-xs text-yellow-300">
              Connect your wallet (devnet) to claim.
            </p>
          )}

          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Batch ID"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="flex-1 bg-bg1 border border-border-low rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400"
              disabled={loading || !connected}
            />
            <button
              onClick={fetchBatch}
              disabled={loading || !connected || !batchId}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-400 transition disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load Batch"}
            </button>
          </div>

          {batchData && (
            <div className="space-y-4">
              <div className="text-sm text-gray-400 p-3 bg-black/20 rounded-lg border border-border-low">
                <span className="block mb-1">
                  <strong>Batch ID:</strong> {batchData.batch_id.toString()}
                </span>
                <span className="block">
                  <strong>Status:</strong>{" "}
                  <span className="text-emerald-300 font-semibold">
                    {STATUS_NAMES[batchData.statusIdx]}
                  </span>
                </span>
                <span className="block">
                  <strong>Win Prize:</strong> {batchData.win_prize.toString()}
                </span>
                <span className="block">
                  <strong>Outcome:</strong>{" "}
                  {batchData.outcome === null
                    ? "Not set"
                    : batchData.outcome
                      ? "True"
                      : "False"}
                </span>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Bet Terms</h3>
                <div className="grid grid-cols-1 gap-2">
                  {batchData.bet_terms.map((term: any, idx: number) => {
                    const isEmpty = BigInt(term.fixture_id) === BigInt(0);
                    return (
                      <div
                        key={idx}
                        className={`p-3 bg-bg1 rounded-lg border border-border-low ${isEmpty ? "opacity-50" : ""}`}
                      >
                        <span className="text-sm font-semibold text-gray-200">
                          Slot {idx + 1} {isEmpty ? "(empty)" : `– Fixture ${term.fixture_id}`}
                        </span>
                        {!isEmpty && (
                          <p className="text-xs text-gray-400 mt-1">
                            {describeTerm(term)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {userPositionExists === false && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-300">
                  You have not joined this batch. A UserPosition account does
                  not exist for your wallet. Claim will fail.
                </div>
              )}

              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-300">
                The button is enabled once a batch is loaded and your wallet is
                connected. The contract will reject if the batch is not settled,
                or you have not joined, or you already claimed.
              </div>

              <button
                onClick={handleClaim}
                disabled={!batchData || !connected || loading || userPositionExists === false}
                className="w-full mt-4 px-6 py-3 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
              >
                {loading ? "Claiming..." : "Claim"}
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
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2 text-gray-400">Execution Log</h3>
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