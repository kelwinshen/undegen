"use client";

import React, { useMemo, useState } from "react";
import { useUndegenProgram } from "../context/UndegenProgramContext";
import LobbyPhase from "../components/home/LobbyPhase";
import SyndicateSidebar from "../components/home/SyndicateSidebar";
import HowItWorks from "../components/home/HowItWorks";
import FAQ from "../components/home/FAQ";

function formatExpiry(lobbyExpiresAt: number | null): string {
  // Batches created before the created_at/expiry field existed have no real
  // deadline to show — say so plainly rather than fabricating one.
  if (lobbyExpiresAt === null) return "Unknown";
  const diff = lobbyExpiresAt - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${minutes}m left`;
}

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
  // Only one batch's detail (one LobbyPhase instance) is ever shown at a
  // time — clicking a row or navigating from the sidebar swaps which batch
  // this single slot displays, rather than stacking up multiple open panels.
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);

  const lobbyBatches = useMemo(
    () =>
      batches
        .filter((b) => b.phase === "Lobby")
        .sort((a, b) => (a.lobbyExpiresAt ?? Infinity) - (b.lobbyExpiresAt ?? Infinity)),
    [batches]
  );

  const toggleExpanded = (batchId: number) => {
    setExpandedBatchId((prev) => (prev === batchId ? null : batchId));
  };

  const expandBatch = (batchId: number) => {
    setExpandedBatchId(batchId);
  };

  // The sidebar shows single-batch stats for whichever Lobby batch is
  // currently focused — the selected one if it's a Lobby batch, else the
  // soonest-starting one.
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
  const userWeeklyYield = userPoolShare * weeklyYieldPool;

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
        <div className="animate-pulse text-gray-400">Loading syndicate batches...</div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-foreground">
      <main className="relative z-10 mx-auto flex max-w-6xl min-h-screen flex-col gap-8 border-border-low px-6 pt-28 pb-28 md:pb-12">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Upcoming Batches
          </h2>
          <p className="text-sm text-muted mt-1">
            These batches haven&apos;t started yet — click one to deposit or withdraw
            freely until it locks. Once a batch starts, manage it from the Live page instead.
          </p>
        </div>

        {!isConnected && (
          <div className="p-4 text-center border border-dashed border-border-low rounded-xl">
            <p className="text-xs text-muted font-light">Connect your wallet to deposit into a batch.</p>
          </div>
        )}

        {lobbyBatches.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-border-low rounded-xl">
            <p className="text-sm text-muted">No open batches right now — check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              {lobbyBatches.map((batch) => {
                const isExpanded = expandedBatchId === batch.batchId;
                return (
                  <div
                    key={batch.batchId}
                    className={`rounded-2xl backdrop-blur-sm border transition-colors ${
                      batch.userDeposited > 0 ? "border-emerald-400/50 ring-1 ring-emerald-400/10" : "border-border-low"
                    }`}
                  >
                    <button
                      onClick={() => {
                        toggleExpanded(batch.batchId);
                        setSelectedBatchId(batch.batchId);
                      }}
                      className={`w-full px-5 py-4 flex items-center justify-between text-left group hover:bg-foreground/5 transition-colors rounded-2xl ${
                        isExpanded ? "rounded-b-none" : ""
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="text-lg font-semibold flex items-center gap-2">
                            <span>Batch #{batch.batchId}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20">
                              {batch.phase}
                            </span>
                          </h3>
                          {batch.userDeposited > 0 && (
                            <span className="text-xs bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full font-medium border border-emerald-500/20">
                              Your deposit: ${batch.userDeposited.toLocaleString()}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted">
                          <span className={batch.lobbyExpiresAt !== null && batch.lobbyExpiresAt <= Date.now() ? "text-red-500 font-medium" : ""}>
                            {formatExpiry(batch.lobbyExpiresAt)}
                          </span>
                          <span className="mx-1.5">·</span>
                          <span>${batch.totalDeposited.toLocaleString()} staked</span>
                          <span className="mx-1.5">·</span>
                          <span>{batch.participantCount} participants</span>
                        </p>
                      </div>
                      <svg
                        className={`w-5 h-5 text-gray-400 transform transition-transform duration-200 ml-3 shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    <div
                      className={`overflow-hidden transition-all duration-300 ease-in-out ${
                        isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
                      }`}
                    >
                      {isExpanded && (
                        <div className="px-5 pb-5">
                          <LobbyPhase
                            batchId={batch.batchId}
                            lobbyExpiresAt={batch.lobbyExpiresAt}
                            userDeposited={batch.userDeposited}
                            totalDeposited={batch.totalDeposited}
                            participantCount={batch.participantCount}
                            minimumDeposit={batch.minimumDeposit}
                            projectedDailyYield={batch.weeklyYieldPool / 7}
                            walletBalance={usdcBalance}
                            onDeposit={(amount) => deposit(amount, batch.batchId)}
                            onWithdraw={(amount) => withdraw(amount, batch.batchId)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-6">
              <SyndicateSidebar
                isLoading={isLoading}
                weeklyYieldPool={weeklyYieldPool}
                allocatedBudget={0}
                remainingBudget={weeklyYieldPool}
                acceptedBetsCount={0}
                skippedMatchesCount={0}
                remainingBets={focusedBatch?.maxPredictions ?? 5}
                userPoolShare={userPoolShare}
                userWeeklyYield={userWeeklyYield}
                userLockedAmount={userLockedAmount}
                isConnected={isConnected}
                phase="Lobby"
                joinedBatches={joinedBatches}
                currentBatchId={focusedBatch?.batchId ?? -1}
                onNavigateToBatch={(batchId) => {
                  setSelectedBatchId(batchId);
                  expandBatch(batchId);
                }}
              />
            </div>
          </div>
        )}

        <HowItWorks />
        <FAQ />
      </main>
    </div>
  );
}
