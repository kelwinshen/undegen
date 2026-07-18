"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { SOLANA_CONFIG } from "../lib/solanaConfig";

// USDC's on-chain precision — shown in full rather than rounded so this
// figure never silently disagrees with the stake/unstake percentage math.
const AMOUNT_DECIMALS = SOLANA_CONFIG.TOKEN_DECIMALS;

// How many "available" (not-yet-joined) rows a joined/available split shows
// before a "Load More" button is needed — joined rows are always shown in
// full since that list is bounded by what this one wallet has actually done.
const PAGE_SIZE = 5;

interface JoinedBatchItem {
  batchId: number;
  phase: string;
  userDeposited: number;
  poolShare: number;
  weeklyYield: number;
  weeklyYieldPool: number;
  totalDeposited: number;
  voteStatus?: "no-match" | "voting" | "voting-ended" | "active";
  userWithdrawn?: boolean;
}

// Splits a batch list into "joined" (staked) and "available" (not staked),
// each sorted by batchId ascending — shared by every joined/available list
// in this component (desktop card + mobile drawer, Live + Upcoming) so the
// split logic only lives in one place.
function splitByJoined(items: JoinedBatchItem[]): { joined: JoinedBatchItem[]; available: JoinedBatchItem[] } {
  const sorted = [...items].sort((a, b) => a.batchId - b.batchId);
  return {
    joined: sorted.filter((b) => b.userDeposited > 0),
    available: sorted.filter((b) => b.userDeposited === 0),
  };
}

interface SyndicateSidebarProps {
  isLoading: boolean;
  weeklyYieldPool: number;
  apyBps?: number;
  betSize?: number;
  totalDeposited?: number;
  participantCount?: number;
  allocatedBudget: number;
  remainingBudget: number;
  accumulatedWinnings: number;
  remainingBets: number;
  userPoolShare: number;
  userLockedAmount: number;
  isConnected: boolean;
  phase: string;
  batchRecord?: { wins: number; losses: number; skipped: number };
  joinedBatches?: JoinedBatchItem[];
  currentBatchId: number;
  onNavigateToBatch?: (batchId: number) => void;
}

export default function SyndicateSidebar({
  isLoading,
  weeklyYieldPool,
  apyBps = 0,
  betSize = 0,
  totalDeposited = 0,
  participantCount = 0,
  allocatedBudget,
  remainingBudget,
  accumulatedWinnings,
  remainingBets,
  userPoolShare,
  userLockedAmount,
  isConnected,
  phase,
  batchRecord = { wins: 0, losses: 0, skipped: 0 },
  joinedBatches = [],
  currentBatchId,
  onNavigateToBatch,
}: SyndicateSidebarProps) {
  const isLobby = phase === "Lobby";
  const isEnded = phase === "Ended";
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // How many "available" rows are revealed so far in each joined/available
  // split — shared between the desktop card and mobile drawer copies of the
  // same list so "Load More" position stays in sync between them.
  const [liveAvailableCount, setLiveAvailableCount] = useState(PAGE_SIZE);
  const [lobbyAvailableCount, setLobbyAvailableCount] = useState(PAGE_SIZE);
  const [historyAvailableCount, setHistoryAvailableCount] = useState(PAGE_SIZE);

  // Current Vault Growth = real compounded winnings plus whatever of the
  // batch's bet capital hasn't been put at risk yet (remainingBudget already
  // accounts for bets_completed drawing down allocatedBudget, skips included).
  const totalFundGrowth = accumulatedWinnings + remainingBudget;
  // Unrealized APY — this batch's actual growth so far, annualized against
  // the weekly cadence (52 weeks/year), as a % of what's staked. Distinct
  // from the operator-set `apyBps` above (No-Risk APY, the guaranteed rate).
  const unrealizedGrowthApy = totalDeposited > 0 ? (totalFundGrowth * 52 * 100) / totalDeposited : 0;

  const voteStatusLabel = (status?: "no-match" | "voting" | "voting-ended" | "active") => {
    switch (status) {
      case "voting":
        return "Voting Session";
      case "voting-ended":
        return "Voting Ended";
      case "active":
        return "Active";
      default:
        return "No Match";
    }
  };

  return (
    <>
      <div className="hidden lg:block p-6 rounded-2xl backdrop-blur-sm border border-border-low space-y-4 animate-in fade-in slide-in-from-top-2 duration-300 font-sans">
        {isEnded ? (
          /* Batch History — split into batches this wallet actually joined
             ("My Batch History") vs the overall record, newest first within
             each, so your own results aren't buried in every batch that's
             ever ended. The overall half paginates via Load More. */
          joinedBatches &&
          joinedBatches.some((b) => b.phase === "Ended") &&
          (() => {
            const historyBatches = joinedBatches
              .filter((b) => b.phase === "Ended")
              .sort((a, b) => b.batchId - a.batchId);
            const joined = historyBatches.filter((b) => b.userDeposited > 0);
            const available = historyBatches.filter((b) => b.userDeposited === 0);
            const visibleAvailable = available.slice(0, historyAvailableCount);
            const renderRow = (b: JoinedBatchItem) => {
              const isCurrent = b.batchId === currentBatchId;
              const isJoined = b.userDeposited > 0;
              return (
                <button
                  key={b.batchId}
                  onClick={() => !isCurrent && onNavigateToBatch?.(b.batchId)}
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
                        className={`text-xs font-semibold ${isCurrent || isJoined ? "text-foreground" : "text-muted group-hover:text-foreground"}`}
                      >
                        Batch #{b.batchId}
                      </span>
                    </div>
                    {isJoined && (
                      <div className="flex flex-col gap-0.5 mt-1">
                        <p className="text-[10px] text-muted font-sans">
                          Staked:{" "}
                          <span className="font-mono text-foreground">
                            {b.userDeposited.toFixed(AMOUNT_DECIMALS)} USDC
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="text-right flex items-center gap-1.5">
                    {!isCurrent && (
                      <span
                        className={`text-[10px] font-bold rounded px-1.5 py-0.5 font-sans transition ${
                          isJoined && !b.userWithdrawn
                            ? "text-amber-700 dark:text-amber-400 border border-amber-500/30 bg-amber-500/10"
                            : "text-muted group-hover:text-foreground border border-border group-hover:border-foreground/50 bg-card dark:bg-neutral-950"
                        }`}
                      >
                        {isJoined ? (b.userWithdrawn ? "Completed" : "Claimable") : "View ➜"}
                      </span>
                    )}
                  </div>
                </button>
              );
            };
            return (
              <>
                {joined.length > 0 && (
                  <div className="space-y-2">
                    <h2 className="text-lg font-bold">My Batch History</h2>
                    <div className="space-y-1.5">{joined.map(renderRow)}</div>
                  </div>
                )}
                {available.length > 0 && (
                  <div className={`space-y-2 ${joined.length > 0 ? "pt-2 border-t border-border-low" : ""}`}>
                    <h2 className="text-lg font-bold">Batch History</h2>
                    <div className="space-y-1.5">{visibleAvailable.map(renderRow)}</div>
                    {historyAvailableCount < available.length && (
                      <button
                        onClick={() => setHistoryAvailableCount((c) => c + PAGE_SIZE)}
                        className="w-full text-center py-2 text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer"
                      >
                        Load More
                      </button>
                    )}
                  </div>
                )}
              </>
            );
          })()
        ) : !isLobby ? (
          /* Live Batches — split into what this wallet has staked into
             ("My Live Batches") vs what's still available, so joined
             batches are visibly grouped rather than just sorted first in
             one long list. The available half paginates via Load More. */
          joinedBatches &&
          joinedBatches.some((b) => b.phase === "Active") &&
          (() => {
            const { joined, available } = splitByJoined(joinedBatches.filter((b) => b.phase === "Active"));
            const visibleAvailable = available.slice(0, liveAvailableCount);
            const renderRow = (b: JoinedBatchItem) => {
              const isCurrent = b.batchId === currentBatchId;
              const isJoined = b.userDeposited > 0;
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
                        className={`text-xs font-semibold ${isCurrent || isJoined ? "text-foreground" : "text-muted group-hover:text-foreground"}`}
                      >
                        Batch #{b.batchId}
                      </span>
                    </div>
                    {isJoined && (
                      <div className="flex flex-col gap-0.5 mt-1">
                        <p className="text-[10px] text-muted font-sans">
                          Staked:{" "}
                          <span className="font-mono text-foreground">
                            {b.userDeposited.toFixed(AMOUNT_DECIMALS)} USDC
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="text-right flex items-center gap-1.5">
                    <span
                      className={`text-[10px] font-bold rounded px-1.5 py-0.5 font-sans transition ${
                        isCurrent
                          ? "text-foreground border border-foreground/30 bg-foreground/10"
                          : "text-muted group-hover:text-foreground border border-border group-hover:border-foreground/50 bg-card dark:bg-neutral-950"
                      }`}
                    >
                      {voteStatusLabel(b.voteStatus)}
                    </span>
                  </div>
                </button>
              );
            };
            return (
              <>
                {joined.length > 0 && (
                  <div className="space-y-2">
                    <h2 className="text-lg font-bold">My Live Batches</h2>
                    <div className="space-y-1.5">{joined.map(renderRow)}</div>
                  </div>
                )}
                {available.length > 0 && (
                  <div className={`space-y-2 ${joined.length > 0 ? "pt-2 border-t border-border-low" : ""}`}>
                    <h2 className="text-lg font-bold">Live Batches</h2>
                    <div className="space-y-1.5">{visibleAvailable.map(renderRow)}</div>
                    {liveAvailableCount < available.length && (
                      <button
                        onClick={() => setLiveAvailableCount((c) => c + PAGE_SIZE)}
                        className="w-full text-center py-2 text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer"
                      >
                        Load More
                      </button>
                    )}
                  </div>
                )}
              </>
            );
          })()
        ) : (
          <>
            {/* Joined Batches — only ones that have actually started; a Lobby
                deposit isn't "joined" yet, it still lives in Available Batches
                below so it can be managed until the batch starts. */}
            {isConnected &&
              joinedBatches &&
              joinedBatches.some(
                (b) => b.userDeposited > 0 && b.phase !== "Ended" && b.phase !== "Lobby"
              ) && (
                <div className="space-y-2">
                  <h2 className="text-lg font-bold">My Joined Batches</h2>
                  <div className="space-y-1.5">
                    {joinedBatches.map((b) => {
                      if (b.userDeposited === 0 || b.phase === "Ended" || b.phase === "Lobby") return null;
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
                              <span className="text-xs font-semibold text-foreground">
                                Batch #{b.batchId}
                              </span>
                              <span className="text-[9px] text-muted font-normal uppercase tracking-wider">
                                ({b.phase})
                              </span>
                            </div>
                          </div>
                          <div className="text-right flex flex-col justify-center">
                            <span className="text-[9px] text-muted font-normal uppercase tracking-wider block mb-0.5">
                              My Stake
                            </span>
                            <p className="text-xs font-bold text-foreground font-mono">
                              {b.userDeposited.toLocaleString()} USDC
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* Upcoming/Lobby batches: split into what this wallet has
                already staked into ("My Staked Batches") vs what's still
                available, so a staked-but-not-yet-started batch doesn't get
                lost wherever its batchId happens to land. Not connected =
                nothing to split out, so it's just one paginated "All
                Batches" list. */}
            {joinedBatches &&
              (isConnected
                ? joinedBatches.some(
                    (b) =>
                      b.phase !== "Ended" &&
                      (b.userDeposited === 0 || b.phase === "Lobby")
                  )
                : joinedBatches.some((b) => b.phase !== "Ended")) &&
              (() => {
                const eligible = joinedBatches.filter((b) => {
                  if (isConnected && b.userDeposited > 0 && b.phase !== "Lobby") return false;
                  if (b.phase === "Ended") return false;
                  return true;
                });
                const { joined, available } = isConnected
                  ? splitByJoined(eligible)
                  : { joined: [] as JoinedBatchItem[], available: [...eligible].sort((a, b) => a.batchId - b.batchId) };
                const visibleAvailable = available.slice(0, lobbyAvailableCount);
                const renderRow = (b: JoinedBatchItem) => {
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
                        </div>
                        {b.userDeposited > 0 && (
                          <div className="flex flex-col gap-0.5 mt-1">
                            <p className="text-[10px] text-muted font-sans">
                              Staked:{" "}
                              <span className="font-mono text-foreground">
                                {b.userDeposited.toFixed(AMOUNT_DECIMALS)} USDC
                              </span>
                            </p>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                };
                // The other, pre-existing "My Joined Batches" section above
                // (already-started stakes) may or may not have rendered —
                // only add a separating top border here if it did.
                const myJoinedBatchesShown = joinedBatches.some(
                  (b) => b.userDeposited > 0 && b.phase !== "Ended" && b.phase !== "Lobby"
                );
                return (
                  <>
                    {joined.length > 0 && (
                      <div className={`space-y-2 ${isConnected && myJoinedBatchesShown ? "pt-2 border-t border-border-low" : ""}`}>
                        <h2 className="text-lg font-bold">My Staked Batches</h2>
                        <div className="space-y-1.5">{joined.map(renderRow)}</div>
                      </div>
                    )}
                    {available.length > 0 && (
                      <div className={`space-y-2 ${joined.length > 0 ? "pt-2 border-t border-border-low" : ""}`}>
                        <h2 className="text-lg font-bold">
                          {isConnected ? "Available Batches" : "All Batches"}
                        </h2>
                        <div className="space-y-1.5">{visibleAvailable.map(renderRow)}</div>
                        {lobbyAvailableCount < available.length && (
                          <button
                            onClick={() => setLobbyAvailableCount((c) => c + PAGE_SIZE)}
                            className="w-full text-center py-2 text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer"
                          >
                            Load More
                          </button>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
          </>
        )}

        {isLobby && isConnected && (
          <div className="pt-2 border-t border-border-low space-y-1">
            <span className="text-xs font-bold text-muted">Your Total Staked for Upcoming Batches</span>
            <div className="text-xs font-bold text-foreground font-mono">
              {joinedBatches
                .filter((b) => b.phase !== "Ended")
                .reduce((sum, b) => sum + b.userDeposited, 0)
                .toFixed(AMOUNT_DECIMALS)}{" "}
              USDC
            </div>
          </div>
        )}
      </div>

      {/* Treasury Dashboard covers live betting economics (accepted
          predictions, treasury allocation) that don't exist yet during
          Lobby — no voting has happened, so it only applies once a batch
          goes Active. Ended batches show this same data as the main-content
          Batch Summary on /history instead, so it isn't duplicated here. */}
      {!isLobby && !isEnded && (
      <div className="p-6 rounded-2xl backdrop-blur-sm border border-border-low space-y-5">
        <h2 className="text-lg font-bold">Treasury Dashboard</h2>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">No-Risk APY</span>
            <span className="font-mono">{(apyBps / 100).toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Total Pool Stake</span>
            <span className="font-mono">{totalDeposited.toFixed(AMOUNT_DECIMALS)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Bet Size</span>
            <span className="font-mono">{betSize.toFixed(AMOUNT_DECIMALS)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Participants</span>
            <span className="font-mono">{participantCount}</span>
          </div>
        </div>

        <div className="p-3 border border-border-low rounded-lg space-y-2">
          <p className="text-xs text-muted">Total Bet Capital</p>
          <p className="text-2xl font-bold text-foreground">
            {weeklyYieldPool.toFixed(AMOUNT_DECIMALS)} USDC
          </p>
          <div className="w-full bg-neutral-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-foreground dark:bg-white h-2 rounded-full"
              style={{
                width: `${allocatedBudget > 0 ? (remainingBudget / allocatedBudget) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="flex justify-end text-xs text-muted">
            <span>Remaining: {remainingBudget.toFixed(AMOUNT_DECIMALS)} USDC</span>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Accumulated Winnings</span>
            <span className="font-mono">{accumulatedWinnings.toFixed(AMOUNT_DECIMALS)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Remaining Capital</span>
            <span className="font-mono">{remainingBudget.toFixed(AMOUNT_DECIMALS)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Remaining Bet</span>
            <span className="font-mono">
              {remainingBets} prediction{remainingBets !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        <div className="p-3 border border-border-low rounded-lg space-y-1">
          <div className="flex justify-between items-baseline">
            <p className="text-xs text-muted">Current Vault Growth</p>
            <span className="text-xs font-mono text-green-600 dark:text-green-400">
              Unrealized APY: {unrealizedGrowthApy.toFixed(2)}%
            </span>
          </div>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {totalFundGrowth.toFixed(AMOUNT_DECIMALS)} USDC
          </p>
          <p className="text-xs text-muted">
            Accumulated Winnings + Remaining Capital
          </p>
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
              <span className="text-muted">Locked Principal</span>
              <span className="font-mono">{userLockedAmount.toFixed(AMOUNT_DECIMALS)} USDC</span>
            </div>
          </div>
        )}

        <div className="p-3 border border-border-low rounded-lg space-y-2">
          <p className="text-xs text-muted">Current Batch Record</p>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Wins</span>
            <span className="text-foreground font-mono">
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
            <span className="text-muted">Skipped</span>
            <span className="text-amber-600 dark:text-yellow-400 font-mono">
              {batchRecord.skipped}
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
      )}

      {/* Sticky Mobile Batch Selector Button */}
      <button
        onClick={() => setIsDrawerOpen(true)}
        className="fixed bottom-24 right-4 z-40 lg:hidden flex items-center gap-2 px-4 py-3 cursor-pointer  active:scale-95 text-foreground rounded-full border border-border-strong shadow-2xl backdrop-blur-md transition-all duration-200"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-foreground opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-foreground"></span>
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
                {isEnded ? (
                  /* Batch History in Mobile Drawer — same joined/overall
                     split as the desktop card. */
                  joinedBatches &&
                  joinedBatches.some((b) => b.phase === "Ended") &&
                  (() => {
                    const historyBatches = joinedBatches
                      .filter((b) => b.phase === "Ended")
                      .sort((a, b) => b.batchId - a.batchId);
                    const joined = historyBatches.filter((b) => b.userDeposited > 0);
                    const available = historyBatches.filter((b) => b.userDeposited === 0);
                    const visibleAvailable = available.slice(0, historyAvailableCount);
                    const renderRow = (b: JoinedBatchItem) => {
                      const isCurrent = b.batchId === currentBatchId;
                      const isJoined = b.userDeposited > 0;
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
                                className={`text-sm font-bold ${isCurrent || isJoined ? "text-foreground" : "text-muted group-hover:text-foreground"}`}
                              >
                                Batch #{b.batchId}
                              </span>
                            </div>
                            {isJoined && (
                              <div className="flex flex-col gap-0.5 mt-1">
                                <p className="text-xs text-muted font-sans">
                                  Staked:{" "}
                                  <span className="font-mono text-foreground">
                                    {b.userDeposited.toFixed(AMOUNT_DECIMALS)} USDC
                                  </span>
                                </p>
                              </div>
                            )}
                          </div>
                          <div className="text-right flex items-center gap-1.5">
                            {!isCurrent && (
                              <span
                                className={`text-xs font-bold rounded-lg px-2.5 py-1 font-sans transition ${
                                  isJoined && !b.userWithdrawn
                                    ? "text-amber-700 dark:text-amber-400 border border-amber-500/30 bg-amber-500/10"
                                    : "text-muted group-hover:text-foreground border border-border group-hover:border-foreground/50 bg-card dark:bg-neutral-950"
                                }`}
                              >
                                {isJoined ? (b.userWithdrawn ? "Completed" : "Claimable") : "View ➜"}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    };
                    return (
                      <>
                        {joined.length > 0 && (
                          <div className="space-y-2">
                            <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
                              My Batch History
                            </h2>
                            <div className="space-y-2">{joined.map(renderRow)}</div>
                          </div>
                        )}
                        {available.length > 0 && (
                          <div className={`space-y-2 ${joined.length > 0 ? "pt-2 border-t border-border-low" : ""}`}>
                            <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
                              Batch History
                            </h2>
                            <div className="space-y-2">{visibleAvailable.map(renderRow)}</div>
                            {historyAvailableCount < available.length && (
                              <button
                                onClick={() => setHistoryAvailableCount((c) => c + PAGE_SIZE)}
                                className="w-full text-center py-2 text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer"
                              >
                                Load More
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()
                ) : !isLobby ? (
                  /* Live Batches in Mobile Drawer — same joined/available
                     split as the desktop card. */
                  joinedBatches &&
                  joinedBatches.some((b) => b.phase === "Active") &&
                  (() => {
                    const { joined, available } = splitByJoined(joinedBatches.filter((b) => b.phase === "Active"));
                    const visibleAvailable = available.slice(0, liveAvailableCount);
                    const renderRow = (b: JoinedBatchItem) => {
                      const isCurrent = b.batchId === currentBatchId;
                      const isJoined = b.userDeposited > 0;
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
                                className={`text-sm font-bold ${isCurrent || isJoined ? "text-foreground" : "text-muted group-hover:text-foreground"}`}
                              >
                                Batch #{b.batchId}
                              </span>
                            </div>
                            {isJoined && (
                              <div className="flex flex-col gap-0.5 mt-1">
                                <p className="text-xs text-muted font-sans">
                                  Staked:{" "}
                                  <span className="font-mono text-foreground">
                                    {b.userDeposited.toFixed(AMOUNT_DECIMALS)} USDC
                                  </span>
                                </p>
                              </div>
                            )}
                          </div>
                          <div className="text-right flex items-center gap-1.5">
                            <span
                              className={`text-xs font-bold rounded-lg px-2.5 py-1 font-sans transition ${
                                isCurrent
                                  ? "text-foreground border border-foreground/30 bg-foreground/10"
                                  : "text-muted group-hover:text-foreground border border-border group-hover:border-foreground/50 bg-card dark:bg-neutral-950"
                              }`}
                            >
                              {voteStatusLabel(b.voteStatus)}
                            </span>
                          </div>
                        </button>
                      );
                    };
                    return (
                      <>
                        {joined.length > 0 && (
                          <div className="space-y-2">
                            <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
                              My Live Batches
                            </h2>
                            <div className="space-y-2">{joined.map(renderRow)}</div>
                          </div>
                        )}
                        {available.length > 0 && (
                          <div className={`space-y-2 ${joined.length > 0 ? "pt-2 border-t border-border-low" : ""}`}>
                            <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
                              Live Batches
                            </h2>
                            <div className="space-y-2">{visibleAvailable.map(renderRow)}</div>
                            {liveAvailableCount < available.length && (
                              <button
                                onClick={() => setLiveAvailableCount((c) => c + PAGE_SIZE)}
                                className="w-full text-center py-2 text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer"
                              >
                                Load More
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()
                ) : (
                  <>
                    {/* Joined Batches in Mobile Drawer */}
                    {isConnected &&
                      joinedBatches &&
                      joinedBatches.some(
                        (b) => b.userDeposited > 0 && b.phase !== "Ended" && b.phase !== "Lobby"
                      ) && (
                        <div className="space-y-2">
                          <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
                            My Joined Batches
                          </h2>
                          <div className="space-y-2">
                            {joinedBatches.map((b) => {
                              if (b.userDeposited === 0 || b.phase === "Ended" || b.phase === "Lobby")
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
                                  </div>
                                  <div className="text-right flex flex-col justify-center">
                                    <span className="text-[10px] text-muted font-normal uppercase tracking-wider block mb-0.5">
                                      My Stake
                                    </span>
                                    <p className="text-sm font-bold text-foreground font-mono">
                                      {b.userDeposited.toLocaleString()} USDC
                                    </p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    {/* Available Batches in Mobile Drawer — same
                        joined/available split as the desktop card. */}
                    {joinedBatches &&
                      (isConnected
                        ? joinedBatches.some(
                            (b) =>
                              b.phase !== "Ended" &&
                              (b.userDeposited === 0 || b.phase === "Lobby")
                          )
                        : joinedBatches.some((b) => b.phase !== "Ended")) &&
                      (() => {
                        const eligible = joinedBatches.filter((b) => {
                          if (isConnected && b.userDeposited > 0 && b.phase !== "Lobby") return false;
                          if (b.phase === "Ended") return false;
                          return true;
                        });
                        const { joined, available } = isConnected
                          ? splitByJoined(eligible)
                          : { joined: [] as JoinedBatchItem[], available: [...eligible].sort((a, b) => a.batchId - b.batchId) };
                        const visibleAvailable = available.slice(0, lobbyAvailableCount);
                        const myJoinedBatchesShown = joinedBatches.some(
                          (b) => b.userDeposited > 0 && b.phase !== "Ended" && b.phase !== "Lobby"
                        );
                        const renderRow = (b: JoinedBatchItem) => {
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
                                </div>
                                {b.userDeposited > 0 && (
                                  <div className="flex flex-col gap-0.5 mt-1">
                                    <p className="text-xs text-muted font-sans">
                                      Staked:{" "}
                                      <span className="font-mono text-foreground">
                                        {b.userDeposited.toFixed(AMOUNT_DECIMALS)} USDC
                                      </span>
                                    </p>
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        };
                        return (
                          <>
                            {joined.length > 0 && (
                              <div className={`space-y-2 ${isConnected && myJoinedBatchesShown ? "pt-2 border-t border-border-low" : ""}`}>
                                <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
                                  My Staked Batches
                                </h2>
                                <div className="space-y-2">{joined.map(renderRow)}</div>
                              </div>
                            )}
                            {available.length > 0 && (
                              <div className={`space-y-2 ${joined.length > 0 ? "pt-2 border-t border-border-low" : ""}`}>
                                <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
                                  {isConnected ? "Available Batches" : "All Batches"}
                                </h2>
                                <div className="space-y-2">{visibleAvailable.map(renderRow)}</div>
                                {lobbyAvailableCount < available.length && (
                                  <button
                                    onClick={() => setLobbyAvailableCount((c) => c + PAGE_SIZE)}
                                    className="w-full text-center py-2 text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer"
                                  >
                                    Load More
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        );
                      })()}
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
