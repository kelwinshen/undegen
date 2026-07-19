"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
import * as borsh from "@coral-xyz/borsh";
import Header from "@/app/components/Header";
import undegenCoreIdl from "@/app/lib/idl/undegen_core.json";

const UNDEGEN_PROGRAM_ID = new PublicKey(undegenCoreIdl.address);
import { SOLANA_CONFIG } from "@/app/lib/solanaConfig";

const PROPOSE_MATCH_DISCRIMINATOR = Buffer.from([
  148, 147, 248, 246, 13, 197, 75, 93,
]);
const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);

const COMPARISON = {
  GreaterThan: 0,
  LessThan: 1,
  EqualTo: 2,
};

const BINARY_OP = {
  Add: 0,
  Subtract: 1,
};

// Base Keys for TxLINE stats
const BASE_KEY_PART1_GOALS = 1;
const BASE_KEY_PART2_GOALS = 2;

type OddsOption = {
  id: string;
  messageId: string;
  ts: number;
  outcomeIndex: number;
  fixtureId: number;
  participant1: string;
  participant2: string;
  odds: number;
  startTime: number;
  label: string;
  marketType: string;
  outcome: string;
  period: number;
};

type LogEntry = {
  time: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
};

const BatchStatusLayout = borsh.struct([
  borsh.u64("batch_id"),
  borsh.publicKey("operator"),
  borsh.publicKey("mint"),
  borsh.u8("bump"),
  borsh.publicKey("vault_position"),
  borsh.u8("status"),
]);

const BATCH_STATUS_NAMES = [
  "Lobby",
  "Locked",
  "AwaitingCollateral",
  "Active",
  "Settled",
  "Cancelled",
];

function writeUInt64LE(value: bigint | number): Buffer {
  const buffer = Buffer.alloc(8);
  new DataView(buffer.buffer).setBigUint64(0, BigInt(value), true);
  return buffer;
}

function writeInt64LE(value: bigint | number): Buffer {
  const buffer = Buffer.alloc(8);
  new DataView(buffer.buffer).setBigInt64(0, BigInt(value), true);
  return buffer;
}

function writeU16LE(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function writeU32LE(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function writeI32LE(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value, 0);
  return buffer;
}

function writeOptionU32(value: number | null): Buffer {
  if (value === null) return Buffer.alloc(1);
  return Buffer.concat([Buffer.from([1]), writeU32LE(value)]);
}

function writeOptionBinaryOp(value: number | null): Buffer {
  if (value === null) return Buffer.alloc(1);
  return Buffer.concat([Buffer.from([1]), Buffer.from([value])]);
}

const EMPTY_BET_TERMS = Buffer.alloc(22, 0);

function getBetTermsBuffer(
  option: OddsOption
): { data: Buffer; label: string; details: string } | null {
  const type = option.marketType;
  const outcome = option.outcome.toLowerCase();

  // Apply TxODDS period_prefix + base_key logic
  const periodPrefix = option.period ?? 0;
  const statKey1 = periodPrefix + BASE_KEY_PART1_GOALS;
  const statKey2 = periodPrefix + BASE_KEY_PART2_GOALS;

  if (type === "1X2_PARTICIPANT_RESULT") {
    let comparison = COMPARISON.GreaterThan;
    let desc = "";

    if (outcome === "part1" || outcome === "1") {
      comparison = COMPARISON.GreaterThan;
      desc = `${option.participant1} wins`;
    } else if (outcome === "part2" || outcome === "2") {
      comparison = COMPARISON.LessThan;
      desc = `${option.participant2} wins`;
    } else if (outcome === "draw" || outcome === "x") {
      comparison = COMPARISON.EqualTo;
      desc = `Draw`;
    } else {
      return null;
    }

    const data = Buffer.concat([
      writeInt64LE(option.fixtureId),
      writeU16LE(periodPrefix), // Kept for struct layout size matching
      writeU32LE(statKey1), // Encoded Key 1
      writeOptionU32(statKey2), // Encoded Key 2
      writeOptionBinaryOp(BINARY_OP.Subtract),
      writeI32LE(0),
      Buffer.from([comparison]),
      Buffer.from([0]),
    ]);
    return { data, label: option.label, details: desc };
  }

  if (type === "OVERUNDER_PARTICIPANT_GOALS") {
    const match = option.label.match(/([\d.]+)/);
    if (match) {
      const rawLine = parseFloat(match[0]);
      if (rawLine % 0.5 !== 0) return null;

      const isOver = outcome === "over";
      const comparison = isOver ? COMPARISON.GreaterThan : COMPARISON.LessThan;
      const threshold = isOver ? Math.floor(rawLine) : Math.ceil(rawLine);

      const desc = `Total goals ${outcome} ${rawLine}`;
      const data = Buffer.concat([
        writeInt64LE(option.fixtureId),
        writeU16LE(periodPrefix), // Kept for struct layout size matching
        writeU32LE(statKey1), // Encoded Key 1
        writeOptionU32(statKey2), // Encoded Key 2
        writeOptionBinaryOp(BINARY_OP.Add),
        writeI32LE(threshold),
        Buffer.from([comparison]),
        Buffer.from([0]),
      ]);
      return { data, label: option.label, details: desc };
    }
  }

  return null;
}

export default function ProposeMatchTest() {
  const searchParams = useSearchParams();
  const initialBatchId = searchParams.get("batchId") || "";

  const [batchId, setBatchId] = useState(initialBatchId);
  const [loading, setLoading] = useState(false);
  const [kickoffMode, setKickoffMode] = useState("real");
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
    batchId?: string;
  } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [batchPda, setBatchPda] = useState<PublicKey | null>(null);
  const [batchStatus, setBatchStatus] = useState<string>("");
  const [fixtureOptions, setFixtureOptions] = useState<OddsOption[]>([]);
  const [selectedOutcomes, setSelectedOutcomes] = useState<OddsOption[]>([]);

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { time: Date.now(), type, message }]);
  };

  const getOperatorKeypair = (): Keypair => {
    const secretKeyEnv = process.env.NEXT_PUBLIC_OPERATOR_SECRET_KEY;
    if (!secretKeyEnv)
      throw new Error("NEXT_PUBLIC_OPERATOR_SECRET_KEY not set.");
    if (secretKeyEnv.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyEnv)));
    }
    return Keypair.fromSecretKey(bs58.decode(secretKeyEnv));
  };

  const sendTx = async (ix: TransactionInstruction): Promise<string> => {
    const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);
    const signer = getOperatorKeypair();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ix
    );

    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = signer.publicKey;
    tx.sign(signer);
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });
    await connection.confirmTransaction(sig);
    return sig;
  };

  const handleFetch = async () => {
    setLogs([]);
    setBatchPda(null);
    setBatchStatus("");
    setFixtureOptions([]);
    setSelectedOutcomes([]);
    setResult(null);

    const id = parseInt(batchId);
    if (isNaN(id) || id < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }

    setLoading(true);

    try {
      const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);
      const programId = UNDEGEN_PROGRAM_ID;

      const batchIdBuffer = writeUInt64LE(id);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("batch"), batchIdBuffer],
        programId
      );

      const accountInfo = await connection.getAccountInfo(pda);
      if (
        !accountInfo ||
        !accountInfo.data.slice(0, 8).equals(BATCH_DISCRIMINATOR)
      ) {
        throw new Error("Batch not found or not initialized.");
      }

      const batch = BatchStatusLayout.decode(accountInfo.data.slice(8));
      const statusName = BATCH_STATUS_NAMES[batch.status] ?? "Unknown";
      setBatchPda(pda);
      setBatchStatus(statusName);
      addLog("info", `Batch status: ${statusName}`);

      const oddsRes = await fetch("/api/txodds?all=1");
      const oddsData = await oddsRes.json();
      const options: OddsOption[] = oddsData.options || [];

      if (options.length === 0) {
        addLog("warning", `No matches found. ${oddsData || ""}`);
        setResult({ type: "error", message: "No matches found." });
        return;
      }

      const fixtureMap = new Map<number, OddsOption[]>();
      options.forEach((opt) => {
        if (!fixtureMap.has(opt.fixtureId)) fixtureMap.set(opt.fixtureId, []);
        fixtureMap.get(opt.fixtureId)!.push(opt);
      });

      const sortedFixtures = Array.from(fixtureMap.entries()).sort((a, b) => {
        const timeA = a[1][0]?.startTime || 0;
        const timeB = b[1][0]?.startTime || 0;
        return timeA - timeB;
      });

      if (sortedFixtures.length === 0) {
        addLog("error", "No fixtures found.");
        setResult({ type: "error", message: "No fixtures." });
        return;
      }

      const targetFixtureOptions = sortedFixtures[0][1];
      const match = targetFixtureOptions[0];
      addLog(
        "info",
        `Target match: ${match.participant1} vs ${match.participant2} (${match.fixtureId})`
      );

      const supported = targetFixtureOptions
        .filter((o) => getBetTermsBuffer(o) !== null)
        .sort((a, b) => b.odds - a.odds);

      setFixtureOptions(supported);

      const selected = supported.slice(0, Math.min(4, supported.length));
      setSelectedOutcomes(selected);

      addLog(
        "success",
        `Loaded ${supported.length} supported outcomes. Auto-selected ${selected.length}.`
      );
      setResult({ type: "success", message: "Batch and options loaded." });
    } catch (err: any) {
      addLog("error", err.message);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const getKickoffTimestamp = (): bigint => {
    const nowSec = Math.floor(Date.now() / 1000);
    switch (kickoffMode) {
      case "30s":
        return BigInt(nowSec + 30);
      case "1h2m":
        return BigInt(nowSec + 3600 + 120);
      case "30minAgo":
        return BigInt(nowSec - 30 * 60);
      case "yesterday":
        return BigInt(nowSec - 24 * 60 * 60);
      default:
        const startMs = selectedOutcomes[0]?.startTime ?? Date.now();
        return BigInt(Math.floor(startMs / 1000));
    }
  };

  const handlePropose = async () => {
    if (!batchPda || selectedOutcomes.length === 0) {
      addLog("error", "Select at least one outcome.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const kickoffTs = getKickoffTimestamp();
      const betTermsArray: Buffer[] = [];
      const optionsMapping: Record<number, string> = {};
      const timestamps: Record<number, number> = {};
      const slotsMapping: Record<
        number,
        {
          messageId: string;
          ts: number;
          outcomeIndex: number;
          participant1: string;
          participant2: string;
          startTime: number;
          label: string;
          odds: number;
        }
      > = {};

      for (let i = 0; i < selectedOutcomes.length; i++) {
        const opt = selectedOutcomes[i];
        const terms = getBetTermsBuffer(opt);
        if (!terms) throw new Error("Unsupported outcome in selection.");

        betTermsArray.push(terms.data);
        slotsMapping[i] = {
          messageId: opt.messageId || opt.id,
          ts: opt.ts || 0,
          outcomeIndex: opt.outcomeIndex,
          // TXODDS ages a fixture out of its feed once the match starts —
          // these are the only fallback source describeBatchBetTerms has for
          // team names/kickoff/odds once that happens, so they need to be
          // captured now while TXODDS still has the fixture.
          participant1: opt.participant1,
          participant2: opt.participant2,
          startTime: opt.startTime,
          label: opt.label,
          odds: opt.odds,
        };

        optionsMapping[i] = opt.messageId;
        timestamps[i] = opt.ts || 0;
      }

      const fixtureId = selectedOutcomes[0].fixtureId;

      while (betTermsArray.length < 4) {
        betTermsArray.push(EMPTY_BET_TERMS);
      }

      const betTermsData = Buffer.concat(betTermsArray);
      const data = Buffer.concat([
        PROPOSE_MATCH_DISCRIMINATOR,
        betTermsData,
        writeInt64LE(kickoffTs),
      ]);

      const ix = new TransactionInstruction({
        programId: UNDEGEN_PROGRAM_ID,
        keys: [
          {
            pubkey: getOperatorKeypair().publicKey,
            isSigner: true,
            isWritable: false,
          },
          { pubkey: batchPda, isSigner: false, isWritable: true },
        ],
        data,
      });

      const sig = await sendTx(ix);
      addLog(
        "success",
        `Proposed ${selectedOutcomes.length} outcome(s). Tx: ${sig}`
      );

      const redisResponse = await fetch("/api/batch-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: Number(batchId),
          fixtureId,
          slotsMapping,
          optionsMapping,
          timestamps,
        }),
      });

      if (!redisResponse.ok) {
        const errData = await redisResponse.json();
        throw new Error(`Failed to save Redis mapping: ${errData.error}`);
      }

      addLog("success", "Redis mapping saved successfully.");
      setResult({
        type: "success",
        message: `Proposed ${selectedOutcomes.length} outcome(s) and mapped to Redis.`,
        batchId,
      });
    } catch (err: any) {
      addLog("error", err.message);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialBatchId) handleFetch();
  }, [initialBatchId]);

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
          <h2 className="text-xl font-bold">Propose Match (Test)</h2>
          <p className="text-sm text-gray-400">
            Select 1‑4 outcomes for the target match. Selections are mapped and
            stored in Redis.
          </p>

          <div className="flex flex-col gap-3">
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
                onClick={handleFetch}
                disabled={loading || !batchId}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-400 transition disabled:opacity-50"
              >
                {loading ? "Loading..." : "Load Batch"}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">Kickoff time:</span>
              <select
                value={kickoffMode}
                onChange={(e) => setKickoffMode(e.target.value)}
                disabled={loading}
                className="bg-bg1 border border-border-low rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-400"
              >
                <option value="real">Real (from match data)</option>
                <option value="30s">30 seconds from now</option>
                <option value="1h2m">1 hour 2 minutes from now</option>
                <option value="30minAgo">30 minutes ago</option>
                <option value="yesterday">Yesterday</option>
              </select>
            </div>
          </div>

          {batchStatus && (
            <div className="text-xs text-gray-400">
              Status: <span className="text-emerald-300">{batchStatus}</span>
            </div>
          )}

          {fixtureOptions.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Target match:{" "}
                <strong>
                  {fixtureOptions[0].participant1} vs{" "}
                  {fixtureOptions[0].participant2}
                </strong>
              </p>
              <p className="text-xs text-gray-400">
                Real kickoff:{" "}
                {new Date(fixtureOptions[0].startTime).toLocaleString()}
              </p>
              <p className="text-xs text-emerald-400">
                Submitted kickoff:{" "}
                {new Date(
                  Number(getKickoffTimestamp()) * 1000
                ).toLocaleString()}
              </p>
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {fixtureOptions.map((opt) => {
                  const isSelected = selectedOutcomes.some(
                    (s) => s.id === opt.id
                  );
                  return (
                    <label
                      key={opt.id}
                      className={`flex items-center gap-2 p-2 bg-bg1 rounded-lg border cursor-pointer ${
                        isSelected
                          ? "border-emerald-400 bg-emerald-500/10"
                          : "border-border-low"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedOutcomes((prev) => {
                            if (isSelected) {
                              return prev.filter((s) => s.id !== opt.id);
                            } else {
                              if (prev.length >= 4) {
                                addLog(
                                  "warning",
                                  "You can select at most 4 outcomes."
                                );
                                return prev;
                              }
                              return [...prev, opt];
                            }
                          });
                        }}
                        disabled={!isSelected && selectedOutcomes.length >= 4}
                        className="cursor-pointer"
                      />
                      <span className="text-xs">{opt.label}</span>
                      <span className="text-xs text-emerald-300 ml-auto">
                        {opt.odds.toFixed(1)}x
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500">
                Selected: {selectedOutcomes.length}/4
              </p>
              <button
                onClick={handlePropose}
                disabled={loading || !batchPda || selectedOutcomes.length === 0}
                className="w-full px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50"
              >
                {loading
                  ? "Proposing..."
                  : selectedOutcomes.length < 4
                    ? `Propose ${selectedOutcomes.length} Outcome${selectedOutcomes.length > 1 ? "s" : ""} (${4 - selectedOutcomes.length} empty)`
                    : "Propose 4 Outcomes"}
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
              {result.batchId && (
                <div className="mt-2">
                  <Link
                    href={`/test/batch-details?batchId=${result.batchId}`}
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
