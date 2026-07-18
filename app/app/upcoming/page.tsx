"use client";

import React, { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useUndegenProgram } from "../context/UndegenProgramContext";
import LobbyPhase from "../components/LobbyPhase";
import SyndicateSidebar from "../components/SyndicateSidebar";
import HowItWorks from "../components/HowItWorks";
import FAQ from "../components/FAQ";

export default function UpcomingBatchesPage() {
  const {
    batches,
    isLoading,
    isConnected,
    usdcBalance,
    deposit,
    withdraw,
    selectedBatchId,
    setSelectedBatchId,
  } = useUndegenProgram();

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const lobbyBatches = useMemo(
    () =>
      batches
        .filter((b) => b.phase === "Lobby")
        .sort((a, b) => (a.lobbyExpiresAt ?? Infinity) - (b.lobbyExpiresAt ?? Infinity)),
    [batches]
  );

  // The page only ever shows the single Lobby batch currently focused —
  // the selected one if it's a Lobby batch, else the soonest-starting one.
  // Switching batches happens via the sidebar list, not an in-page dropdown.
  const focusedBatch = useMemo(() => {
    const selected = lobbyBatches.find((b) => b.batchId === selectedBatchId);
    return selected ?? lobbyBatches[0] ?? null;
  }, [lobbyBatches, selectedBatchId]);

  const weeklyYieldPool = focusedBatch?.weeklyYieldPool ?? 0;
  const userLockedAmount = focusedBatch?.userDeposited ?? 0;
  const userPoolShare =
    focusedBatch?.totalDeposited && focusedBatch.totalDeposited > 0
      ? userLockedAmount / focusedBatch.totalDeposited
      : 0;
  // Scoped to Lobby batches only, so the sidebar's "already joined" /
  // "available" split only ever reflects upcoming batches, not Active/Ended ones.
  const joinedBatches = useMemo(() => {
    return lobbyBatches.map((b) => {
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
  }, [isConnected, lobbyBatches]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg1">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!focusedBatch) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-bg1 text-center px-6">
        <div className="text-muted text-lg font-semibold">No open batches right now</div>
        <p className="text-muted text-sm max-w-sm">
          Check back soon, or view <a href="/history" className="underline hover:text-foreground">History</a> for
          past results.
        </p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-foreground">
      <AnimatePresence>
        {toastMessage && (
          <div className="fixed bottom-24 left-4 right-4 z-50 flex justify-center pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="bg-card/95 dark:bg-[#111218]/95 border border-border-strong text-foreground text-xs font-bold tracking-wider py-3 px-6 rounded-full shadow-2xl backdrop-blur-md flex items-center gap-2 pointer-events-auto"
            >
              <span className="h-2 w-2 rounded-full bg-foreground animate-pulse" />
              {toastMessage}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="relative z-10 mx-auto flex max-w-6xl min-h-screen flex-col gap-8 border-border-low px-6 pt-28 pb-28 md:pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                  <span>Batch #{focusedBatch.batchId}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20">
                    {focusedBatch.phase}
                  </span>
                </h2>
                <p className="text-sm text-muted mt-1">
                  Stake or unstake freely until it locks. Once a batch starts, manage
                  it from the Live page instead.
                </p>
              </div>
            </div>

            {!isConnected && (
              <div className="p-4 text-center border border-dashed border-border-low rounded-xl">
                <p className="text-xs text-muted font-light">Connect your wallet to stake into a batch.</p>
              </div>
            )}

            <LobbyPhase
              batchId={focusedBatch.batchId}
              lobbyExpiresAt={focusedBatch.lobbyExpiresAt}
              userDeposited={focusedBatch.userDeposited}
              totalDeposited={focusedBatch.totalDeposited}
              participantCount={focusedBatch.participantCount}
              minimumDeposit={focusedBatch.minimumDeposit}
              apyBps={focusedBatch.apyBps}
              walletBalance={usdcBalance}
              onDeposit={(amount) => deposit(amount, focusedBatch.batchId)}
              onWithdraw={(amount) => withdraw(amount, focusedBatch.batchId)}
              onResult={setToastMessage}
            />
          </div>

          <div className="space-y-6">
            <SyndicateSidebar
              isLoading={isLoading}
              weeklyYieldPool={weeklyYieldPool}
              allocatedBudget={0}
              remainingBudget={weeklyYieldPool}
              accumulatedWinnings={0}
              remainingBets={focusedBatch.maxPredictions ?? 5}
              userPoolShare={userPoolShare}
              userLockedAmount={userLockedAmount}
              isConnected={isConnected}
              phase="Lobby"
              joinedBatches={joinedBatches}
              currentBatchId={focusedBatch.batchId}
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
