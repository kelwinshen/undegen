"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface SyndicateSidebarProps {
  isLoading: boolean;
  weeklyYieldPool: number;
  allocatedBudget: number;
  remainingBudget: number;
  acceptedBetsCount: number;
  skippedMatchesCount: number;
  remainingBets: number;
  userPoolShare: number;
  userWeeklyYield: number;
  userLockedAmount: number;
  isConnected: boolean;
  phase: string;
  batchRecord?: { wins: number; losses: number; pending: number };
  joinedBatches?: Array<{
    batchId: number;
    phase: string;
    userDeposited: number;
    poolShare: number;
    weeklyYield: number;
    weeklyYieldPool: number;
    totalDeposited: number;
  }>;
  currentBatchId: number;
  onNavigateToBatch?: (batchId: number) => void;
}

export default function SyndicateSidebar({
  isLoading,
  weeklyYieldPool,
  allocatedBudget,
  remainingBudget,
  acceptedBetsCount,
  skippedMatchesCount,
  remainingBets,
  userPoolShare,
  userWeeklyYield,
  userLockedAmount,
  isConnected,
  phase,
  batchRecord = { wins: 0, losses: 0, pending: 0 },
  joinedBatches = [],
  currentBatchId,
  onNavigateToBatch,
}: SyndicateSidebarProps) {
  const isLobby = phase === "Lobby";
  const yourPotentialReward = userPoolShare * weeklyYieldPool;
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <>
      <div className="hidden lg:block p-6 rounded-2xl backdrop-blur-sm border border-border-low space-y-4 animate-in fade-in slide-in-from-top-2 duration-300 font-sans">
        {/* Joined Batches */}
        {isConnected &&
          joinedBatches &&
          joinedBatches.some(
            (b) => b.userDeposited > 0 && b.phase !== "Ended"
          ) && (
            <div className="space-y-2">
              <h2 className="text-lg font-bold">My Joined Batches</h2>
              <div className="space-y-1.5">
                {joinedBatches.map((b) => {
                  if (b.userDeposited === 0 || b.phase === "Ended") return null;
                  const isCurrent = b.batchId === currentBatchId;
                  return (
                    <button
                      key={b.batchId}
                      onClick={() =>
                        !isCurrent && onNavigateToBatch?.(b.batchId)
                      }
                      disabled={isCurrent}
                      className={`w-full flex justify-between items-center p-2 rounded-lg border text-left transition ${
                        isCurrent
                          ? "border-foreground/15 bg-foreground/5 cursor-default"
                          : "border-transparent hover:border-foreground/10 hover:bg-foreground/5 cursor-pointer"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground">
                            Batch #{b.batchId}
                          </span>
                          <span className="text-[9px] text-muted font-normal uppercase tracking-wider">
                            ({b.phase})
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5 mt-1">
                          <p className="text-[10px] text-muted font-sans">
                            Treasury:{" "}
                            <span className="font-mono text-foreground">
                              $
                              {b.weeklyYieldPool.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex flex-col justify-center">
                        <span className="text-[9px] text-muted font-normal uppercase tracking-wider block mb-0.5">
                          My Deposit
                        </span>
                        <p className="text-xs font-bold text-foreground font-mono">
                          ${b.userDeposited.toLocaleString()}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        {/* Available Batches (Not joined yet) or all batches if not connected */}
        {joinedBatches &&
          (isConnected
            ? joinedBatches.some(
                (b) => b.userDeposited === 0 && b.phase !== "Ended"
              )
            : joinedBatches.some((b) => b.phase !== "Ended")) && (
            <div
              className={`space-y-2 ${isConnected && joinedBatches.some((b) => b.userDeposited > 0) ? "pt-2 border-t border-border-low" : ""}`}
            >
              <h2 className="text-lg font-bold">
                {isConnected ? "Available Batches" : "All Batches"}
              </h2>
              <div className="space-y-1.5">
                {joinedBatches.map((b) => {
                  if (isConnected && b.userDeposited > 0) return null;
                  if (b.phase === "Ended") return null;
                  const isCurrent = b.batchId === currentBatchId;
                  return (
                    <button
                      key={b.batchId}
                      onClick={() =>
                        !isCurrent && onNavigateToBatch?.(b.batchId)
                      }
                      disabled={isCurrent}
                      className={`w-full flex justify-between items-center p-2 rounded-lg border text-left transition ${
                        isCurrent
                          ? "border-foreground/15 bg-foreground/5 cursor-default"
                          : "border-border-low hover:border-border bg-foreground/[0.02] hover:bg-foreground/[0.05] dark:bg-neutral-900/50 dark:hover:bg-neutral-900/80 cursor-pointer group"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-xs font-semibold ${isCurrent ? "text-foreground" : "text-muted group-hover:text-foreground"}`}
                          >
                            Batch #{b.batchId}
                          </span>
                          <span className="text-[9px] text-muted font-normal uppercase tracking-wider">
                            ({b.phase})
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5 mt-1">
                          <p className="text-[10px] text-muted font-sans">
                            Treasury:{" "}
                            <span className="font-mono text-foreground">
                              $
                              {b.weeklyYieldPool.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-1.5">
                        {!isCurrent && (
                          <span className="text-[10px] font-bold text-muted group-hover:text-foreground border border-border group-hover:border-foreground/50 rounded px-1.5 py-0.5 bg-card dark:bg-neutral-950 font-sans transition">
                            Join ➜
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        {isConnected && (
          <div className="pt-2 border-t border-border-low flex justify-between items-center">
            <span className="text-xs font-bold text-muted">Total Deposit</span>
            <span className="text-xs font-bold text-foreground font-mono">
              $
              {joinedBatches
                .filter((b) => b.phase !== "Ended")
                .reduce((sum, b) => sum + b.userDeposited, 0)
                .toLocaleString()}{" "}
              USDC
            </span>
          </div>
        )}
      </div>

      <div className="p-6 rounded-2xl backdrop-blur-sm border border-border-low space-y-5">
        <h2 className="text-lg font-bold">Treasury Dashboard</h2>

        <div className="p-3 border border-border-low rounded-lg space-y-2">
          <p className="text-xs text-muted">Weekly Treasury Budget</p>
          <p className="text-2xl font-bold text-foreground">
            $
            {weeklyYieldPool.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}
          </p>
          <div className="w-full bg-neutral-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-foreground dark:bg-white h-2 rounded-full"
              style={{ width: `${(allocatedBudget / weeklyYieldPool) * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>Allocated: ${allocatedBudget.toFixed(0)}</span>
            <span>Remaining: ${remainingBudget.toFixed(0)}</span>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Accepted Predictions</span>
            <span className="font-mono">{acceptedBetsCount} / 5</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Skipped Matches</span>
            <span className="font-mono">{skippedMatchesCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Remaining Capacity</span>
            <span className="font-mono">
              {remainingBets} prediction{remainingBets !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {isConnected && (
          <div className="p-3 border border-border-low rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Your Pool Share</span>
              <span className="font-mono">
                {(userPoolShare * 100).toFixed(5)}%
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Your Weekly Yield</span>
              <span className="font-mono">${userWeeklyYield.toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Expected Reward</span>
              <span className="font-mono">
                ${yourPotentialReward.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Locked Principal</span>
              <span className="font-mono">${userLockedAmount.toFixed(0)}</span>
            </div>
          </div>
        )}

        <div className="p-3 border border-border-low rounded-lg space-y-2">
          <p className="text-xs text-muted">Current Batch Record</p>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Wins</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-mono">
              {batchRecord.wins}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Losses</span>
            <span className="text-red-600 dark:text-red-400 font-mono">
              {batchRecord.losses}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Pending</span>
            <span className="text-amber-600 dark:text-yellow-400 font-mono">
              {batchRecord.pending}
            </span>
          </div>
        </div>

        <div className="p-2 border border-border-low rounded-lg text-xs text-muted">
          <span className="text-foreground/80 dark:text-gray-300 font-medium">
            ✓ Verified by TXODDS Oracle
          </span>
          <br />
          <span className="text-muted/80">
            Settlement verified using on-chain cryptographic proofs.
          </span>
        </div>

        {!isConnected && (
          <p className="text-xs text-amber-600 dark:text-yellow-300">
            Connect wallet to participate in the syndicate.
          </p>
        )}
      </div>

      {/* Sticky Mobile Batch Selector Button */}
      <button
        onClick={() => setIsDrawerOpen(true)}
        className="fixed bottom-24 right-4 z-40 lg:hidden flex items-center gap-2 px-4 py-3 cursor-pointer  active:scale-95 text-foreground rounded-full border border-border-strong shadow-2xl backdrop-blur-md transition-all duration-200"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span className="text-xs font-bold font-sans tracking-wide">
          Batch #{currentBatchId}
        </span>
        <svg
          className="w-3.5 h-3.5 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9"
          />
        </svg>
      </button>

      {/* Mobile Drawer Overlay */}
      <AnimatePresence>
        {isDrawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDrawerOpen(false)}
              className="fixed inset-0 z-45 lg:hidden backdrop-blur-sm"
            />

            {/* Bottom Sheet Drawer */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="fixed bottom-0 left-0 right-0 z-50 lg:hidden backdrop-blur-xl border-t border-border-strong rounded-t-3xl pb-[calc(24px+env(safe-area-inset-bottom))] pt-6 px-6 font-sans shadow-2xl max-h-[80vh] flex flex-col"
            >
              {/* Handle */}
              <div className="w-12 h-1 bg-border rounded-full mx-auto mb-6 shrink-0" />

              {/* Header */}
              <div className="flex justify-between items-center mb-6 px-1 shrink-0">
                <h3 className="text-lg font-bold tracking-wider text-foreground">
                  Switch Batch
                </h3>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-1 rounded-full text-muted hover:text-foreground cursor-pointer transition-colors duration-150 focus:outline-none"
                  aria-label="Close menu"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Batch list */}
              <div className="space-y-6 pb-24 overflow-y-auto flex-1 pr-1">
                {/* Joined Batches in Mobile Drawer */}
                {isConnected &&
                  joinedBatches &&
                  joinedBatches.some(
                    (b) => b.userDeposited > 0 && b.phase !== "Ended"
                  ) && (
                    <div className="space-y-2">
                      <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
                        My Joined Batches
                      </h2>
                      <div className="space-y-2">
                        {joinedBatches.map((b) => {
                          if (b.userDeposited === 0 || b.phase === "Ended")
                            return null;
                          const isCurrent = b.batchId === currentBatchId;
                          return (
                            <button
                              key={b.batchId}
                              onClick={() => {
                                if (!isCurrent) {
                                  onNavigateToBatch?.(b.batchId);
                                  setIsDrawerOpen(false);
                                }
                              }}
                              disabled={isCurrent}
                              className={`w-full flex justify-between items-center p-3 rounded-xl border text-left transition ${
                                isCurrent
                                  ? "border-foreground/15 bg-foreground/5 cursor-default"
                                  : "border-border-low hover:border-foreground/10 hover:bg-foreground/5 cursor-pointer"
                              }`}
                            >
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-bold text-foreground">
                                    Batch #{b.batchId}
                                  </span>
                                  <span className="text-xs text-muted font-normal uppercase tracking-wider">
                                    ({b.phase})
                                  </span>
                                </div>
                                <div className="flex flex-col gap-0.5 mt-1">
                                  <p className="text-xs text-muted font-sans">
                                    Treasury:{" "}
                                    <span className="font-mono text-foreground">
                                      $
                                      {b.weeklyYieldPool.toLocaleString(
                                        undefined,
                                        { maximumFractionDigits: 2 }
                                      )}
                                    </span>
                                  </p>
                                </div>
                              </div>
                              <div className="text-right flex flex-col justify-center">
                                <span className="text-[10px] text-muted font-normal uppercase tracking-wider block mb-0.5">
                                  My Deposit
                                </span>
                                <p className="text-sm font-bold text-foreground font-mono">
                                  ${b.userDeposited.toLocaleString()}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                {/* Available Batches in Mobile Drawer */}
                {joinedBatches &&
                  (isConnected
                    ? joinedBatches.some(
                        (b) => b.userDeposited === 0 && b.phase !== "Ended"
                      )
                    : joinedBatches.some((b) => b.phase !== "Ended")) && (
                    <div className="space-y-2">
                      <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
                        {isConnected ? "Available Batches" : "All Batches"}
                      </h2>
                      <div className="space-y-2">
                        {joinedBatches.map((b) => {
                          if (isConnected && b.userDeposited > 0) return null;
                          if (b.phase === "Ended") return null;
                          const isCurrent = b.batchId === currentBatchId;
                          return (
                            <button
                              key={b.batchId}
                              onClick={() => {
                                if (!isCurrent) {
                                  onNavigateToBatch?.(b.batchId);
                                  setIsDrawerOpen(false);
                                }
                              }}
                              disabled={isCurrent}
                              className={`w-full flex justify-between items-center p-3 rounded-xl border text-left transition ${
                                isCurrent
                                  ? "border-foreground/15 bg-foreground/5 cursor-default"
                                  : "border-border-low hover:border-border bg-foreground/[0.02] hover:bg-foreground/[0.05] dark:bg-neutral-900/50 dark:hover:bg-neutral-900/80 cursor-pointer group"
                              }`}
                            >
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`text-sm font-bold ${isCurrent ? "text-foreground" : "text-muted group-hover:text-foreground"}`}
                                  >
                                    Batch #{b.batchId}
                                  </span>
                                  <span className="text-xs text-muted font-normal uppercase tracking-wider">
                                    ({b.phase})
                                  </span>
                                </div>
                                <div className="flex flex-col gap-0.5 mt-1">
                                  <p className="text-xs text-muted font-sans">
                                    Treasury:{" "}
                                    <span className="font-mono text-foreground">
                                      $
                                      {b.weeklyYieldPool.toLocaleString(
                                        undefined,
                                        { maximumFractionDigits: 2 }
                                      )}
                                    </span>
                                  </p>
                                </div>
                              </div>
                              <div className="text-right flex items-center gap-1.5">
                                {!isCurrent && (
                                  <span className="text-xs font-bold text-muted group-hover:text-foreground border border-border group-hover:border-foreground/50 rounded-lg px-2.5 py-1 bg-card dark:bg-neutral-950 font-sans transition">
                                    Join ➜
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
