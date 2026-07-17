"use client";

import React, { useState, useEffect, useMemo } from "react";
import { VoteResult, Option, Fixture } from "@/app/services/undegenProgram";
import MiniCalendar from "./MiniCalendar";

export type { Option, Fixture };

export interface ScoreInfo {
  fixtureId: number;
  status: string;
  participant1: string;
  participant2: string;
  p1Goals: number;
  p2Goals: number;
}

export interface BetTermProposal {
  slotIndex: number;
  term: {
    fixtureId: number;
    period: number;
    statAKey: number;
    statBKey: number | null;
    op: "Add" | "Subtract" | null;
    predicateThreshold: number;
    predicateComparison: number;
    negation: boolean;
  };
  matchText: string;
  kickoff: string;
  // Raw kickoff timestamp (ms) — null when the fixture didn't resolve. Used
  // to drive the same live voting/match-start countdown as resolved fixtures.
  kickoffTime: number | null;
  predicate: string;
  multiplier: string;
  oddsLabel: string;
}

interface ConsensusVotingProps {
  isLoading: boolean;
  fixtures: Fixture[];
  userVotes: Record<number, string>;
  setUserVotes: (votes: Record<number, string>) => void;
  simulatedVotes: Record<string, number>;
  matchDecisions: Record<number, VoteResult>; // <-- Updated type
  remainingBets: number;
  weeklyYieldPool: number;
  batchWeek?: string;
  overrideLiveScores?: Record<number, ScoreInfo>;
  isEnded?: boolean;
  canVote?: boolean;
  // Human-readable version of this batch's raw bet_terms — shown when there's
  // no resolved fixture yet, so a real proposed match is never silently
  // invisible, and never shown as bare on-chain numbers either.
  betTermProposals?: BetTermProposal[];
  // Casts a vote directly by on-chain slot index (0-3) — used for
  // betTermProposals, which already know their slot and don't need the
  // fixtureId/optionId -> index resolution the main voting flow uses.
  onVoteSlot?: (slotIndex: number) => Promise<void>;
  // Real on-chain UserPosition.vote_index (0-3 = a bet_terms slot, 4 = skip,
  // null if they haven't voted) — so "already voted" reflects the chain, not
  // just this browser session.
  userVotedIndex?: number | null;
  // Real on-chain BatchState.vote_weights — [bet0, bet1, bet2, bet3, skip] —
  // used to show weight-based percentages and the current leader for
  // betTermProposals, before a match has resolved into a Fixture.
  voteWeights?: number[];
  // True once this batch's on-chain status has moved past Locked — either
  // AwaitingCollateral (finalize_consensus ran, operator hasn't deposited
  // collateral yet) or Active (collateral deposited, bet is live). Voting is
  // over in both cases, not merely paused, so the vote UI is replaced with
  // the decided outcome instead of staying disabled.
  isVotingCompleted?: boolean;
  // True specifically when the on-chain status is Active (collateral already
  // deposited) — a sharper sub-state of isVotingCompleted, used only to pick
  // the right header wording ("Active" instead of "Voting is ended").
  isActive?: boolean;
  // Real on-chain BatchState.winning_vote_index (0-3 = a bet_terms slot, 4 =
  // skip, null if consensus hasn't locked yet) — the definitive decided slot
  // once isVotingCompleted is true, used instead of raw weight-leader math.
  winningVoteIndex?: number | null;
  // Real on-chain BatchState.batchStartTime (kickoff_timestamp, ms) for the
  // batch's current bet — set directly on the batch account, so it's always
  // available even when TXODDS fixture matching fails to resolve a live
  // option (leaving BetTermProposal.kickoffTime null). Preferred source for
  // every countdown in this component; 0 once the bet has settled and the
  // on-chain field resets.
  matchStartTime?: number;
  // Real cumulative BatchState.winsCount + lossesCount — actual matches
  // decided (not skipped) across the batch's whole lifetime. Drives the
  // "Accepted Predictions" counter; falls back to remainingBets-derived
  // total (which includes skips) if not provided.
  realAcceptedCount?: number;
  // Real cumulative BatchState.skipsCount — actual skips across the batch's
  // whole lifetime, not just whichever single bet is currently in flight.
  skippedCount?: number;
  // Calls the real `settle_default` instruction for this batch — settles the
  // current bet as a default user-win once the operator has gone silent past
  // the proof deadline. Callable by anyone, not just the depositor.
  onSettleDefault?: () => Promise<void>;
}

const MAX_WEEKLY_BETS = 5;
// How long past kickoff before "get default result" becomes available —
// gives the operator a real window to submit proof before anyone can force
// a default settlement, without waiting on the full on-chain proof_deadline.
const SETTLE_DEFAULT_AFTER_MS = 4 * 60 * 60 * 1000;
const TOP_PER_MATCH = 3;
// Voting closes this long before kickoff, not at kickoff itself — gives the
// operator a window to lock consensus and deposit collateral before the
// match actually starts.
const VOTE_CUTOFF_MS = 60 * 60 * 1000;

function formatStartTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function formatCountdown(diffMs: number): string {
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Two-stage countdown: "Voting ends in..." counts down to kickoff minus
// VOTE_CUTOFF_MS; once that passes, it switches to "Match starts in..."
// counting down to actual kickoff, until the match itself has started.
function formatVotingDeadline(startTimeMs: number, nowMs: number): string {
  const voteDeadline = startTimeMs - VOTE_CUTOFF_MS;
  if (nowMs < voteDeadline) return `Voting ends in ${formatCountdown(voteDeadline - nowMs)}`;
  if (nowMs < startTimeMs) return `Match starts in ${formatCountdown(startTimeMs - nowMs)}`;
  return "Voting closed";
}

// Used once voting is already decided (AwaitingCollateral) — always counts
// down to kickoff, skipping the "Voting ends in..." stage since consensus
// has already locked regardless of where the time-based cutoff sits.
function formatMatchCountdown(startTimeMs: number, nowMs: number): string {
  const diff = startTimeMs - nowMs;
  return diff > 0 ? `Match starts in ${formatCountdown(diff)}` : "Waiting for The Result";
}

function getFlagEmoji(name: string): string {
  const flags: Record<string, string> = {
    spain: "🇪🇸",
    belgium: "🇧🇪",
    germany: "🇩🇪",
    france: "🇫🇷",
    italy: "🇮🇹",
    england: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    portugal: "🇵🇹",
    netherlands: "🇳🇱",
    croatia: "🇭🇷",
    switzerland: "🇨🇭",
    denmark: "🇩🇰",
    sweden: "🇸🇪",
    poland: "🇵🇱",
    ukraine: "🇺🇦",
    austria: "🇦🇹",
    turkey: "🇹🇷",
    czechia: "🇨🇿",
    hungary: "🇭🇺",
    scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
    ireland: "🇮🇪",
    slovakia: "🇸🇰",
    slovenia: "🇸🇮",
    romania: "🇷🇴",
    bulgaria: "🇧🇬",
    greece: "🇬🇷",
    finland: "🇫🇮",
    norway: "🇳🇴",
    serbia: "🇷🇸",
    albania: "🇦🇱",
    georgia: "🇬🇪",
    usa: "🇺🇸",
    canada: "🇨🇦",
    mexico: "🇲🇽",
    brazil: "🇧🇷",
    argentina: "🇦🇷",
    uruguay: "🇺🇾",
    colombia: "🇨🇴",
    chile: "🇨🇱",
    morocco: "🇲🇦",
  };
  const lower = name.toLowerCase();
  const matchedKey = Object.keys(flags).find((key) => lower.includes(key));
  return matchedKey ? flags[matchedKey] : "";
}

function confidenceLabel(ratio: number): { text: string; color: string } {
  if (ratio >= 0.7)
    return { text: "Very High", color: "text-foreground font-semibold" };
  if (ratio >= 0.5)
    return { text: "High", color: "text-foreground" };
  if (ratio >= 0.3)
    return { text: "Medium", color: "text-amber-600 dark:text-yellow-400" };
  return { text: "Low", color: "text-red-600 dark:text-red-400" };
}

export default function ConsensusVoting({
  isLoading,
  fixtures,
  userVotes,
  setUserVotes,
  simulatedVotes,
  matchDecisions,
  remainingBets,
  weeklyYieldPool,
  batchWeek = "Current Week",
  overrideLiveScores,
  isEnded = false,
  canVote = true,
  betTermProposals = [],
  onVoteSlot,
  userVotedIndex = null,
  voteWeights,
  isVotingCompleted = false,
  isActive = false,
  winningVoteIndex = null,
  matchStartTime,
  realAcceptedCount,
  skippedCount,
  onSettleDefault,
}: ConsensusVotingProps) {
  const [now, setNow] = useState(() => Date.now());
  const [expandedFixtureIds, setExpandedFixtureIds] = useState<Set<number>>(
    new Set()
  );
  const [chosenVotes, setChosenVotes] = useState<Record<number, string>>({});
  const [chosenSlot, setChosenSlot] = useState<number | null>(null);
  const [votingSlot, setVotingSlot] = useState<number | null>(null);
  // Single value, not a Set — vote_index on-chain only ever holds one slot at
  // a time (cast_vote switches it, it doesn't accumulate), so tracking it as
  // a growing set here would leave every option you've ever picked stuck
  // "Voted" and permanently unselectable instead of just your current choice.
  const [votedSlot, setVotedSlot] = useState<number | null>(null);
  const [slotVoteError, setSlotVoteError] = useState<string | null>(null);
  const [settlingDefault, setSettlingDefault] = useState(false);
  const [settleDefaultError, setSettleDefaultError] = useState<string | null>(null);

  // Seed from the real on-chain vote, not just this session's local state —
  // otherwise a reload forgets you already voted and lets you "vote" again
  // (harmless on-chain since cast_vote allows switching, but confusing UI).
  useEffect(() => {
    setVotedSlot(userVotedIndex);
    setChosenSlot(userVotedIndex);
  }, [userVotedIndex]);
  const [fetchedScores, setFetchedScores] = useState<Record<number, ScoreInfo>>(
    {}
  );
  const activeScores = overrideLiveScores || fetchedScores;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Initialize selectedDate to today if matches exist today
  useEffect(() => {
    if (fixtures.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const hasMatchesToday = fixtures.some(
      (f) => new Date(f.startTime).toISOString().slice(0, 10) === today
    );
    const targetDate = hasMatchesToday ? today : null;
    const timer = setTimeout(() => {
      setSelectedDate(targetDate);
    }, 0);
    return () => clearTimeout(timer);
  }, [fixtures]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (overrideLiveScores) return;
    if (fixtures.length === 0) return;
    const fixtureIds = fixtures.map((f) => f.fixtureId).join(",");
    const fetchScores = async () => {
      try {
        const res = await fetch(`/api/scores?fixtureIds=${fixtureIds}`);
        const data = await res.json();
        const map: Record<number, ScoreInfo> = {};
        (data.scores || []).forEach((s: ScoreInfo) => {
          map[s.fixtureId] = s;
        });
        setFetchedScores(map);
      } catch {}
    };
    fetchScores();
    const interval = setInterval(fetchScores, 30000);
    return () => clearInterval(interval);
  }, [fixtures, overrideLiveScores]);

  // Total slots used so far (real matches + skips) — derived from the real
  // on-chain remainingBets prop, not matchDecisions (which only ever holds
  // the single currently in-flight bet's decision, so it could never
  // reflect the batch's true cumulative progress).
  const totalAcceptedBets = MAX_WEEKLY_BETS - remainingBets;
  // "Accepted Predictions" means real matches only, not skips — falls back
  // to the total (old behavior) if the real cumulative count wasn't passed in.
  const acceptedBetsCount = realAcceptedCount ?? totalAcceptedBets;
  const skippedMatchesCount = skippedCount ?? 0;
  const remainingCapacity = remainingBets;
  const allocatedBudget =
    (totalAcceptedBets / MAX_WEEKLY_BETS) * weeklyYieldPool;
  const remainingBudget = weeklyYieldPool - allocatedBudget;
  const perBetAllocation =
    totalAcceptedBets > 0 ? allocatedBudget / totalAcceptedBets : 0;

  const displayFixtures = useMemo(
    () =>
      fixtures.map((f) => ({
        ...f,
        options: [...f.options]
          .sort((a, b) => b.odds - a.odds)
          .slice(0, TOP_PER_MATCH),
      })),
    [fixtures]
  );

  const filteredFixtures = useMemo(() => {
    if (!selectedDate) return displayFixtures;
    return displayFixtures.filter((f) => {
      const dateStr = new Date(f.startTime).toISOString().slice(0, 10);
      return dateStr === selectedDate;
    });
  }, [displayFixtures, selectedDate]);

  const handleVote = (fixtureId: number, optionId: string) => {
    if (isEnded || !canVote || isVotingCompleted) return;
    const fixture = fixtures.find((f) => f.fixtureId === fixtureId);
    if (fixture && fixture.startTime - VOTE_CUTOFF_MS <= now) return;
    setUserVotes({ ...userVotes, [fixtureId]: optionId });
  };

  const handleChoose = (fixtureId: number, optionId: string) => {
    if (isEnded || !canVote || isVotingCompleted) return;
    const fixture = fixtures.find((f) => f.fixtureId === fixtureId);
    if (fixture && fixture.startTime - VOTE_CUTOFF_MS <= now) return;
    setChosenVotes((prev) => ({ ...prev, [fixtureId]: optionId }));
  };

  const handleVoteSlot = async (slotIndex: number) => {
    if (isEnded || !canVote || isVotingCompleted || !onVoteSlot || votingSlot !== null) return;
    setSlotVoteError(null);
    setVotingSlot(slotIndex);
    try {
      await onVoteSlot(slotIndex);
      setVotedSlot(slotIndex);
    } catch (e: any) {
      setSlotVoteError(e?.message || "Vote failed.");
    } finally {
      setVotingSlot(null);
    }
  };

  const handleSettleDefault = async () => {
    if (!onSettleDefault || settlingDefault) return;
    setSettleDefaultError(null);
    setSettlingDefault(true);
    try {
      await onSettleDefault();
    } catch (e: any) {
      setSettleDefaultError(e?.message || "Settlement failed.");
    } finally {
      setSettlingDefault(false);
    }
  };

  const toggleExpanded = (fixtureId: number) => {
    setExpandedFixtureIds((prev) => {
      const next = new Set(prev);
      if (next.has(fixtureId)) {
        next.delete(fixtureId);
      } else {
        next.add(fixtureId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 rounded-2xl backdrop-blur-sm border border-border-low animate-pulse">
        <div className="h-5 w-32 bg-gray-700 rounded mb-4" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-gray-800 rounded mb-3" />
        ))}
      </div>
    );
  }

  if (!fixtures.length) {
    // The batch account's own kickoff_timestamp is the authoritative source
    // — always present, unlike BetTermProposal.kickoffTime which is null
    // whenever TXODDS fixture matching fails to resolve a live option. Fall
    // back to scanning proposals only if the batch-level value isn't set.
    const sharedKickoffTime =
      matchStartTime && matchStartTime > 0
        ? matchStartTime
        : (betTermProposals.find((p) => p.kickoffTime != null)?.kickoffTime ?? null);
    return (
      <div className="p-6 rounded-2xl backdrop-blur-sm border border-border-low text-center space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-2">
            {isVotingCompleted
              ? isActive
                ? "Active"
                : "Voting is ended"
              : betTermProposals.length > 0
                ? "Match proposed"
                : "No upcoming voting opportunities"}
          </h2>
          <p className="text-gray-400">
            {isVotingCompleted
              ? sharedKickoffTime != null
                ? formatMatchCountdown(sharedKickoffTime, now)
                : "The match will be starting soon."
              : betTermProposals.length > 0
                ? sharedKickoffTime != null
                  ? formatVotingDeadline(sharedKickoffTime, now)
                  : ""
                : "The syndicate is waiting for the next TXODDS fixture batch."}
          </p>
        </div>

        {isActive &&
          onSettleDefault &&
          sharedKickoffTime != null &&
          now - sharedKickoffTime >= SETTLE_DEFAULT_AFTER_MS && (
            <div className="space-y-2">
              <button
                onClick={handleSettleDefault}
                disabled={settlingDefault}
                className="w-full py-2.5 px-4 rounded-lg border border-border-strong text-sm font-bold hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
              >
                {settlingDefault ? "Settling…" : "Get Default Result"}
              </button>
              {settleDefaultError && (
                <p className="text-xs text-red-500">{settleDefaultError}</p>
              )}
            </div>
          )}

        {!canVote && betTermProposals.length > 0 && !isVotingCompleted && (
          <div className="p-3 bg-foreground/5 border border-border-low rounded-lg text-sm text-muted text-left">
            You haven&apos;t joined this batch — viewing only. Stake during a
            batch&apos;s Lobby phase to vote.
          </div>
        )}

        {betTermProposals.length > 0 && (() => {
          // Weight-based standing across every slot, skip included (index 4)
          // — mirrors the resolved-fixture view's percentage/leader math so a
          // proposal that hasn't matched a live option yet still shows real
          // consensus, not just its own odds.
          const weights = voteWeights ?? [];
          const totalWeight = weights.reduce((sum, w) => sum + (w || 0), 0);
          const skipWeight = weights[4] ?? 0;
          let leadingSlot: number | null = null;
          if (!isEnded && totalWeight > 0) {
            let maxWeight = -1;
            for (let i = 0; i < 5; i++) {
              const w = weights[i] ?? 0;
              if (w > maxWeight) {
                maxWeight = w;
                leadingSlot = i;
              }
            }
          }
          const skipId = "__skip__";
          const isSkipVoted = votedSlot === 4;
          const isSkipChosen = chosenSlot === 4;
          const skipDisabled = isEnded || !canVote || isVotingCompleted || isSkipVoted || !onVoteSlot;
          // Once consensus has locked (AwaitingCollateral), the decided slot
          // comes from the real on-chain winner, not raw weight — falls back
          // to leadingSlot only if winningVoteIndex hasn't synced yet.
          const decidedSlot = isVotingCompleted ? (winningVoteIndex ?? leadingSlot) : null;

          return (
          <div className="space-y-2 text-left">
            {betTermProposals.map((proposal) => {
              const isVoted = votedSlot === proposal.slotIndex;
              const isChosen = chosenSlot === proposal.slotIndex;
              const disabled = isEnded || !canVote || isVotingCompleted || isVoted || !onVoteSlot;
              const weight = weights[proposal.slotIndex] ?? 0;
              const percentage = totalWeight > 0 ? (weight / totalWeight) * 100 : 0;
              const isLeading = !isVotingCompleted && leadingSlot === proposal.slotIndex;
              const isWinner = isVotingCompleted && decidedSlot === proposal.slotIndex;
              return (
                <button
                  key={proposal.slotIndex}
                  onClick={() => !disabled && setChosenSlot(isChosen ? null : proposal.slotIndex)}
                  disabled={disabled}
                  className={`w-full text-left p-3 rounded-lg border transition ${
                    disabled
                      ? "border-border-low bg-foreground/[0.01] cursor-not-allowed opacity-70"
                      : isChosen
                        ? "border-foreground bg-foreground/5 cursor-pointer"
                        : "border-border-low hover:border-gray-500 cursor-pointer"
                  } ${isLeading || isWinner ? "shadow-[0_0_12px_rgba(0,0,0,0.05)] dark:shadow-[0_0_12px_rgba(255,255,255,0.15)] border-foreground/30 dark:border-white/40" : ""}`}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{proposal.matchText}</span>
                      {isWinner && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-semibold">
                          Winner
                        </span>
                      )}
                      {isLeading && (
                        <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.5 rounded-full font-semibold border border-border">
                          Leading
                        </span>
                      )}
                      {isVoted && (
                        <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.5 rounded-full font-semibold border border-border">
                          Voted
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">{percentage.toFixed(2)}%</span>
                      {proposal.multiplier !== "—" && (
                        <span className="text-sm font-bold text-foreground">{proposal.multiplier}</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted mt-1">{proposal.predicate}</p>
                  <div className="mt-2 w-full bg-neutral-200 dark:bg-gray-700 rounded-full h-1">
                    <div
                      className={`h-1 rounded-full ${isLeading || isWinner ? "bg-foreground dark:bg-white shadow-[0_0_6px_rgba(0,0,0,0.15)] dark:shadow-[0_0_6px_rgba(255,255,255,0.4)]" : "bg-foreground/20 dark:bg-white/40"}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </button>
              );
            })}

            <button
              key={skipId}
              onClick={() => !skipDisabled && setChosenSlot(isSkipChosen ? null : 4)}
              disabled={skipDisabled}
              className={`w-full text-left p-3 rounded-lg border transition ${
                skipDisabled
                  ? "border-border-low bg-foreground/[0.01] cursor-not-allowed opacity-70"
                  : isSkipChosen
                    ? "border-foreground bg-foreground/5 cursor-pointer"
                    : "border-border-low hover:border-gray-500 cursor-pointer"
              } ${leadingSlot === 4 || decidedSlot === 4 ? "shadow-[0_0_12px_rgba(0,0,0,0.05)] dark:shadow-[0_0_12px_rgba(255,255,255,0.15)] border-foreground/30 dark:border-white/40" : ""}`}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted">Skip this match</span>
                  {decidedSlot === 4 && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-semibold">
                      Winner
                    </span>
                  )}
                  {!isVotingCompleted && leadingSlot === 4 && (
                    <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.5 rounded-full font-semibold border border-border">
                      Leading
                    </span>
                  )}
                  {isSkipVoted && (
                    <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.5 rounded-full font-semibold border border-border">
                      Voted
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted">
                  {totalWeight > 0 ? ((skipWeight / totalWeight) * 100).toFixed(2) : "0.00"}%
                </span>
              </div>
              <div className="mt-2 w-full bg-neutral-200 dark:bg-gray-700 rounded-full h-1">
                <div
                  className={`h-1 rounded-full ${leadingSlot === 4 || decidedSlot === 4 ? "bg-foreground dark:bg-white shadow-[0_0_6px_rgba(0,0,0,0.15)] dark:shadow-[0_0_6px_rgba(255,255,255,0.4)]" : "bg-foreground/20 dark:bg-white/40"}`}
                  style={{ width: `${totalWeight > 0 ? (skipWeight / totalWeight) * 100 : 0}%` }}
                />
              </div>
            </button>

            {!isVotingCompleted && chosenSlot !== null && (
              <button
                onClick={() => handleVoteSlot(chosenSlot)}
                disabled={votingSlot !== null}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-bold transition-all duration-200 active:scale-95 cursor-pointer bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {votingSlot === chosenSlot
                  ? "Casting vote..."
                  : votedSlot !== null
                    ? "Change Vote"
                    : "Vote"}
              </button>
            )}

            {slotVoteError && (
              <div className="p-2.5 rounded-lg text-xs text-center bg-red-500/10 border border-red-500/30 text-red-500">
                {slotVoteError}
              </div>
            )}
          </div>
          );
        })()}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {selectedDate && (
        <div className="flex backdrop-blur-sm  justify-between items-center rounded-2xl border border-border-low p-4">
          <span className="text-sm text-muted">
            Viewing matches for {new Date(selectedDate).toLocaleDateString()}
          </span>
          <button
            onClick={() => setSelectedDate(null)}
            className="text-xs font-semibold bg-foreground/5 hover:bg-foreground/10 px-3 py-1.5 rounded-lg border border-border-low text-muted hover:text-foreground transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
          >
            <span>Show All Matches</span>
          </button>
        </div>
      )}

      <div>
        <div className="p-4 rounded-2xl backdrop-blur-sm border border-border-low space-y-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Accepted Predictions</span>
            <span className="font-mono">
              {acceptedBetsCount} / {MAX_WEEKLY_BETS}
            </span>
          </div>
          <div className="w-full bg-neutral-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-foreground dark:bg-white h-2 rounded-full transition-all shadow-[0_0_6px_rgba(0,0,0,0.15)] dark:shadow-[0_0_6px_rgba(255,255,255,0.4)]"
              style={{
                width: `${(acceptedBetsCount / MAX_WEEKLY_BETS) * 100}%`,
              }}
            />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <span>Skipped: {skippedMatchesCount}</span>
            <span>
              Remaining: {remainingCapacity} prediction
              {remainingCapacity !== 1 ? "s" : ""}
            </span>
            <span>
              Status:{" "}
              {acceptedBetsCount === MAX_WEEKLY_BETS ? "Full" : "Active"}
            </span>
          </div>

          <div className="mt-2">
            <div className="flex justify-between text-xs text-muted mb-1">
              <span>Weekly Treasury Budget</span>
              <span className="font-mono">
                {weeklyYieldPool.toLocaleString()} USDC
              </span>
            </div>
            <div className="w-full bg-neutral-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-foreground dark:bg-white h-2 rounded-full"
                style={{
                  width: `${(allocatedBudget / weeklyYieldPool) * 100}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted mt-1">
              <span>Allocated: {allocatedBudget.toFixed(0)} USDC</span>
              <span>Remaining: {remainingBudget.toFixed(0)} USDC</span>
            </div>
          </div>
        </div>
      </div>

      {!canVote && (
        <div className="p-3 bg-foreground/5 border border-border-low rounded-lg text-sm text-muted">
          You haven&apos;t joined this batch — viewing consensus only. Stake
          during a batch&apos;s Lobby phase to vote.
        </div>
      )}

      {canVote && isVotingCompleted && (() => {
        const kickoffTime =
          matchStartTime && matchStartTime > 0 ? matchStartTime : fixtures[0]?.startTime;
        const canSettleDefault =
          isActive && !!onSettleDefault && kickoffTime != null && now - kickoffTime >= SETTLE_DEFAULT_AFTER_MS;
        return (
          <div className="space-y-2">
            <div className="p-3 bg-foreground/5 border border-border-low rounded-lg text-sm text-foreground">
              {isActive ? "Active" : "Voting is ended"} —{" "}
              {kickoffTime ? formatMatchCountdown(kickoffTime, now) : "the match will be starting soon."}
            </div>
            {canSettleDefault && (
              <>
                <button
                  onClick={handleSettleDefault}
                  disabled={settlingDefault}
                  className="w-full py-2.5 px-4 rounded-lg border border-border-strong text-sm font-bold hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
                >
                  {settlingDefault ? "Settling…" : "Get Default Result"}
                </button>
                {settleDefaultError && (
                  <p className="text-xs text-red-500">{settleDefaultError}</p>
                )}
              </>
            )}
          </div>
        );
      })()}

      {canVote && !isVotingCompleted && remainingBets === 0 && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-amber-600 dark:text-yellow-300">
          Weekly prediction budget exhausted. Remaining fixtures are
          automatically skipped.
        </div>
      )}

      <MiniCalendar
        fixtures={fixtures}
        liveScores={activeScores}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
      />

      {filteredFixtures.length === 0 ? (
        <div className="p-8 rounded-2xl border border-border-low text-center backdrop-blur-sm">
          <p className="text-muted mb-2">No matches scheduled for this date</p>
          <button
            onClick={() => setSelectedDate(null)}
            className="text-xs font-semibold bg-foreground/10 hover:bg-foreground/15 px-3 py-1.5 rounded-lg border border-border text-foreground transition active:scale-95"
          >
            Show All Matches
          </button>
        </div>
      ) : (
        filteredFixtures.map((fixture) => {
          const matchStarted = fixture.startTime <= now;
          const voteDeadlinePassed = fixture.startTime - VOTE_CUTOFF_MS <= now;
          const isVotingClosed = voteDeadlinePassed || isEnded || isVotingCompleted;
          const decision = matchDecisions[fixture.fixtureId];
          const userVoteForMatch = userVotes[fixture.fixtureId];
          const isExpanded = expandedFixtureIds.has(fixture.fixtureId);
          const score = activeScores[fixture.fixtureId];

          const skipId = `${fixture.fixtureId}-skip`;
          const skipVotes = simulatedVotes[skipId] || 0;
          const totalVotes =
            fixture.options.reduce(
              (sum, opt) => sum + (simulatedVotes[opt.id] || 0),
              0
            ) + skipVotes;

          let leaderId: string | null = null;
          let maxVotes = -1;
          if (!isVotingClosed) {
            fixture.options.forEach((opt) => {
              const v = simulatedVotes[opt.id] || 0;
              if (v > maxVotes) {
                maxVotes = v;
                leaderId = opt.id;
              }
            });
            if (skipVotes > maxVotes) {
              leaderId = skipId;
              maxVotes = skipVotes;
            }
          }

          let communityDecisionText = "";
          let communityDecisionOdds = 0;
          let winningOptionForCalc: Option | undefined;
          if (decision) {
            if (decision.isSkip) communityDecisionText = "Skip";
            else {
              winningOptionForCalc = fixture.options.find(
                (o) => o.id === decision.winningOptionId
              );
              if (winningOptionForCalc) {
                communityDecisionText = winningOptionForCalc.label;
                communityDecisionOdds = winningOptionForCalc.odds;
              }
            }
          }

          const votingDeadlineText = formatVotingDeadline(
            fixture.startTime,
            now
          );
          const leadingRatio = totalVotes > 0 ? maxVotes / totalVotes : 0;
          const confidence = confidenceLabel(leadingRatio);

          let settlementStage = "Voting Open";
          if (isVotingClosed && !decision) settlementStage = "Consensus Locked";
          else if (decision && !score) settlementStage = "Awaiting Result";
          else if (score && score.status !== "Finished")
            settlementStage = "Match Live";
          else if (score && score.status === "Finished")
            settlementStage = "Settled";

          const stateBadge = !matchStarted
            ? "Upcoming"
            : score && score.status === "Finished"
              ? "Finished"
              : "Live";

          let treasuryChange = 0;
          let outcomeText = "";
          if (
            decision &&
            decision.accepted &&
            settlementStage === "Settled" &&
            winningOptionForCalc
          ) {
            const won = decision.won ?? false;
            if (won) {
              treasuryChange =
                perBetAllocation * (winningOptionForCalc.odds - 1);
              outcomeText = "Prediction Won";
            } else {
              treasuryChange = -perBetAllocation;
              outcomeText = "Prediction Lost";
            }
          }

          const userVotedInMatch = !!userVoteForMatch;
          const userAlignedWithLeader =
            userVotedInMatch && userVoteForMatch === leaderId;
          const userAlignedWithConsensus =
            decision && userVoteForMatch === decision.winningOptionId;

          return (
            <div
              key={fixture.fixtureId}
              className={`rounded-2xl backdrop-blur-sm border transition-colors ${
                userVoteForMatch && !isVotingClosed
                  ? "border-foreground ring-1 ring-foreground/20"
                  : "border-border-low"
              }`}
            >
              <button
                onClick={() => toggleExpanded(fixture.fixtureId)}
                className={`w-full px-5 py-4 flex items-center justify-between  text-left group hover:bg-foreground/5 transition-colors rounded-2xl ${
                  isExpanded ? "rounded-b-none" : ""
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-lg font-semibold flex items-center gap-1.5 flex-wrap">
                      <span>{getFlagEmoji(fixture.participant1)}</span>
                      <span>{fixture.participant1}</span>
                      <span className="text-muted font-normal text-sm mx-0.5">
                        vs
                      </span>
                      <span>{getFlagEmoji(fixture.participant2)}</span>
                      <span>{fixture.participant2}</span>
                    </h3>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      {batchWeek && (
                        <span className="text-[10px] bg-foreground/5 border border-border-low text-muted px-2 py-0.5 rounded-full font-semibold">
                          {batchWeek}
                        </span>
                      )}
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          stateBadge === "Live"
                            ? "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-200 animate-pulse"
                            : stateBadge === "Finished"
                              ? "bg-neutral-100 text-neutral-800 dark:bg-gray-700 dark:text-gray-300"
                              : "bg-neutral-100 text-neutral-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {stateBadge}
                      </span>
                      {isVotingClosed ? null : userVoteForMatch ? (
                        <span className="text-xs bg-foreground/10 text-foreground px-2 py-0.5 rounded-full font-medium border border-border">
                          Voted
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="text-xs text-muted">
                    {formatStartTime(fixture.startTime)}
                    <span className="mx-1">·</span>
                    <span
                      className={`font-medium ${isVotingClosed ? "text-red-600 dark:text-red-400" : "text-foreground"}`}
                    >
                      {votingDeadlineText}
                    </span>
                  </p>
                  {score && matchStarted && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span
                        className={`px-2 py-0.5 rounded ${
                          score.status === "Finished"
                            ? "bg-neutral-100 text-neutral-800 dark:bg-gray-700 dark:text-gray-300"
                            : "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-200 animate-pulse"
                        }`}
                      >
                        {score.status}
                      </span>
                      <span className="font-mono text-foreground">
                        {score.p1Goals} - {score.p2Goals}
                      </span>
                      <span className="text-muted">Live via TXODDS</span>
                    </div>
                  )}
                </div>
                <svg
                  className={`w-5 h-5 text-gray-400 transform transition-transform duration-200 ml-3 ${isExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}`}
              >
                <div className="px-5 pb-5 space-y-4">
                  {decision && (
                    <div className="p-3 border border-border-low rounded-lg">
                      <p className="text-xs text-muted">Community Decision</p>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-sm font-medium text-foreground">
                          ✓ {communityDecisionText}
                        </span>
                        {!decision.isSkip && (
                          <span className="text-sm font-bold text-foreground">
                            {communityDecisionOdds.toFixed(2)}x
                          </span>
                        )}
                      </div>
                      {decision.accepted && (
                        <p className="text-xs text-muted mt-1">
                          Protocol bet placed
                        </p>
                      )}
                      {!decision.isSkip && !decision.accepted && (
                        <p className="text-xs text-amber-600 dark:text-yellow-400 mt-1">
                          No allocation — budget full
                        </p>
                      )}
                      {settlementStage === "Settled" && decision.accepted && (
                        <div className="mt-2 pt-2 border-t border-border-low">
                          <div className="flex justify-between text-xs">
                            <span
                              className={`${decision.won ? "text-foreground font-semibold" : "text-red-600 dark:text-red-400"}`}
                            >
                              {outcomeText}
                            </span>
                            <span className="font-mono">
                              {treasuryChange >= 0 ? "+" : ""}
                              {treasuryChange.toFixed(2)} USDC
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Principal always protected
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {!isVotingClosed && userVotedInMatch && (
                    <div className="text-xs text-muted">
                      {userAlignedWithLeader ? (
                        <span className="text-foreground font-semibold">
                          ✓ You&apos;re aligned with the current consensus.
                        </span>
                      ) : (
                        <span>
                          Community currently favors another prediction.
                        </span>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    {fixture.options.map((opt) => {
                      const disabled =
                        isVotingClosed ||
                        !canVote ||
                        isVotingCompleted ||
                        (remainingBets === 0 &&
                          !isVotingClosed &&
                          !userVoteForMatch);
                      const chosenOptionId =
                        chosenVotes[fixture.fixtureId] ?? userVoteForMatch;
                      const isSelected = chosenOptionId === opt.id;
                      const voteCount = simulatedVotes[opt.id] || 0;
                      const percentage =
                        totalVotes > 0 ? (voteCount / totalVotes) * 100 : 0;
                      const isLeading = !isVotingClosed && leaderId === opt.id;
                      const isCommunityWinner =
                        decision &&
                        decision.winningOptionId === opt.id &&
                        !decision.isSkip;

                      const glowClass = isLeading
                        ? "shadow-[0_0_12px_rgba(0,0,0,0.05)] dark:shadow-[0_0_12px_rgba(255,255,255,0.15)] border-foreground/30 dark:border-white/40"
                        : "";
                      const barColor = isLeading
                        ? "bg-foreground dark:bg-white shadow-[0_0_6px_rgba(0,0,0,0.15)] dark:shadow-[0_0_6px_rgba(255,255,255,0.4)]"
                        : "bg-foreground/20 dark:bg-white/40";

                      return (
                        <button
                          key={opt.id}
                          onClick={() =>
                            handleChoose(fixture.fixtureId, opt.id)
                          }
                          disabled={disabled}
                          className={`w-full text-left p-3 rounded-lg border transition ${glowClass} ${
                            disabled && !isVotingClosed
                              ? "border-border-low bg-foreground/[0.01] dark:border-gray-800 dark:bg-gray-900/50 cursor-not-allowed opacity-70"
                              : isSelected
                                ? "border-foreground bg-foreground/5 dark:border-white dark:bg-white/10"
                                : "border-border-low hover:border-gray-500"
                          }`}
                        >
                          <div className="flex justify-between items-center gap-4">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                {opt.label}
                              </span>
                              {isLeading && (
                                <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.5 rounded-full font-semibold border border-border">
                                  Leading
                                </span>
                              )}
                              {isCommunityWinner && (
                                <span className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-semibold">
                                  Winner
                                </span>
                              )}
                              {userVoteForMatch === opt.id && (
                                <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.5 rounded-full font-semibold border border-border">
                                  Your Vote
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted">
                                {percentage.toFixed(2)}%
                              </span>
                              <span className="text-xs text-muted">
                                {voteCount}
                              </span>
                              <span className="text-lg font-bold text-foreground whitespace-nowrap">
                                {opt.odds.toFixed(2)}x
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 w-full bg-neutral-200 dark:bg-gray-700 rounded-full h-1">
                            <div
                              className={`h-1 rounded-full ${barColor}`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </button>
                      );
                    })}

                    <button
                      onClick={() => handleChoose(fixture.fixtureId, skipId)}
                      disabled={
                        isVotingClosed ||
                        !canVote ||
                        isVotingCompleted ||
                        (remainingBets === 0 &&
                          !isVotingClosed &&
                          !userVoteForMatch)
                      }
                      className={`w-full text-left p-3 rounded-lg border transition ${
                        isVotingClosed ||
                        !canVote ||
                        isVotingCompleted ||
                        (remainingBets === 0 &&
                          !isVotingClosed &&
                          !userVoteForMatch)
                          ? "border-border-low bg-foreground/[0.01] dark:border-gray-800 dark:bg-gray-900/50 cursor-not-allowed opacity-70"
                          : (chosenVotes[fixture.fixtureId] ??
                                userVoteForMatch) === skipId
                            ? "border-foreground bg-foreground/5 dark:border-white dark:bg-white/10"
                            : "border-border-low hover:border-gray-500"
                      } ${!isVotingClosed && leaderId === skipId ? "shadow-[0_0_12px_rgba(0,0,0,0.05)] dark:shadow-[0_0_12px_rgba(255,255,255,0.15)] border-foreground/30 dark:border-white/40" : ""}`}
                    >
                      <div className="flex justify-between items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-muted">
                            Skip this match
                          </span>
                          {!isVotingClosed && leaderId === skipId && (
                            <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.5 rounded-full font-semibold border border-border">
                              Leading
                            </span>
                          )}
                          {userVoteForMatch === skipId && (
                            <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.5 rounded-full font-semibold border border-border">
                              Your Vote
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted">
                            {totalVotes > 0
                              ? ((skipVotes / totalVotes) * 100).toFixed(2) +
                                "%"
                              : "0.00%"}
                          </span>
                          <span className="text-xs text-muted">
                            {skipVotes}
                          </span>
                          <span className="text-sm text-muted">—</span>
                        </div>
                      </div>
                      <div className="mt-2 w-full bg-neutral-200 dark:bg-gray-700 rounded-full h-1">
                        <div
                          className={`h-1 rounded-full ${leaderId === skipId ? "bg-foreground dark:bg-white shadow-[0_0_6px_rgba(0,0,0,0.15)] dark:shadow-[0_0_6px_rgba(255,255,255,0.4)]" : "bg-foreground/20 dark:bg-white/40"}`}
                          style={{
                            width: `${totalVotes > 0 ? (skipVotes / totalVotes) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </button>
                  </div>

                  {/* Vote Button */}
                  {!isVotingClosed &&
                    chosenVotes[fixture.fixtureId] !== undefined && (
                      <div className="pt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                        <button
                          onClick={() => {
                            const optionId = chosenVotes[fixture.fixtureId];
                            if (optionId) {
                              handleVote(fixture.fixtureId, optionId);
                            }
                          }}
                          disabled={
                            chosenVotes[fixture.fixtureId] === userVoteForMatch
                          }
                          className={`w-full py-2.5 px-4 rounded-xl text-sm font-bold transition-all duration-200 active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 ${
                            chosenVotes[fixture.fixtureId] === userVoteForMatch
                              ? "bg-foreground/10 text-muted border border-border-low cursor-not-allowed"
                              : "bg-foreground text-background hover:bg-foreground/90 hover:scale-[1.01] shadow-md"
                          }`}
                        >
                          {chosenVotes[fixture.fixtureId] ===
                          userVoteForMatch ? (
                            <>
                              <span>🔒</span> You already voted this
                            </>
                          ) : (
                            <>
                              <span>🗳️</span> Vote
                            </>
                          )}
                        </button>
                      </div>
                    )}

                  {totalVotes > 0 && (
                    <div className="flex items-center justify-between text-xs text-gray-500 mt-2">
                      <span>{totalVotes} participants voted</span>
                    </div>
                  )}

                  <div className="flex items-center gap-1 text-xs text-neutral-400 dark:text-gray-600 mt-2">
                    <span
                      className={
                        settlementStage === "Voting Open"
                          ? "text-foreground font-semibold"
                          : ""
                      }
                    >
                      Voting Open
                    </span>
                    <span className="mx-1">→</span>
                    <span
                      className={
                        settlementStage === "Consensus Locked"
                          ? "text-foreground font-semibold"
                          : ""
                      }
                    >
                      Locked
                    </span>
                    <span className="mx-1">→</span>
                    <span
                      className={
                        settlementStage === "Awaiting Result" ||
                        settlementStage === "Match Live"
                          ? "text-foreground font-semibold"
                          : ""
                      }
                    >
                      Live
                    </span>
                    <span className="mx-1">→</span>
                    <span
                      className={
                        settlementStage === "Settled"
                          ? "text-foreground font-semibold"
                          : ""
                      }
                    >
                      Settled
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
