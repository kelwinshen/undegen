"use client";

import { useState } from "react";
import Link from "next/link";
import { useWalletConnection } from "@solana/react-hooks";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as borsh from "@coral-xyz/borsh";
import Header from "@/app/components/Header";

import undegenCoreIdl from "@/app/lib/idl/undegen_core.json";

const UNDEGEN_PROGRAM_ID = new PublicKey(undegenCoreIdl.address);
import { SOLANA_CONFIG } from "@/app/lib/solanaConfig";
const BATCH_DISCRIMINATOR = Buffer.from([156, 194, 70, 44, 22, 88, 137, 44]);
const CAST_VOTE_DISCRIMINATOR = Buffer.from([
  20, 212, 15, 189, 69, 180, 69, 151,
]);

type LogEntry = {
  time: number;
  type: "info" | "success" | "error" | "warning";
  message: string;
};

const COMPARISON = { GreaterThan: 0, LessThan: 1, EqualTo: 2 };
const STAT_KEY_PART1_GOALS = 1002;
const STAT_KEY_PART2_GOALS = 1003;

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

const UserPositionLayout = borsh.struct([
  borsh.publicKey("batch"),
  borsh.publicKey("owner"),
  borsh.u64("deposited_amount"),
  borsh.u64("vault_shares"),
  borsh.bool("has_voted"),
  borsh.u8("vote_index"),
]);

function getBetTermsFromOdds(option: any) {
  const type = option.marketType;
  const outcome = option.outcome;
  const period = option.period ?? 0;

  if (type === "1X2_PARTICIPANT_RESULT") {
    let comparison = COMPARISON.GreaterThan;

    if (outcome === "part1") {
      comparison = COMPARISON.GreaterThan;
    } else if (outcome === "part2") {
      comparison = COMPARISON.LessThan;
    } else if (outcome === "draw") {
      comparison = COMPARISON.EqualTo;
    }

    return {
      fixture_id: BigInt(option.fixtureId),
      period: period,
      stat_a_key: STAT_KEY_PART1_GOALS,
      stat_b_key: STAT_KEY_PART2_GOALS,
      op: null,
      predicate_threshold: 0,
      predicate_comparison: comparison,
      negation: false,
    };
  }

  if (type === "OVERUNDER_PARTICIPANT_GOALS") {
    const match = option.label.match(/([\d.]+)/);
    if (match) {
      const rawLine = parseFloat(match[0]);
      if (rawLine % 0.5 !== 0) return null;

      const isOver = outcome === "over";
      const comparison = isOver ? COMPARISON.GreaterThan : COMPARISON.LessThan;
      const threshold = isOver ? Math.floor(rawLine) : Math.ceil(rawLine);

      return {
        fixture_id: BigInt(option.fixtureId),
        period: period,
        stat_a_key: 1004,
        stat_b_key: null,
        op: null,
        predicate_threshold: threshold,
        predicate_comparison: comparison,
        negation: false,
      };
    }
  }

  if (type === "ASIANHANDICAP_PARTICIPANT_GOALS") {
    const match = option.label.match(/Handicap ([+-]?\d+(\.\d+)?)/);
    if (!match) return null;

    const line = parseFloat(match[1]);
    if (line % 0.5 !== 0) return null;

    let comparison: number;
    let threshold: number;

    if (outcome === "part1") {
      threshold = Math.floor(-line);
      comparison = COMPARISON.GreaterThan;
    } else {
      threshold = Math.ceil(-line);
      comparison = COMPARISON.LessThan;
    }

    return {
      fixture_id: BigInt(option.fixtureId),
      period: period,
      stat_a_key: STAT_KEY_PART1_GOALS,
      stat_b_key: STAT_KEY_PART2_GOALS,
      op: { Subtract: {} },
      predicate_threshold: threshold,
      predicate_comparison: comparison,
      negation: false,
    };
  }

  return null;
}

function termsEqual(a: any, b: any) {
  if (!a || !b) return false;
  return (
    a.fixture_id.toString() === b.fixture_id.toString() &&
    a.period === b.period &&
    a.stat_a_key === b.stat_a_key &&
    a.stat_b_key === b.stat_b_key &&
    JSON.stringify(a.op) === JSON.stringify(b.op) &&
    a.predicate_threshold === b.predicate_threshold &&
    a.predicate_comparison === b.predicate_comparison &&
    a.negation === b.negation
  );
}

function predicateText(term: any, team1: string, team2: string): string {
  if (term.fixture_id === BigInt(0)) return "(empty)";
  const periodStr = term.period === 0 ? "Full Time" : "1st Half";
  const comp = term.predicate_comparison;
  const compSymbol = comp === 0 ? ">" : comp === 1 ? "<" : "==";
  const thresh = term.predicate_threshold;
  const neg = term.negation;

  function statName(key: number): string {
    if (key === STAT_KEY_PART1_GOALS) return `${team1} goals`;
    if (key === STAT_KEY_PART2_GOALS) return `${team2} goals`;
    if (key === 1004) return "Total goals";
    return `Stat ${key}`;
  }

  let expr: string;
  if (term.op !== null) {
    const opKey = Object.keys(term.op)[0];
    const a = statName(term.stat_a_key);
    const b = statName(term.stat_b_key);
    if (opKey === "Add") {
      expr = `(${a} + ${b})`;
    } else if (opKey === "Subtract") {
      expr = `(${a} - ${b})`;
    } else {
      expr = `(${a} ${opKey} ${b})`;
    }
  } else {
    expr = statName(term.stat_a_key);
  }

  let predicate = `${expr} ${compSymbol} ${thresh}`;
  if (neg) predicate = `NOT (${predicate})`;
  return `${predicate} (${periodStr})`;
}

export default function CastVoteTest() {
  const { wallet, status } = useWalletConnection();
  const connected = status === "connected";
  const userPubkey = wallet?.account.address
    ? new PublicKey(wallet.account.address)
    : null;

  const [batchId, setBatchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [batchPda, setBatchPda] = useState<PublicKey | null>(null);
  const [voteWeights, setVoteWeights] = useState<bigint[]>([]);
  const [proposals, setProposals] = useState<
    {
      label: string;
      matchText: string;
      kickoff: string;
      weight: bigint;
      multiplier: string;
      oddsLabel: string;
      percentage: number;
    }[]
  >([]);
  const [userDeposited, setUserDeposited] = useState<bigint | null>(null);
  const [userHasVoted, setUserHasVoted] = useState(false);
  const [userVotedIndex, setUserVotedIndex] = useState<number | null>(null);

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { time: Date.now(), type, message }]);
  };

  const fetchBatch = async () => {
    setLogs([]);
    setBatchPda(null);
    setVoteWeights([]);
    setProposals([]);
    setUserDeposited(null);
    setUserHasVoted(false);
    setUserVotedIndex(null);

    if (!connected || !userPubkey) {
      setResult({ type: "error", message: "Connect your wallet first." });
      return;
    }

    const id = parseInt(batchId);
    if (isNaN(id) || id < 0) {
      setResult({ type: "error", message: "Invalid batch ID" });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);
      const programId = UNDEGEN_PROGRAM_ID;

      const batchIdBuffer = Buffer.alloc(8);
      new DataView(batchIdBuffer.buffer).setBigUint64(0, BigInt(id), true);

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
      setBatchPda(pda);

      const decodedBatch = BatchLayout.decode(accountInfo.data.slice(8));
      const weights: bigint[] = decodedBatch.vote_weights;
      setVoteWeights(weights);

      const totalWeightNum = Number(
        weights.reduce((sum, w) => sum + w, BigInt(0))
      );

      const [userPositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), pda.toBuffer(), userPubkey.toBuffer()],
        programId
      );

      const userPosInfo = await connection.getAccountInfo(userPositionPda);
      if (userPosInfo && userPosInfo.data.length >= 8) {
        try {
          const pos = UserPositionLayout.decode(userPosInfo.data.slice(8));
          setUserDeposited(pos.deposited_amount);
          setUserHasVoted(pos.has_voted);
          setUserVotedIndex(pos.vote_index);

          addLog(
            "info",
            `User deposit: ${pos.deposited_amount.toString()}, voted: ${pos.has_voted}, index: ${pos.vote_index}`
          );

          if (pos.has_voted && pos.vote_index < 5) {
            const votedWeight = weights[pos.vote_index];
            addLog(
              "info",
              `Your voted index [${pos.vote_index}] weight: ${votedWeight.toString()}`
            );
            if (votedWeight < pos.deposited_amount) {
              addLog(
                "warning",
                `Vote weight mismatch! The weight at index ${pos.vote_index} is ${votedWeight} but your deposit is ${pos.deposited_amount}.`
              );
            }
          }
        } catch (e) {
          addLog("warning", "Failed to decode user position.");
        }
      } else {
        addLog("warning", "User position not found.");
      }

      const oddsRes = await fetch("/api/txodds?all=1");
      const oddsData = await oddsRes.json();
      const options: any[] = oddsData.options || [];
      const matchMap = new Map<
        number,
        { participant1: string; participant2: string; startTime: number }
      >();

      options.forEach((opt: any) => {
        if (!matchMap.has(opt.fixtureId)) {
          matchMap.set(opt.fixtureId, {
            participant1: opt.participant1,
            participant2: opt.participant2,
            startTime: opt.startTime,
          });
        }
      });

      const proposalsList: any[] = [];
      for (let i = 0; i < 4; i++) {
        const term = decodedBatch.bet_terms[i];
        const fixtureId = term.fixture_id;
        const match =
          fixtureId !== BigInt(0) ? matchMap.get(Number(fixtureId)) : null;

        let matchText = "";
        let kickoff = "";
        let predicate = "";
        let multiplier = "—";
        let oddsLabel = "";

        if (fixtureId === BigInt(0)) {
          matchText = "(empty)";
          predicate = "(empty)";
        } else if (match) {
          matchText = `${match.participant1} vs ${match.participant2}`;
          kickoff = new Date(match.startTime).toLocaleString();
          predicate = predicateText(
            term,
            match.participant1,
            match.participant2
          );

          const fixtureOptions = options.filter(
            (o: any) => o.fixtureId === Number(fixtureId)
          );
          for (const opt of fixtureOptions) {
            const candidate = getBetTermsFromOdds(opt);
            if (candidate && termsEqual(candidate, term)) {
              multiplier = opt.odds.toFixed(1) + "x";
              oddsLabel = opt.label;
              break;
            }
          }
        } else {
          matchText = `Fixture ${fixtureId}`;
          predicate = predicateText(term, "Team 1", "Team 2");
        }

        const weight = weights[i] || BigInt(0);
        const percentage =
          totalWeightNum > 0 ? (Number(weight) / totalWeightNum) * 100 : 0;

        proposalsList.push({
          label: predicate,
          matchText,
          kickoff,
          weight,
          multiplier,
          oddsLabel,
          percentage,
        });
      }
      setProposals(proposalsList);

      addLog("success", "Batch loaded");
      setResult({ type: "success", message: "Batch loaded." });
    } catch (err: any) {
      addLog("error", err.message);
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (index: number) => {
    if (!connected || !userPubkey || !batchPda) return;

    setLoading(true);
    setResult(null);

    try {
      const connection = new Connection(SOLANA_CONFIG.RPC_URL, SOLANA_CONFIG.COMMITMENT);
      const programId = UNDEGEN_PROGRAM_ID;

      const [userPositionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_position"),
          batchPda.toBuffer(),
          userPubkey.toBuffer(),
        ],
        programId
      );

      const data = Buffer.concat([
        CAST_VOTE_DISCRIMINATOR,
        Buffer.from([index]),
      ]);

      const keys = [
        { pubkey: userPubkey, isSigner: true, isWritable: true },
        { pubkey: batchPda, isSigner: false, isWritable: true },
        { pubkey: userPositionPda, isSigner: false, isWritable: true },
      ];

      const ix = new TransactionInstruction({ programId, keys, data });
      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = userPubkey;

      addLog("info", "Requesting wallet signature...");

      const provider = (window as any).solana;
      if (provider) {
        const signedTx = await provider.signTransaction(tx);
        const sig = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: false,
        });
        addLog("info", `Sent. Signature: ${sig}`);
        await connection.confirmTransaction(sig);
        addLog("success", "Confirmed");
        setResult({
          type: "success",
          message: `Voted for index ${index}. Tx: ${sig}`,
        });
        await fetchBatch();
      } else if (wallet?.signTransaction) {
        await wallet.signTransaction(tx as any);
        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
        });
        addLog("info", `Sent. Signature: ${sig}`);
        await connection.confirmTransaction(sig);
        addLog("success", "Confirmed");
        setResult({
          type: "success",
          message: `Voted for index ${index}. Tx: ${sig}`,
        });
        await fetchBatch();
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
        <Link
          href="/test"
          className="text-xs text-gray-400 hover:text-gray-200 -mb-4"
        >
          ← Back to Test Hub
        </Link>
        <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-6">
          <h2 className="text-xl font-bold">Cast Vote (Test)</h2>
          <p className="text-sm text-gray-400">
            Connect your wallet, load a batch, and vote for one of the proposals
            or skip.
          </p>
          {!connected && (
            <p className="text-xs text-yellow-300">
              Connect your wallet (devnet) to vote.
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

          {userDeposited !== null && (
            <div className="p-3 bg-bg1 rounded-lg border border-border-low text-xs text-gray-400 space-y-1">
              <p>
                Your deposit:{" "}
                <span className="text-emerald-300">
                  {userDeposited.toString()} raw units
                </span>
              </p>
              {userHasVoted && (
                <p>
                  You have already voted for index{" "}
                  <span className="text-emerald-300">{userVotedIndex}</span>
                </p>
              )}
              {userDeposited === BigInt(0) && (
                <p className="text-yellow-300">
                  You must deposit USDC using <strong>Join Batch</strong> before
                  your vote carries weight.
                </p>
              )}
            </div>
          )}

          {proposals.length > 0 && (
            <div className="space-y-2">
              {proposals.slice(0, 4).map((proposal, idx) => {
                const isMyVote = userHasVoted && userVotedIndex === idx;
                return (
                  <div
                    key={idx}
                    className={`p-4 bg-bg1 rounded-lg border space-y-2 ${
                      isMyVote
                        ? "border-emerald-400 ring-1 ring-emerald-400/30"
                        : "border-border-low"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">
                            [{idx}] {proposal.matchText}
                          </p>
                          {isMyVote && (
                            <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-medium">
                              You voted
                            </span>
                          )}
                        </div>
                        {proposal.kickoff && (
                          <p className="text-xs text-gray-400">
                            {proposal.kickoff}
                          </p>
                        )}
                        <p className="text-sm text-emerald-300 mt-1">
                          {proposal.oddsLabel || proposal.label}
                        </p>
                        {proposal.multiplier !== "—" && (
                          <span className="inline-block mt-1 px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs rounded-full">
                            {proposal.multiplier}
                          </span>
                        )}
                      </div>
                      <div className="text-right ml-4">
                        <span className="text-xs text-gray-400 block">
                          {proposal.percentage.toFixed(1)}%
                        </span>
                        <div className="w-24 bg-gray-700 rounded-full h-1.5 mt-1">
                          <div
                            className="bg-emerald-400 h-1.5 rounded-full"
                            style={{
                              width: `${Math.min(proposal.percentage, 100)}%`,
                            }}
                          />
                        </div>
                        <button
                          onClick={() => handleVote(idx)}
                          disabled={loading || isMyVote}
                          className="mt-2 px-3 py-1 bg-emerald-500 text-black text-xs font-semibold rounded hover:bg-emerald-400 transition disabled:opacity-50"
                        >
                          {isMyVote ? "Voted" : "Vote"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div
                className={`p-4 bg-bg1 rounded-lg border flex justify-between items-center ${
                  userHasVoted && userVotedIndex === 4
                    ? "border-emerald-400 ring-1 ring-emerald-400/30"
                    : "border-border-low"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">[4] Skip this match</p>
                    {userHasVoted && userVotedIndex === 4 && (
                      <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-medium">
                        You voted
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">Don't place any bet</p>
                </div>
                <div className="text-right ml-4">
                  <span className="text-xs text-gray-400 block">
                    {(() => {
                      const totalWeightNum = Number(
                        voteWeights.reduce((sum, w) => sum + w, BigInt(0))
                      );
                      const skipWeightNum = Number(voteWeights[4] ?? BigInt(0));
                      const pct =
                        totalWeightNum > 0
                          ? (skipWeightNum / totalWeightNum) * 100
                          : 0;
                      return `${pct.toFixed(1)}%`;
                    })()}
                  </span>
                  <button
                    onClick={() => handleVote(4)}
                    disabled={loading || (userHasVoted && userVotedIndex === 4)}
                    className="mt-2 px-3 py-1 bg-red-500/20 text-red-400 text-xs font-semibold rounded hover:bg-red-500/30 transition disabled:opacity-50"
                  >
                    {userHasVoted && userVotedIndex === 4 ? "Voted" : "Skip"}
                  </button>
                </div>
              </div>
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
