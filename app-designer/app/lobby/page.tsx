"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import LobbyPhase from "../components/home/LobbyPhase";
import SyndicateSidebar from "../components/home/SyndicateSidebar";
import HowItWorks from "../components/home/HowItWorks";
import FAQ from "../components/home/FAQ";
import { useUndegenProgram } from "../context/UndegenProgramContext";
import { WEEKLY_YIELD_RATE, GLOBAL_TVL } from "../lib/dummyData";

const LOBBY_BATCH_ID = 6;

export default function LobbyPage() {
  const router = useRouter();
  const {
    batches,
    isLoading,
    isConnected,
    deposit,
    withdraw,
  } = useUndegenProgram();

  const handleDeposit = async (amount: number) => {
    await deposit(amount);
  };

  const handleWithdraw = async () => {
    await withdraw();
  };

  const batchState = useMemo(() => {
    return batches.find((b) => b.batchId === LOBBY_BATCH_ID) || null;
  }, [batches]);

  const weeklyYieldPool =
    batchState?.weeklyYieldPool ?? GLOBAL_TVL * WEEKLY_YIELD_RATE;

  // User's deposits in each batch
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

  if (isLoading || !batchState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg1">
        <div className="animate-pulse text-gray-400">Loading lobby...</div>
      </div>
    );
  }

  const dailyYieldProjection = weeklyYieldPool / 7;
  const userPoolShare =
    batchState.totalDeposited > 0
      ? batchState.userDeposited / batchState.totalDeposited
      : 0;
  const userWeeklyYield = userPoolShare * weeklyYieldPool;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-foreground">
      <main className="relative z-10 max-w-6xl mx-auto flex min-h-screen  flex-col gap-8  border-border-low px-6 pt-28 pb-28 md:pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <LobbyPhase
              batchId={batchState.batchId}
              batchStartTime={batchState.batchStartTime}
              userDeposited={batchState.userDeposited}
              totalDeposited={batchState.totalDeposited}
              participantCount={batchState.participantCount}
              minimumDeposit={batchState.minimumDeposit}
              projectedDailyYield={dailyYieldProjection}
              onDeposit={handleDeposit}
              onWithdraw={handleWithdraw}
            />
          </div>
          <div className="space-y-6">
            <SyndicateSidebar
              isLoading={isLoading}
              weeklyYieldPool={weeklyYieldPool}
              allocatedBudget={0}
              remainingBudget={weeklyYieldPool}
              acceptedBetsCount={0}
              skippedMatchesCount={0}
              remainingBets={5}
              userPoolShare={userPoolShare}
              userWeeklyYield={userWeeklyYield}
              userLockedAmount={batchState.userDeposited}
              isConnected={isConnected}
              phase="Lobby"
              batchRecord={{ wins: 0, losses: 0, pending: 0 }}
              joinedBatches={joinedBatches}
              currentBatchId={LOBBY_BATCH_ID}
              onNavigateToBatch={(batchId) =>
                router.push(batchId === 5 ? "/" : `/?batch=${batchId}`)
              }
            />
          </div>
        </div>
        <HowItWorks />
        <FAQ />
      </main>
    </div>
  );
}
