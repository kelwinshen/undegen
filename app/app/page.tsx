"use client";

import React, { useState, useMemo, useEffect } from "react";
import ConsensusVoting from "./components/live/ConsensusVoting";
import SyndicateSidebar from "./components/live/SyndicateSidebar";
import BatchTimer from "./components/live/BatchTimer";
import HowItWorks from "./components/live/HowItWorks";
import FAQ from "./components/live/FAQ";
import { useUndegenProgram } from "./context/UndegenProgramContext";
import { fetchLiveMatchForBatch, describeBatchBetTerms, BetTermProposal } from "./services/undegenProgram";

type BatchVoteStatus = "voting" | "voted" | "ongoing" | "waiting";

export default function Live() {
  const {
    batches,
    options,
    fixtures,
    votes,
    matchDecisions,
    isLoading,
    selectedBatchId,
    setSelectedBatchId,
    isConnected,
    voteBySlotIndex,
  } = useUndegenProgram();

  const [userVotes, setUserVotes] = useState<Record<number, string>>({});
  // Per-batch voting/match status for the sidebar's Live Batches list — each
  // Active batch's fixture mapping is fetched independently of whichever
  // batch is currently selected/focused, since that only drives `fixtures`.
  const [batchVoteStatus, setBatchVoteStatus] = useState<Record<number, BatchVoteStatus>>({});
  // Human-readable version of the focused batch's raw bet_terms, for when
  // fixtures hasn't resolved a real match yet (still shows something a user
  // can actually read instead of bare on-chain numbers).
  const [betTermProposals, setBetTermProposals] = useState<BetTermProposal[]>([]);

  useEffect(() => {
    const activeBatches = batches.filter((b) => b.phase === "Active");
    if (activeBatches.length === 0 || options.length === 0) return;
    let cancelled = false;

    Promise.all(
      activeBatches.map(async (b) => {
        const { fixture } = await fetchLiveMatchForBatch(b.batchId, b, options);
        let status: BatchVoteStatus;
        if (!fixture) status = "waiting";
        else if (b.userHasVoted) status = "voted";
        else if (fixture.startTime > Date.now()) status = "voting";
        else status = "ongoing";
        return [b.batchId, status] as const;
      })
    ).then((results) => {
      if (!cancelled) setBatchVoteStatus(Object.fromEntries(results));
    });

    return () => {
      cancelled = true;
    };
  }, [batches, options]);

  // The live page only ever shows the batch currently in consensus voting —
  // Lobby (joinable) batches live in /upcoming, Ended ones in /history.
  const liveBatchState = useMemo(() => {
    const selected = batches.find((b) => b.batchId === selectedBatchId);
    if (selected?.phase === "Active") return selected;
    const activeBatches = batches.filter((b) => b.phase === "Active");
    if (activeBatches.length === 0) return null;
    return activeBatches.reduce((a, b) => (b.batchId > a.batchId ? b : a));
  }, [batches, selectedBatchId]);

  useEffect(() => {
    if (!liveBatchState || fixtures.length > 0) {
      setBetTermProposals([]);
      return;
    }
    let cancelled = false;
    describeBatchBetTerms(liveBatchState, options).then((proposals) => {
      if (!cancelled) setBetTermProposals(proposals);
    });
    return () => {
      cancelled = true;
    };
  }, [liveBatchState, fixtures, options]);

  const weeklyYieldPool = liveBatchState?.weeklyYieldPool ?? 0;
  const apyBps = liveBatchState?.apyBps ?? 0;
  const betSize = liveBatchState?.betSize ?? 0;
  const maxPredictions = liveBatchState?.maxPredictions ?? 5;
  const acceptedBetsCount = liveBatchState?.acceptedPredictions ?? 0;
  const remainingBets = maxPredictions - acceptedBetsCount;
  // "Allocated" is the whole weekly yield pool committed to this batch's
  // betting — real data, same figure as Total Bet Capital. "Remaining" is
  // what's left after completed bets have each drawn their fixed bet_size.
  const allocatedBudget = weeklyYieldPool;
  const remainingBudget = allocatedBudget - acceptedBetsCount * betSize;

  // createdAt is the only real whole-batch timestamp on-chain — kickoff_timestamp
  // is per-match and resets to 0 after every settlement, so it can't anchor a
  // 7-day batch countdown.
  const batchEndTime =
    liveBatchState?.createdAt != null ? liveBatchState.createdAt + 7 * 24 * 60 * 60 * 1000 : null;

  // Real on-chain result for whichever match is currently decided on this
  // batch — winningVoteIndex === 4 is a "skip" (no bet placed, so it's
  // neither a win nor a loss). Only one decision is ever visible at a time
  // (past matches within the same batch aren't retained), so this reflects
  // the latest resolved bet, not a full history.
  const isSkipDecision = liveBatchState?.winningVoteIndex === 4;
  const hasDecidedBet = liveBatchState?.winningVoteIndex != null && !isSkipDecision;
  const batchRecord = {
    wins: hasDecidedBet && liveBatchState?.outcome === true ? 1 : 0,
    losses: hasDecidedBet && liveBatchState?.outcome === false ? 1 : 0,
    pending: remainingBets,
  };

  const userLockedAmount = liveBatchState?.userDeposited ?? 0;
  const userPoolShare =
    liveBatchState?.totalDeposited && liveBatchState.totalDeposited > 0
      ? userLockedAmount / liveBatchState.totalDeposited
      : 0;

  const userWeeklyYield = userPoolShare * weeklyYieldPool;

  // Only participants who deposited during this batch's Lobby phase can vote —
  // spectating other syndicate batches is fine, but voting requires skin in the game.
  const canVote = isConnected && userLockedAmount > 0;

  // User's deposits across every batch (for the sidebar's portfolio list)
  const joinedBatches = useMemo(() => {
    return batches.map((b) => {
      const userDeposited = isConnected ? b.userDeposited : 0;
      const poolShare = b.totalDeposited > 0 ? userDeposited / b.totalDeposited : 0;
      const weeklyYield = poolShare * b.weeklyYieldPool;

      return {
        batchId: b.batchId,
        phase: b.phase,
        userDeposited,
        poolShare,
        weeklyYield,
        weeklyYieldPool: b.weeklyYieldPool,
        totalDeposited: b.totalDeposited,
        voteStatus: batchVoteStatus[b.batchId],
      };
    });
  }, [isConnected, batches, batchVoteStatus]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg1">
        <div className="animate-pulse text-gray-400">Loading syndicate...</div>
      </div>
    );
  }

  if (!liveBatchState) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-bg1 text-center px-6">
        <div className="text-gray-300 text-lg font-semibold">No live batch right now</div>
        <p className="text-gray-500 text-sm max-w-sm">
          Nothing is currently in consensus voting. Check{" "}
          <a href="/upcoming" className="underline hover:text-gray-300">Upcoming</a> to join
          the next batch, or <a href="/history" className="underline hover:text-gray-300">History</a> for
          past results.
        </p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-foreground">
      <main className="relative z-10 mx-auto flex max-w-6xl min-h-screen  flex-col gap-8 border-border-low px-6 pt-28 pb-28 md:pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <BatchTimer
              remainingBets={remainingBets}
              phase={liveBatchState.phase}
              batchWeek={`Active Batch #${liveBatchState.batchId}`}
              batchEndTime={batchEndTime}
            />
            <ConsensusVoting
              isLoading={isLoading}
              fixtures={fixtures}
              userVotes={userVotes}
              setUserVotes={setUserVotes}
              simulatedVotes={votes}
              matchDecisions={matchDecisions}
              remainingBets={remainingBets}
              weeklyYieldPool={weeklyYieldPool}
              batchWeek={`Active Batch #${liveBatchState.batchId}`}
              isEnded={false}
              canVote={canVote}
              betTermProposals={betTermProposals}
              onVoteSlot={voteBySlotIndex}
              userVotedIndex={liveBatchState.userVotedIndex}
            />
          </div>
          <div className="space-y-6">
            <SyndicateSidebar
              isLoading={isLoading}
              weeklyYieldPool={weeklyYieldPool}
              apyBps={apyBps}
              betSize={betSize}
              totalDeposited={liveBatchState.totalDeposited}
              participantCount={liveBatchState.participantCount}
              allocatedBudget={allocatedBudget}
              remainingBudget={remainingBudget}
              acceptedBetsCount={acceptedBetsCount}
              skippedMatchesCount={0}
              remainingBets={remainingBets}
              userPoolShare={userPoolShare}
              userWeeklyYield={userWeeklyYield}
              userLockedAmount={userLockedAmount}
              isConnected={isConnected}
              phase={liveBatchState.phase}
              batchRecord={batchRecord}
              joinedBatches={joinedBatches}
              currentBatchId={liveBatchState.batchId}
              onNavigateToBatch={(batchId) => setSelectedBatchId(batchId)}
            />
          </div>
        </div>
        <HowItWorks />
        <FAQ />
      </main>
    </div>
  );
}
