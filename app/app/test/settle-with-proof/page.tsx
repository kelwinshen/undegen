"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as borsh from "@coral-xyz/borsh";
import bs58 from "bs58";
import Header from "@/app/components/Header";
import undegenCoreIdl from "@/app/lib/idl/undegen_core.json";
import yieldVaultIdl from "@/app/lib/idl/yield_vault.json";

const UNDEGEN_PROGRAM_ID = new PublicKey(undegenCoreIdl.address);
const ALT_ADDRESS_STR = "9iTNvzhM6opWF1BPA84Qx39Py2EFTVLXtmojp1d9NJSv";
const DEVNET_RPC = "https://api.devnet.solana.com";
const TXODDS_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const YIELD_VAULT_PROGRAM_ID = new PublicKey(yieldVaultIdl.address);

const SETTLE_WITH_PROOF_DISCRIMINATOR = Buffer.from([37, 77, 147, 139, 128, 174, 33, 158]);
const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);

// ---- BORSH LAYOUTS ----
const BinaryOpLayout = borsh.rustEnum([
  borsh.struct([], "Add"),
  borsh.struct([], "Subtract"),
]);

const BetTermLayout = borsh.struct([
  borsh.i64("fixture_id"),
  borsh.u16("period"),
  borsh.u32("stat_a_key"),
  borsh.option(borsh.u32(), "stat_b_key"),
  borsh.option(BinaryOpLayout, "op"),
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

// ---- SERIALISATION HELPERS ----
function writeUInt64LE(value: number | bigint | string): Buffer {
  const buf = Buffer.alloc(8);
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setBigUint64(0, BigInt(value), true);
  return buf;
}
function writeInt64LE(value: number | bigint | string): Buffer {
  const buf = Buffer.alloc(8);
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setBigInt64(0, BigInt(value), true);
  return buf;
}
function writeUInt32LE(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}
function writeInt32LE(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(value);
  return b;
}
function serializeProofVec(proofs: any[]): Buffer {
  if (!proofs || proofs.length === 0) return Buffer.alloc(4, 0);
  const parts = proofs.map((p) => {
    let hashBuf: Buffer = Array.isArray(p.hash) ? Buffer.from(p.hash) : Buffer.from(p.hash, "base64");
    if (hashBuf.length !== 32) throw new Error("Proof hash must be 32 bytes");
    const isRight = Boolean(p.isRightSibling ?? p.is_right_sibling ?? false);
    return Buffer.concat([hashBuf, Buffer.from([isRight ? 1 : 0])]);
  });
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(proofs.length);
  return Buffer.concat([lengthBuf, ...parts]);
}

function serializeScoresBatchSummary(summary: any): Buffer {
  const updateStats = summary.update_stats;
  const eventsRoot = summary.events_sub_tree_root;
  let rootBuf = Array.isArray(eventsRoot) ? Buffer.from(eventsRoot) : Buffer.from(eventsRoot, "base64");
  if (rootBuf.length !== 32) throw new Error("events_sub_tree_root must be 32 bytes");
  return Buffer.concat([
    writeInt64LE(summary.fixture_id),
    writeInt32LE(updateStats.update_count),
    writeInt64LE(updateStats.min_timestamp),
    writeInt64LE(updateStats.max_timestamp),
    rootBuf,
  ]);
}

function serializeStatTerm(stat: any): Buffer {
  const statToProve = stat.stat_to_prove;
  const eventStatRoot = stat.event_stat_root;
  let rootBuf = Array.isArray(eventStatRoot) ? Buffer.from(eventStatRoot) : Buffer.from(eventStatRoot, "base64");
  if (rootBuf.length !== 32) throw new Error("event_stat_root must be 32 bytes");
  const proof = stat.stat_proof;
  return Buffer.concat([
    writeUInt32LE(statToProve.key),
    writeInt32LE(statToProve.value),
    writeInt32LE(statToProve.period),
    rootBuf,
    serializeProofVec(proof),
  ]);
}

function serializeOptionStatTerm(stat: any | null | undefined): Buffer {
  if (!stat) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), serializeStatTerm(stat)]);
}

function SettleWithProofPageContent() {
  const searchParams = useSearchParams();
  const batchIdParam = searchParams.get("batchId") || "";
  const [batchId, setBatchId] = useState(batchIdParam);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [batchPda, setBatchPda] = useState<PublicKey | null>(null);
  const [batchData, setBatchData] = useState<any>(null);
  const [scoresProof, setScoresProof] = useState<any>(null);
  const [vaultConfigOverride, setVaultConfigOverride] = useState<string>("");
  const [vaultTokenAccountOverride, setVaultTokenAccountOverride] = useState<string>("");

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const getOperatorKeypair = (): Keypair => {
    const secretKeyEnv = process.env.NEXT_PUBLIC_OPERATOR_SECRET_KEY;
    if (!secretKeyEnv) throw new Error("NEXT_PUBLIC_OPERATOR_SECRET_KEY not set.");
    if (secretKeyEnv.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyEnv)));
    }
    return Keypair.fromSecretKey(bs58.decode(secretKeyEnv));
  };

  const fetchBatch = async () => {
    setLogs([]);
    setBatchPda(null);
    setBatchData(null);
    setScoresProof(null);
    setResult(null);
    const id = parseInt(batchId);
    if (isNaN(id) || id < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }
    setLoading(true);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = UNDEGEN_PROGRAM_ID;
      const batchIdBuffer = writeUInt64LE(id);
      const [pda] = PublicKey.findProgramAddressSync([Buffer.from("batch"), batchIdBuffer], programId);
      setBatchPda(pda);
      addLog(`Batch PDA: ${pda.toBase58()}`);
      const accountInfo = await connection.getAccountInfo(pda);
      if (!accountInfo || !accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)) {
        throw new Error("Batch not found or not initialized.");
      }
      const decoded = BatchLayout.decode(accountInfo.data.slice(8));
      setBatchData(decoded);
      addLog("Batch loaded successfully.");
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const fetchScoresProof = async () => {
    if (!batchData) return;
    const winningIdx = batchData.winning_vote_index;
    if (winningIdx === null || winningIdx === undefined) {
      setResult({ type: "error", message: "Winning vote index not set yet." });
      return;
    }
    const betTerm = batchData.bet_terms[winningIdx];
    const fixtureId = betTerm.fixture_id.toString();
    const statKey = betTerm.stat_a_key;
    const statKey2 = betTerm.stat_b_key;
    const period = betTerm.period;

    let url = `/api/scores/validation?fixtureId=${encodeURIComponent(fixtureId)}&statKey=${statKey}&period=${period}`;
    if (statKey2 !== null && statKey2 !== undefined) {
      url += `&statKey2=${statKey2}`;
    }
    addLog(`Fetching scores proof for period ${period}...`);
    setLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }
      const data = await res.json();
      setScoresProof(data);
      if (data.warning) {
        addLog(`Warning: ${data.warning}`);
      }
      addLog(`Scores proof received (seq=${data.seq}, ts=${data.ts}).`);
    } catch (err: any) {
      addLog(`Proof fetch error: ${err.message}`);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const deriveDailyScoresRoots = (timestamp: number): PublicKey => {
    const epochDay = Math.floor(timestamp / 86400000);
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(epochDay);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_roots"), buf],
      TXODDS_PROGRAM_ID,
    );
    return pda;
  };

  const handleSettle = async () => {
    if (!batchPda || !batchData || !scoresProof) {
      setResult({ type: "error", message: "Load batch and proof first." });
      return;
    }

    const ts = scoresProof.fixtureSummary.update_stats.min_timestamp;

    if (isNaN(ts)) {
      setResult({ type: "error", message: "Invalid timestamp." });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const programId = UNDEGEN_PROGRAM_ID;
      const operator = getOperatorKeypair();
      const mint = batchData.mint;

      const operatorTokenAccount = await getAssociatedTokenAddress(mint, operator.publicKey);
      const [collateralPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("collateral"), batchPda.toBuffer()],
        programId,
      );
      const dailyScoresRoots = deriveDailyScoresRoots(ts);

      let vaultConfig: PublicKey;
      if (vaultConfigOverride.trim()) {
        vaultConfig = new PublicKey(vaultConfigOverride.trim());
      } else {
        const [pda] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault_config"), mint.toBuffer()],
          YIELD_VAULT_PROGRAM_ID,
        );
        vaultConfig = pda;
      }
      addLog(`Using vault_config: ${vaultConfig.toBase58()}`);

      let vaultTokenAccount: PublicKey;
      if (vaultTokenAccountOverride.trim()) {
        vaultTokenAccount = new PublicKey(vaultTokenAccountOverride.trim());
      } else {
        vaultTokenAccount = await getAssociatedTokenAddress(mint, vaultConfig, true);
      }
      addLog(`Using vault_token_account: ${vaultTokenAccount.toBase58()}`);

      const vaultPosition = batchData.vault_position;
      addLog(`Using vault_position: ${vaultPosition.toBase58()}`);

      const fixtureSummaryBuf = serializeScoresBatchSummary(scoresProof.fixtureSummary);
      const mainTreeProofBuf = serializeProofVec(scoresProof.mainTreeProof);
      const fixtureProofBuf = serializeProofVec(scoresProof.fixtureProof);
      const statABuf = serializeStatTerm(scoresProof.statA);
      const statBBuf = serializeOptionStatTerm(scoresProof.statB);

      const instructionData = Buffer.concat([
        SETTLE_WITH_PROOF_DISCRIMINATOR,
        fixtureSummaryBuf,
        mainTreeProofBuf,
        fixtureProofBuf,
        statABuf,
        statBBuf,
        writeInt64LE(ts)
      ]);

      addLog(`> Packaged Instruction Size: ${instructionData.length} bytes`);
      addLog(`> TS Submitted: ${ts}`);
      addLog(`> Fixture: ${scoresProof.fixtureSummary.fixture_id}`);
      addLog(`> StatA: Key=${scoresProof.statA.stat_to_prove.key}, Val=${scoresProof.statA.stat_to_prove.value}, Per=${scoresProof.statA.stat_to_prove.period}`);
      if (scoresProof.statB) {
        addLog(`> StatB: Key=${scoresProof.statB.stat_to_prove.key}, Val=${scoresProof.statB.stat_to_prove.value}, Per=${scoresProof.statB.stat_to_prove.period}`);
      } else {
        addLog(`> StatB: None`);
      }

      const keys = [
        { pubkey: operator.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: batchPda, isSigner: false, isWritable: true },
        { pubkey: collateralPda, isSigner: false, isWritable: true },
        { pubkey: operatorTokenAccount, isSigner: false, isWritable: true },
        { pubkey: dailyScoresRoots, isSigner: false, isWritable: false },
        { pubkey: TXODDS_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: vaultConfig, isSigner: false, isWritable: true },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: vaultPosition, isSigner: false, isWritable: true },
        { pubkey: YIELD_VAULT_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];

      const ix = new TransactionInstruction({ programId, keys, data: instructionData });
      
      const altAddress = new PublicKey(ALT_ADDRESS_STR);
      let lookupTableAccount = (await connection.getAddressLookupTable(altAddress, {
        commitment: "confirmed",
      })).value;
      if (!lookupTableAccount) {
        throw new Error(`Lookup table ${altAddress.toBase58()} not found`);
      }

      const candidateAddresses = [
        programId,
        ComputeBudgetProgram.programId,
        ...keys.filter(k => !k.isSigner).map(k => k.pubkey)
      ];
      const uniqueCandidates = Array.from(
        new Set(candidateAddresses.map(p => p.toBase58()))
      ).map(s => new PublicKey(s));

      const existingAddressesSet = new Set(
        lookupTableAccount.state.addresses.map(a => a.toBase58())
      );
      const missingAddresses = uniqueCandidates.filter(
        addr => !existingAddressesSet.has(addr.toBase58())
      );

      if (missingAddresses.length > 0) {
        addLog(`ALT is missing ${missingAddresses.length} addresses. Extending ALT...`);
        const extendInstruction = AddressLookupTableProgram.extendLookupTable({
          payer: operator.publicKey,
          authority: operator.publicKey,
          lookupTable: altAddress,
          addresses: missingAddresses,
        });

        const { blockhash: extendBlockhash } = await connection.getLatestBlockhash("confirmed");
        const extendMessage = new TransactionMessage({
          payerKey: operator.publicKey,
          recentBlockhash: extendBlockhash,
          instructions: [extendInstruction],
        }).compileToV0Message();

        const extendTx = new VersionedTransaction(extendMessage);
        extendTx.sign([operator]);

        const extendSig = await connection.sendRawTransaction(extendTx.serialize(), {
          skipPreflight: false,
        });
        addLog(`ALT extend tx sent: ${extendSig}. Waiting for confirmation...`);
        
        const latestBlockHash = await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction({
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: extendSig,
        }, "confirmed");

        addLog("ALT extended successfully. Waiting 2 seconds for lookup table activation slot...");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const updatedLut = (await connection.getAddressLookupTable(altAddress, {
          commitment: "confirmed",
        })).value;
        if (updatedLut) {
          lookupTableAccount = updatedLut;
          addLog(`Re-loaded ALT. Now contains ${lookupTableAccount.state.addresses.length} addresses.`);
        } else {
          throw new Error("Failed to re-fetch extended ALT");
        }
      } else {
        addLog("All required addresses already present in ALT.");
      }

      const lookupTables = [lookupTableAccount];
      const { blockhash } = await connection.getLatestBlockhash("confirmed");

      const messageV0 = new TransactionMessage({
        payerKey: operator.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ix,
        ],
      }).compileToV0Message(lookupTables);

      addLog(`Compiled V0 Message Size Estimate: ~${messageV0.serialize().length} bytes / 1232 limit`);

      const tx = new VersionedTransaction(messageV0);
      tx.sign([operator]);

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });

      await connection.confirmTransaction(sig);
      setResult({ type: "success", message: `Settled! Tx: ${sig}` });
      addLog(`Success: ${sig}`);
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

  const winningIdx = batchData?.winning_vote_index;
  const winningBetTerm = winningIdx !== null && winningIdx !== undefined ? batchData?.bet_terms[winningIdx] : null;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col gap-8 border-x border-border-low px-6 py-12">
        <Header />
        <Link href="/test" className="text-xs text-gray-400 hover:text-gray-200 -mb-4">
          ← Back to Test Hub
        </Link>
        <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-6">
          <h2 className="text-xl font-bold">Settle With Proof (Auto Resolve)</h2>
          <p className="text-sm text-gray-400">
            The contract evaluates the bet predicate automatically. No outcome input needed. Period is taken from the winning bet term.
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
                <span className="block mb-1"><strong>Batch ID:</strong> {batchData.batch_id.toString()}</span>
                <span className="block"><strong>Status:</strong>{" "}
                  <span className="text-emerald-300 font-semibold">
                    {["Lobby","Locked","AwaitingCollateral","Active","Settled","Cancelled"][batchData.statusIdx]}
                  </span>
                </span>
                <span className="block"><strong>Winning Vote Index:</strong> {winningIdx !== null ? winningIdx : "none"}</span>
                {winningBetTerm && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-500">Winning Bet Term:</p>
                    <pre className="text-xs text-gray-300 mt-1 bg-black/30 p-2 rounded">
                      {JSON.stringify(winningBetTerm, null, 2)}
                    </pre>
                    <div className="mt-2 text-xs text-gray-400">
                      <span className="block">Fixture ID: {winningBetTerm.fixture_id.toString()}</span>
                      <span className="block">Period: {winningBetTerm.period}</span>
                      <span className="block">Stat A Key: {winningBetTerm.stat_a_key}</span>
                      {winningBetTerm.stat_b_key !== null && <span className="block">Stat B Key: {winningBetTerm.stat_b_key}</span>}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={fetchScoresProof}
                disabled={loading || !batchData || winningIdx === null}
                className="px-4 py-2 bg-purple-500 text-white rounded-lg font-semibold hover:bg-purple-400 transition disabled:opacity-50"
              >
                Fetch Scores Proof
              </button>

              {scoresProof && (
                <div className="space-y-4">
                  <div className="p-3 bg-black/30 rounded-lg border border-border-low max-h-48 overflow-y-auto">
                    <pre className="text-xs text-green-300 whitespace-pre-wrap">
                      {JSON.stringify(scoresProof, null, 2)}
                    </pre>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-400">Vault Config (override):</label>
                      <input
                        type="text"
                        value={vaultConfigOverride}
                        onChange={(e) => setVaultConfigOverride(e.target.value)}
                        placeholder="Auto-derived"
                        className="w-full bg-bg1 border border-border-low rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">Vault Token Account (override):</label>
                      <input
                        type="text"
                        value={vaultTokenAccountOverride}
                        onChange={(e) => setVaultTokenAccountOverride(e.target.value)}
                        placeholder="Auto-derived"
                        className="w-full bg-bg1 border border-border-low rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    * Auto‑derived vault_config uses seed <code>["vault_config", mint]</code> from the yield program.
                  </p>

                  <button
                    onClick={handleSettle}
                    disabled={loading}
                    className="w-full mt-4 px-6 py-3 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
                  >
                    {loading ? "Settling..." : "Settle with Proof"}
                  </button>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className={`p-3 rounded-lg text-sm ${
              result.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                : "bg-red-500/10 border border-red-500/30 text-red-300"
            }`}>
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
                        : msg.includes("Success") || msg.includes("success") || msg.includes(">")
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

export default function SettleWithProofPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg1 text-white flex items-center justify-center">Loading...</div>}>
      <SettleWithProofPageContent />
    </Suspense>
  );
}