"use client";

import React, { useState, useMemo } from "react";
import ConsensusVoting from "./components/home/ConsensusVoting";
import SyndicateSidebar from "./components/home/SyndicateSidebar";
import BatchTimer from "./components/home/BatchTimer";
import HowItWorks from "./components/home/HowItWorks";
import FAQ from "./components/home/FAQ";
import { useUndegenProgram } from "./context/UndegenProgramContext";

export default function Home() {
  const {
    batches,
    fixtures,
    votes,
    matchDecisions,
    isLoading,
    selectedBatchId,
    setSelectedBatchId,
    isConnected,
  } = useUndegenProgram();

  const [userVotes, setUserVotes] = useState<Record<number, string>>({});

  // The live page only ever shows the batch currently in consensus voting —
  // Lobby (joinable) batches live in /upcoming, Ended ones in /history.
  const liveBatchState = useMemo(() => {
    const selected = batches.find((b) => b.batchId === selectedBatchId);
    if (selected?.phase === "Active") return selected;
    const activeBatches = batches.filter((b) => b.phase === "Active");
    if (activeBatches.length === 0) return null;
    return activeBatches.reduce((a, b) => (b.batchId > a.batchId ? b : a));
  }, [batches, selectedBatchId]);

  const weeklyYieldPool = liveBatchState?.weeklyYieldPool ?? 0;
  const maxPredictions = liveBatchState?.maxPredictions ?? 5;
  const acceptedBetsCount = liveBatchState?.acceptedPredictions ?? 0;
  const remainingBets = maxPredictions - acceptedBetsCount;
  const allocatedBudget = (acceptedBetsCount / maxPredictions) * weeklyYieldPool;
  const remainingBudget = weeklyYieldPool - allocatedBudget;

  const userLockedAmount = liveBatchState?.userDeposited ?? 0;
  const userPoolShare =
    liveBatchState?.totalDeposited && liveBatchState.totalDeposited > 0
      ? userLockedAmount / liveBatchState.totalDeposited
      : 0;

  const userWeeklyYield = userPoolShare * weeklyYieldPool;

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
      };
    });
  }, [isConnected, batches]);

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
            />
          </div>
          <div className="space-y-6">
            <SyndicateSidebar
              isLoading={isLoading}
              weeklyYieldPool={weeklyYieldPool}
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
