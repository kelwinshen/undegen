"use client";

import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import WithdrawSection from "../components/WithdrawSection";
import SyndicateSidebar from "../components/SyndicateSidebar";
import HowItWorks from "../components/HowItWorks";
import FAQ from "../components/FAQ";
import { useUndegenProgram } from "../context/UndegenProgramContext";
import { previewClaimAmount, fetchActiveLotteryRound } from "../services/undegenProgram";
import { SOLANA_CONFIG } from "../lib/solanaConfig";

// USDC's on-chain precision — shown in full rather than rounded so these
// figures never silently disagree with the on-chain amounts they represent.
const AMOUNT_DECIMALS = SOLANA_CONFIG.TOKEN_DECIMALS;

export default function HistoryPage() {
  const {
    batches,
    isLoading,
    isConnected,
    walletAddress,
    claim,
    claimAndJoinLottery,
    selectedBatchId,
    setSelectedBatchId,
  } = useUndegenProgram();

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Real preview of what `claim` will actually pay out for the focused
  // batch — fetched separately from `batches` because it needs live
  // yield_vault + batch_token_account balances that BatchState doesn't
  // carry. Reset to null while (re)loading so stale numbers from a
  // previously focused batch never show for the new one.
  const [claimPreview, setClaimPreview] = useState<{ principal: number; earnings: number; total: number } | null>(
    null
  );
  // Whether the lottery has an Open round right now — the real
  // `claim_and_join_lottery` instruction reverts without one, so the
  // "Join Lottery" button stays disabled until this comes back true.
  const [lotteryAvailable, setLotteryAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchActiveLotteryRound().then((round) => {
      if (!cancelled) setLotteryAvailable(round !== null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const endedBatches = useMemo(
    () =>
      batches
        .filter((b) => b.phase === "Ended")
        .sort((a, b) => b.batchId - a.batchId),
    [batches]
  );

  // The page only ever shows the single Ended batch currently focused — the
  // selected one if it's an Ended batch, else the most recently ended one.
  // Switching batches happens via the sidebar's Batch History list, not an
  // in-page dropdown.
  const focusedBatch = useMemo(() => {
    const selected = endedBatches.find((b) => b.batchId === selectedBatchId);
    return selected ?? endedBatches[0] ?? null;
  }, [endedBatches, selectedBatchId]);

  const focusedBatchId = focusedBatch?.batchId;
  const focusedUserDeposited = focusedBatch?.userDeposited ?? 0;
  const focusedUserWithdrawn = focusedBatch?.userWithdrawn ?? false;
  useEffect(() => {
    setClaimPreview(null);
    // Nothing left to preview once already claimed — the payout was decided
    // by that transaction, not by whatever the live vault/batch balances say
    // now (which keep shifting as other users claim afterward).
    if (!isConnected || !walletAddress || !focusedBatchId || focusedUserDeposited <= 0 || focusedUserWithdrawn) {
      return;
    }
    let cancelled = false;
    previewClaimAmount(focusedBatchId, walletAddress).then((preview) => {
      if (!cancelled) setClaimPreview(preview);
    });
    return () => {
      cancelled = true;
    };
  }, [isConnected, walletAddress, focusedBatchId, focusedUserDeposited, focusedUserWithdrawn]);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const joinedBatches = useMemo(() => {
    return endedBatches.map((b) => {
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
        userWithdrawn: b.userWithdrawn,
      };
    });
  }, [isConnected, endedBatches]);

  // `claim` (not `withdraw`/leave_batch, which is Lobby-only) is the real
  // on-chain instruction for a Settled batch — it pays out principal and
  // this user's share of accumulated winnings together in one transaction.
  const handleClaim = async () => {
    if (!focusedBatch) return;
    try {
      await claim(focusedBatch.batchId);
      setToastMessage(`Successfully claimed your funds from Batch #${focusedBatch.batchId}!`);
    } catch (e) {
      console.error(e);
      setToastMessage(`Failed to claim from Batch #${focusedBatch.batchId}`);
    }
  };

  // Same payout as claim, except the earnings leg buys a lottery ticket
  // instead of landing in the wallet — real `claim_and_join_lottery`.
  const handleJoinLottery = async () => {
    if (!focusedBatch) return;
    try {
      await claimAndJoinLottery(focusedBatch.batchId);
      setToastMessage(
        `Claimed Batch #${focusedBatch.batchId} — earnings wagered into this week's lottery!`
      );
    } catch (e) {
      console.error(e);
      setToastMessage(`Failed to join the lottery from Batch #${focusedBatch.batchId}`);
    }
  };

  const maxPredictions = focusedBatch?.maxPredictions ?? 5;
  const acceptedBetsCount = focusedBatch?.acceptedPredictions ?? 0;
  const remainingBets = maxPredictions - acceptedBetsCount;
  const betSize = focusedBatch?.betSize ?? 0;
  // bet_size was fixed on-chain at lock time (weekly yield ÷ MAX_BETS) and
  // never changes afterward — unlike totalDeposited, which `claim` actively
  // decrements as each user claims (see claim.rs: "decrementing the static
  // pool denominator for the next claimer"). Deriving this batch's capital
  // figures from betSize instead of the live totalDeposited keeps the
  // "final" summary of a Settled batch from visibly shrinking every time
  // someone else claims.
  const weeklyYieldPool = betSize * maxPredictions;
  const originalTotalDeposited =
    focusedBatch && focusedBatch.apyBps > 0
      ? (weeklyYieldPool * 52 * 10000) / focusedBatch.apyBps
      : (focusedBatch?.totalDeposited ?? 0);
  const realBetsCount = (focusedBatch?.winsCount ?? 0) + (focusedBatch?.lossesCount ?? 0);
  const allocatedBudget = weeklyYieldPool;
  const remainingBudget = allocatedBudget - realBetsCount * betSize;
  const batchRecord = {
    wins: focusedBatch?.winsCount ?? 0,
    losses: focusedBatch?.lossesCount ?? 0,
    skipped: focusedBatch?.skipsCount ?? 0,
  };

  const userLockedAmount = focusedBatch?.userDeposited ?? 0;
  const userPoolShare = originalTotalDeposited > 0 ? userLockedAmount / originalTotalDeposited : 0;

  // Same "growth" math as the sidebar's Treasury Dashboard (accumulated
  // winnings + whatever bet capital was never put at risk), annualized —
  // except here the batch is Ended, so it's the batch's real, final result
  // rather than an in-progress estimate.
  const totalFundGrowth = (focusedBatch?.accumulatedWinnings ?? 0) + remainingBudget;
  const finalApy = originalTotalDeposited > 0 ? (totalFundGrowth * 52 * 100) / originalTotalDeposited : 0;

  // Real claim preview (see previewClaimAmount) — falls back to the raw
  // deposit while the RPC preview is still loading, so the donut/figures
  // render immediately with a reasonable value and refine once the real
  // vault + batch balances come back.
  const previewPrincipal = claimPreview?.principal ?? userLockedAmount;
  const previewEarnings = claimPreview?.earnings ?? 0;
  const previewTotal = claimPreview?.total ?? previewPrincipal;
  const userStakePct = previewTotal > 0 ? (previewPrincipal / previewTotal) * 100 : 100;
  const isClaimPreviewLoading = isConnected && userLockedAmount > 0 && claimPreview === null;

  const totalRecord = batchRecord.wins + batchRecord.losses + batchRecord.skipped;
  const winsPct = totalRecord > 0 ? (batchRecord.wins / totalRecord) * 100 : 0;
  const lossesPct = totalRecord > 0 ? (batchRecord.losses / totalRecord) * 100 : 0;
  const skippedPct = totalRecord > 0 ? (batchRecord.skipped / totalRecord) * 100 : 0;

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
        <div className="text-muted text-lg font-semibold">No ended batches yet</div>
        <p className="text-muted text-sm max-w-sm">
          Check back once a batch settles, or view{" "}
          <a href="/upcoming" className="underline hover:text-foreground">Upcoming</a> to join
          the next one.
        </p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-foreground">
      {/* Toast Alert */}
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
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-neutral-100 text-neutral-800 border border-neutral-200 dark:bg-neutral-500/10 dark:text-neutral-400 dark:border-neutral-500/20">
                    {focusedBatch.phase}
                  </span>
                </h2>
                <p className="text-sm text-muted mt-1">
                  This batch has settled. Review its final results below, and
                  claim your funds if you joined.
                </p>
              </div>
            </div>

            {isConnected && userLockedAmount > 0 ? (
              /* Your Results — this user's personal outcome for this batch,
                 front and center: stake vs. earned share of the batch's real
                 accumulated winnings, visualized as a donut so the split is
                 legible at a glance, plus the actual claim action. */
              <div className="p-6 rounded-2xl border border-foreground/15 bg-foreground/[0.02] backdrop-blur-sm space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-foreground">Your Results</h2>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                      focusedBatch.userWithdrawn
                        ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-500/20"
                    }`}
                  >
                    {focusedBatch.userWithdrawn ? "Claimed" : "Claimable"}
                  </span>
                </div>

                {focusedBatch.userWithdrawn ? (
                  // Already claimed — the real payout was decided by that
                  // transaction, not by whatever the live vault/batch balances
                  // say now (those keep shifting as other users claim after
                  // you), so there's nothing further to preview here.
                  <div className="p-4 rounded-xl bg-foreground/5 border border-border-low flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
                    <p className="text-xs text-foreground">
                      You've already claimed your stake and earnings from this batch.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col sm:flex-row items-center gap-6">
                      <div
                        className="relative w-28 h-28 rounded-full shrink-0"
                        style={{
                          background: `conic-gradient(var(--foreground) 0% ${userStakePct}%, #22c55e ${userStakePct}% 100%)`,
                        }}
                      >
                        <div className="absolute inset-2 rounded-full bg-card dark:bg-neutral-950 flex flex-col items-center justify-center text-center px-2">
                          <span className="text-[9px] text-muted uppercase tracking-wider">Total Payout</span>
                          <span className="text-sm font-bold font-mono text-foreground leading-tight">
                            {previewTotal.toFixed(AMOUNT_DECIMALS)}
                          </span>
                        </div>
                      </div>

                      <div className="flex-1 w-full grid grid-cols-2 gap-4">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-foreground inline-block" />
                            <p className="text-xs text-muted">Your Stake</p>
                          </div>
                          <p className="font-mono text-foreground text-lg font-bold mt-0.5">
                            {previewPrincipal.toFixed(AMOUNT_DECIMALS)}
                            <span className="text-xs font-sans text-muted ml-1">USDC</span>
                          </p>
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                            <p className="text-xs text-muted">Your Earnings (est.)</p>
                          </div>
                          <p className="font-mono text-green-600 dark:text-green-400 text-lg font-bold mt-0.5">
                            {isClaimPreviewLoading ? (
                              <span className="text-muted animate-pulse">calculating…</span>
                            ) : (
                              <>
                                ~+{previewEarnings.toFixed(AMOUNT_DECIMALS)}
                                <span className="text-xs font-sans text-muted ml-1">USDC</span>
                              </>
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted">Pool Share</p>
                          <p className="font-mono text-foreground mt-0.5">
                            {(userPoolShare * 100).toFixed(5)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted">Principal</p>
                          <p className="font-mono text-foreground mt-0.5">Always protected</p>
                        </div>
                      </div>
                    </div>

                    <p className="text-[10px] text-muted/70">
                      ~ Estimated from live vault and batch balances — the actual
                      claimed amount may slip slightly by the time your
                      transaction lands.
                    </p>
                  </>
                )}

                <WithdrawSection
                  batchId={focusedBatch.batchId}
                  userDeposited={focusedBatch.userDeposited}
                  userWithdrawn={focusedBatch.userWithdrawn}
                  isConnected={isConnected}
                  onClaim={handleClaim}
                  onJoinLottery={handleJoinLottery}
                  lotteryAvailable={lotteryAvailable}
                />
              </div>
            ) : (
              <div className="p-4 text-center border border-dashed border-border-low rounded-xl">
                <p className="text-xs text-muted font-light">
                  {isConnected
                    ? "You didn't stake into this batch — nothing to claim."
                    : "Connect your wallet to view or claim your stake."}
                </p>
              </div>
            )}

            {/* Batch Summary — the same figures the Treasury Dashboard shows
                for a Live batch (No-Risk APY, pool stake, bet size, vault
                growth, batch record), but as this batch's final, settled
                numbers rather than an in-progress read. */}
            <div className="p-6 rounded-2xl backdrop-blur-sm border border-border-low space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Batch Summary</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-neutral-100 text-neutral-800 border border-neutral-200 dark:bg-neutral-500/10 dark:text-neutral-400 dark:border-neutral-500/20">
                  Completed
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted">No-Risk APY</p>
                  <p className="font-mono text-foreground mt-0.5">
                    {(focusedBatch.apyBps / 100).toFixed(2)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">Total Pool Stake</p>
                  <p className="font-mono text-foreground mt-0.5">
                    {originalTotalDeposited.toFixed(AMOUNT_DECIMALS)} USDC
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">Bet Size</p>
                  <p className="font-mono text-foreground mt-0.5">{betSize.toFixed(AMOUNT_DECIMALS)} USDC</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Participants</p>
                  <p className="font-mono text-foreground mt-0.5">{focusedBatch.participantCount}</p>
                </div>
              </div>

              <div className="p-4 border border-border-low rounded-xl space-y-2">
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
                <div className="flex justify-between text-xs text-muted">
                  <span>Accumulated Winnings: {focusedBatch.accumulatedWinnings.toFixed(AMOUNT_DECIMALS)} USDC</span>
                  <span>Remaining: {remainingBudget.toFixed(AMOUNT_DECIMALS)} USDC</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted">Batch Record</p>
                {totalRecord > 0 && (
                  <div className="w-full h-2.5 rounded-full overflow-hidden flex bg-neutral-200 dark:bg-gray-700">
                    {winsPct > 0 && (
                      <div className="h-full bg-foreground dark:bg-white" style={{ width: `${winsPct}%` }} />
                    )}
                    {lossesPct > 0 && (
                      <div className="h-full bg-red-500" style={{ width: `${lossesPct}%` }} />
                    )}
                    {skippedPct > 0 && (
                      <div className="h-full bg-amber-500" style={{ width: `${skippedPct}%` }} />
                    )}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 border border-border-low rounded-lg text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-foreground inline-block" />
                      <p className="text-xs text-muted">Wins</p>
                    </div>
                    <p className="text-lg font-bold text-foreground font-mono mt-0.5">
                      {batchRecord.wins}
                    </p>
                  </div>
                  <div className="p-3 border border-border-low rounded-lg text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                      <p className="text-xs text-muted">Losses</p>
                    </div>
                    <p className="text-lg font-bold text-red-600 dark:text-red-400 font-mono mt-0.5">
                      {batchRecord.losses}
                    </p>
                  </div>
                  <div className="p-3 border border-border-low rounded-lg text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                      <p className="text-xs text-muted">Skipped</p>
                    </div>
                    <p className="text-lg font-bold text-amber-600 dark:text-yellow-400 font-mono mt-0.5">
                      {batchRecord.skipped}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 border border-border-low rounded-xl space-y-1">
                <div className="flex justify-between items-baseline">
                  <p className="text-xs text-muted">Final Vault Growth</p>
                  <span className="text-xs font-mono text-green-600 dark:text-green-400">
                    Realized APY: {finalApy.toFixed(2)}%
                  </span>
                </div>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {totalFundGrowth.toFixed(AMOUNT_DECIMALS)} USDC
                </p>
                <p className="text-xs text-muted">
                  Accumulated Winnings + Remaining Capital
                </p>
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
            </div>
          </div>

          <div className="space-y-6">
            <SyndicateSidebar
              isLoading={isLoading}
              weeklyYieldPool={weeklyYieldPool}
              apyBps={focusedBatch.apyBps}
              betSize={betSize}
              totalDeposited={focusedBatch.totalDeposited}
              participantCount={focusedBatch.participantCount}
              allocatedBudget={allocatedBudget}
              remainingBudget={remainingBudget}
              accumulatedWinnings={focusedBatch.accumulatedWinnings}
              remainingBets={remainingBets}
              userPoolShare={userPoolShare}
              userLockedAmount={userLockedAmount}
              isConnected={isConnected}
              phase="Ended"
              batchRecord={batchRecord}
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
