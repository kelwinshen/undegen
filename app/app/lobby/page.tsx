"use client";

import React, { useState, useEffect } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import Header from "../components/home/Header";
import LobbyPhase from "../components/home/LobbyPhase";
import SyndicateSidebar from "../components/home/SyndicateSidebar";
import HowItWorks from "../components/home/HowItWorks";
import FAQ from "../components/home/FAQ";
import {
  fetchBatchState,
  depositToLobby,
  withdrawFromLobby,
  BatchState,
} from "../services/undegenProgram";
import { WEEKLY_YIELD_RATE, GLOBAL_TVL } from "../lib/dummyData";

const LOBBY_BATCH_ID = 2;

export default function LobbyPage() {
  const { status, wallet } = useWalletConnection();
  const isConnected = status === "connected";
  const address = wallet?.account.address?.toString() ?? null;

  const [batchState, setBatchState] = useState<BatchState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const batch = await fetchBatchState(LOBBY_BATCH_ID, isConnected ? address : null);
        setBatchState(batch);
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [isConnected, address]);

  const handleDeposit = async (amount: number) => {
    await depositToLobby(LOBBY_BATCH_ID, amount);
    if (batchState) {
      const updated = await fetchBatchState(LOBBY_BATCH_ID, address);
      setBatchState(updated);
    }
  };

  const handleWithdraw = async () => {
    await withdrawFromLobby(LOBBY_BATCH_ID);
    if (batchState) {
      const updated = await fetchBatchState(LOBBY_BATCH_ID, address);
      setBatchState(updated);
    }
  };

  if (isLoading || !batchState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg1">
        <div className="animate-pulse text-gray-400">Loading lobby...</div>
      </div>
    );
  }

  const weeklyYieldPool = batchState.weeklyYieldPool ?? GLOBAL_TVL * WEEKLY_YIELD_RATE;
  const dailyYieldProjection = weeklyYieldPool / 7;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col gap-8 border-x border-border-low px-6 py-12">
        <Header />
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
              userPoolShare={0}
              userWeeklyYield={0}
              userLockedAmount={batchState.userDeposited}
              isConnected={isConnected}
              phase="Lobby"
              batchRecord={{ wins: 0, losses: 0, pending: 0 }}
            />
          </div>
        </div>
        <HowItWorks />
        <FAQ />
      </main>
    </div>
  );
}