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
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as borsh from "@coral-xyz/borsh";
import bs58 from "bs58";
import Header from "@/app/components/Header";
import undegenCoreIdl from "@/app/lib/idl/undegen_core.json";
import yieldVaultIdl from "@/app/lib/idl/yield_vault.json";

const UNDEGEN_PROGRAM_ID = new PublicKey(undegenCoreIdl.address);
const YIELD_VAULT_PROGRAM_ID = new PublicKey(yieldVaultIdl.address);
import { SOLANA_CONFIG } from "@/app/lib/solanaConfig";
const LOOKUP_TABLE_ADDRESS_STR =
  process.env.NEXT_PUBLIC_LOOKUP_TABLE_ADDRESS || "";

const CLAIM_OPERATOR_YIELD_DISCRIMINATOR = new Uint8Array([
  109, 46, 2, 238, 212, 86, 94, 216,
]);

const BATCH_DISCRIMINATOR = new Uint8Array([156, 194, 70, 44, 22, 88, 137, 44]);

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

function writeUInt64LE(value: number | bigint | string): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setBigUint64(
    0,
    BigInt(value),
    true
  );
  return buf;
}

const BetTermLayout = borsh.struct([
  borsh.i64("fixture_id"),
  borsh.u16("period"),
  borsh.u32("stat_a_key"),
  borsh.option(borsh.u32(), "stat_b_key"),
  borsh.option(
    borsh.rustEnum([borsh.struct([], "Add"), borsh.struct([], "Subtract")]),
    "op"
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

export default function ClaimOperatorYield() {
  const searchParams = useSearchParams();
  const batchIdParam = searchParams.get("batchId") || "";
  const [batchId, setBatchId] = useState(batchIdParam);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [batchPda, setBatchPda] = useState<PublicKey | null>(null);
  const [batchData, setBatchData] = useState<any>(null);

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

  const fetchBatch = async () => {
    setLogs([]);
    setBatchPda(null);
    setBatchData(null);
    setResult(null);

    const id = parseInt(batchId);
    if (isNaN(id) || id < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }

    setLoading(true);
    try {
      const connection = new Connection(SOLANA_CONFIG.RPC_URL);
      const programId = UNDEGEN_PROGRAM_ID;
      const batchIdBuffer = writeUInt64LE(id);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("batch"), Buffer.from(batchIdBuffer)],
        programId
      );
      setBatchPda(pda);
      addLog(`Batch PDA: ${pda.toBase58()}`);

      const accountInfo = await connection.getAccountInfo(pda);
      if (!accountInfo) {
        throw new Error("Account not found. Check batch ID and network.");
      }

      if (!uint8ArrayEqual(accountInfo.data.slice(0, 8), BATCH_DISCRIMINATOR)) {
        throw new Error("Account is not a batch.");
      }

      const MIN_BATCH_DATA_LEN = 8 + 256;
      if (accountInfo.data.length < MIN_BATCH_DATA_LEN) {
        throw new Error(
          `Batch account data too short (${accountInfo.data.length} bytes). ` +
            `Expected at least ${MIN_BATCH_DATA_LEN}.`
        );
      }

      const dataBuffer = Buffer.from(accountInfo.data.slice(8));
      let decoded;
      try {
        decoded = BatchLayout.decode(dataBuffer);
      } catch (decodeErr: any) {
        throw new Error(
          `Failed to decode batch: ${decodeErr.message}. ` +
            `Data length: ${dataBuffer.length}.`
        );
      }

      setBatchData(decoded);
      addLog("Batch loaded successfully.");
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleClaimOperatorYield = async () => {
    if (!batchPda || !batchData) {
      setResult({ type: "error", message: "Load batch data first." });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const connection = new Connection(SOLANA_CONFIG.RPC_URL);
      const programId = UNDEGEN_PROGRAM_ID;
      const yieldVaultProgramId = YIELD_VAULT_PROGRAM_ID;
      const operator = getOperatorKeypair();
      const mint = batchData.mint;

      const operatorTokenAccount = await getAssociatedTokenAddress(
        mint,
        operator.publicKey
      );
      const batchTokenAccount = await getAssociatedTokenAddress(
        mint,
        batchPda,
        true
      );

      // vault_config PDA under yield vault program
      const [vaultConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_config"), mint.toBuffer()],
        yieldVaultProgramId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        vaultConfigPda,
        true
      );

      const vaultPosition = batchData.vault_position;

      addLog(`Operator: ${operator.publicKey.toBase58()}`);
      addLog(`Operator ATA: ${operatorTokenAccount.toBase58()}`);
      addLog(`Batch Token Account: ${batchTokenAccount.toBase58()}`);
      addLog(`Vault Config: ${vaultConfigPda.toBase58()}`);
      addLog(`Vault Position: ${vaultPosition.toBase58()}`);

      const data = Buffer.from(CLAIM_OPERATOR_YIELD_DISCRIMINATOR);

      const keys = [
        { pubkey: operator.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: batchPda, isSigner: false, isWritable: true },
        { pubkey: operatorTokenAccount, isSigner: false, isWritable: true },
        { pubkey: batchTokenAccount, isSigner: false, isWritable: true },
        { pubkey: vaultConfigPda, isSigner: false, isWritable: true },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: vaultPosition, isSigner: false, isWritable: true },
        { pubkey: yieldVaultProgramId, isSigner: false, isWritable: false },
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
      ];

      const ix = new TransactionInstruction({ programId, keys, data });
      const cuIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000,
      });

      const { blockhash } = await connection.getLatestBlockhash();

      const lookupTableAccounts = [];
      if (LOOKUP_TABLE_ADDRESS_STR) {
        const lookupTablePubkey = new PublicKey(LOOKUP_TABLE_ADDRESS_STR);
        const lookupTableRes =
          await connection.getAddressLookupTable(lookupTablePubkey);
        if (lookupTableRes.value) {
          lookupTableAccounts.push(lookupTableRes.value);
        }
      }

      const messageV0 = new TransactionMessage({
        payerKey: operator.publicKey,
        recentBlockhash: blockhash,
        instructions: [cuIx, ix],
      }).compileToV0Message(lookupTableAccounts);

      const tx = new VersionedTransaction(messageV0);
      tx.sign([operator]);

      addLog("Sending claim_operator_yield transaction...");
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

  useEffect(() => {
    if (batchIdParam) fetchBatch();
  }, [batchIdParam]);

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
          <h2 className="text-xl font-bold">Claim Operator Yield (Test)</h2>
          <p className="text-sm text-gray-400">
            Load a batch and claim the operator yield share. The operator must
            be the batch creator and the batch must be settled.
          </p>

          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Batch ID"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="flex-1 bg-bg1 border border-border-low rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400"
              disabled={loading}
            />
            <button
              onClick={fetchBatch}
              disabled={loading || !batchId}
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
                  <strong>Operator Yield BPS:</strong>{" "}
                  {batchData.operator_yield_bps.toString()}
                </span>
                <span className="block">
                  <strong>Total Deposited:</strong>{" "}
                  {batchData.total_deposited.toString()}
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
                          Slot {idx + 1}{" "}
                          {isEmpty ? "(empty)" : `– Fixture ${term.fixture_id}`}
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

              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-300">
                The button is enabled once the batch is loaded. The contract
                enforces that the batch is settled and the caller is the
                operator of the batch.
              </div>

              <button
                onClick={handleClaimOperatorYield}
                disabled={!batchData || loading}
                className="w-full mt-4 px-6 py-3 bg-purple-500 text-black font-semibold rounded-lg hover:bg-purple-400 transition disabled:opacity-50"
              >
                {loading ? "Claiming..." : "Claim Operator Yield"}
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
