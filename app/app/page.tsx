"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import logoOnly from "./assets/logo-only.png";
import ConsensusVoting from "./components/ConsensusVoting";
import SyndicateSidebar from "./components/SyndicateSidebar";
import BatchTimer from "./components/BatchTimer";
import HowItWorks from "./components/HowItWorks";
import FAQ from "./components/FAQ";
import BannerSlider from "./components/SliderBanner";
import { useUndegenProgram } from "./context/UndegenProgramContext";
import {
  describeBatchBetTerms,
  BetTermProposal,
} from "./services/undegenProgram";

// The Live Batches picker's lifecycle label for each batch's current bet:
// no-match (nothing proposed yet) -> voting (status Locked, consensus still
// open) -> voting-ended (status AwaitingCollateral, operator has finalized
// consensus and just needs to deposit collateral) -> active (status Active,
// operator has deposited collateral).
type BatchVoteStatus = "no-match" | "voting" | "voting-ended" | "active";

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
    settleDefault,
  } = useUndegenProgram();

  const [userVotes, setUserVotes] = useState<Record<number, string>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);
  // Per-batch voting/match status for the sidebar's Live Batches list — each
  // Active batch's fixture mapping is fetched independently of whichever
  // batch is currently selected/focused, since that only drives `fixtures`.
  const [batchVoteStatus, setBatchVoteStatus] = useState<
    Record<number, BatchVoteStatus>
  >({});
  // Human-readable version of the focused batch's raw bet_terms, for when
  // fixtures hasn't resolved a real match yet (still shows something a user
  // can actually read instead of bare on-chain numbers).
  const [betTermProposals, setBetTermProposals] = useState<BetTermProposal[]>(
    []
  );
  const betTermProposalsRequestId = useRef(0);
  const latestAppliedBetTermProposalsRequestId = useRef(0);

  // Voting Session / No Match / Voting Ended, straight off the real on-chain
  // BatchStatus — same field app/test/batch-details reads, no Redis, no
  // TxOdds. cast_vote and propose_match both require status === "Locked",
  // so that's "voting is open"; whether it's actually open for a real match
  // depends on whether a proposal exists yet (bet_terms has a non-zero
  // fixtureId). AwaitingCollateral means finalize_consensus already ran —
  // voting is done, operator just hasn't deposited collateral yet.
  // Active (ongoing/awaiting-result) isn't wired up yet.
  useEffect(() => {
    const results: Record<number, BatchVoteStatus> = {};
    for (const b of batches) {
      if (b.rawStatus === "Locked") {
        const hasProposal = b.betTerms.some((t) => t.fixtureId > 0);
        results[b.batchId] = hasProposal ? "voting" : "no-match";
      } else if (b.rawStatus === "AwaitingCollateral") {
        results[b.batchId] = "voting-ended";
      } else if (b.rawStatus === "Active") {
        results[b.batchId] = "active";
      }
    }
    setBatchVoteStatus((prev) => ({ ...prev, ...results }));
  }, [batches]);

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
    if (!liveBatchState) {
      setBetTermProposals([]);
      return;
    }
    // Gate on the latest *applied* result, not the latest *started* one — a
    // slow request (e.g. a Redis hiccup) can still resolve with good data
    // after a newer poll tick has already kicked off its own request; as
    // long as that newer one hasn't actually applied yet, this one should
    // still win rather than being silently discarded.
    const requestId = ++betTermProposalsRequestId.current;
    describeBatchBetTerms(liveBatchState, options).then((proposals) => {
      if (requestId >= latestAppliedBetTermProposalsRequestId.current) {
        latestAppliedBetTermProposalsRequestId.current = requestId;
        setBetTermProposals(proposals);
      }
    });
  }, [liveBatchState, options]);

  const weeklyYieldPool = liveBatchState?.weeklyYieldPool ?? 0;
  const apyBps = liveBatchState?.apyBps ?? 0;
  const betSize = liveBatchState?.betSize ?? 0;
  const maxPredictions = liveBatchState?.maxPredictions ?? 5;
  const acceptedBetsCount = liveBatchState?.acceptedPredictions ?? 0;
  const remainingBets = maxPredictions - acceptedBetsCount;
  // "Allocated" is the whole weekly yield pool committed to this batch's
  // betting — real data, same figure as Total Bet Capital. "Remaining" is
  // what's left after completed bets have each drawn their fixed bet_size —
  // skips don't count against it since a skip pays the same bet_size straight
  // back out rather than putting it at risk, so the capital isn't consumed.
  const realBetsCount =
    (liveBatchState?.winsCount ?? 0) + (liveBatchState?.lossesCount ?? 0);
  const allocatedBudget = weeklyYieldPool;
  const remainingBudget = allocatedBudget - realBetsCount * betSize;

  // createdAt is the only real whole-batch timestamp on-chain — kickoff_timestamp
  // is per-match and resets to 0 after every settlement, so it can't anchor a
  // 7-day batch countdown.
  const batchEndTime =
    liveBatchState?.createdAt != null
      ? liveBatchState.createdAt + 7 * 24 * 60 * 60 * 1000
      : null;

  // Real cumulative record across every bet this batch has settled so far —
  // straight off the on-chain running counters (wins_count/losses_count/
  // skips_count), not just whichever single bet happens to be in flight
  // right now.
  const batchRecord = {
    wins: liveBatchState?.winsCount ?? 0,
    losses: liveBatchState?.lossesCount ?? 0,
    skipped: liveBatchState?.skipsCount ?? 0,
  };

  const userLockedAmount = liveBatchState?.userDeposited ?? 0;
  const userPoolShare =
    liveBatchState?.totalDeposited && liveBatchState.totalDeposited > 0
      ? userLockedAmount / liveBatchState.totalDeposited
      : 0;

  // Only participants who deposited during this batch's Lobby phase can vote —
  // spectating other syndicate batches is fine, but voting requires skin in the game.
  const canVote = isConnected && userLockedAmount > 0;

  // User's deposits across every batch (for the sidebar's portfolio list)
  const joinedBatches = useMemo(() => {
    return batches.map((b) => {
      const userDeposited = isConnected ? b.userDeposited : 0;
      const poolShare =
        b.totalDeposited > 0 ? userDeposited / b.totalDeposited : 0;
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
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <motion.div
          animate={{
            opacity: [0.3, 1, 0.3],
            scale: [0.95, 1.05, 0.95],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="relative w-16 h-16"
        >
          <Image
            src={logoOnly}
            alt="Undegen Logo"
            fill
            className="object-contain"
            priority
          />
        </motion.div>
        <motion.div
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 0.2,
          }}
          className="text-sm font-semibold tracking-widest text-muted uppercase font-sans"
        >
          Loading...
        </motion.div>
      </div>
    );
  }

  if (!liveBatchState) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
        <div className="rounded-2xl backdrop-blur-sm border border-border-low bg-card/30 dark:bg-card/10 p-8 max-w-md w-full space-y-5">
          <div className="space-y-2">
            <div className="text-muted text-lg font-semibold">
              No live batch right now
            </div>
            <p className="text-muted text-sm max-w-sm mx-auto">
              Nothing is currently in consensus voting. Check{" "}
              <a href="/upcoming" className="underline hover:text-foreground">
                Upcoming
              </a>{" "}
              to join the next batch, or{" "}
              <a href="/history" className="underline hover:text-foreground">
                History
              </a>{" "}
              for past results.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/upcoming"
              className="inline-flex items-center justify-center w-full rounded-xl bg-foreground text-background px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition hover:-translate-y-0.5 hover:shadow-sm"
            >
              JOIN UPCOMING BATCH
            </Link>
          </div>
        </div>
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

      <main className="relative z-10 mx-auto flex max-w-6xl min-h-screen  flex-col gap-8 border-border-low px-6 pt-28 pb-28 md:pb-12">
        <BannerSlider />
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
              onSettleDefault={() => settleDefault(liveBatchState.batchId)}
              onResult={setToastMessage}
              userVotedIndex={liveBatchState.userVotedIndex}
              voteWeights={liveBatchState.voteWeights}
              // Voting is done once consensus locked, whether the operator has
              // deposited collateral yet (AwaitingCollateral) or already has
              // (Active) — both keep the vote UI in its "completed" state.
              isVotingCompleted={
                liveBatchState.rawStatus === "AwaitingCollateral" ||
                liveBatchState.rawStatus === "Active"
              }
              isActive={liveBatchState.rawStatus === "Active"}
              winningVoteIndex={liveBatchState.winningVoteIndex}
              matchStartTime={liveBatchState.batchStartTime}
              realAcceptedCount={
                liveBatchState.winsCount + liveBatchState.lossesCount
              }
              skippedCount={liveBatchState.skipsCount}
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
              accumulatedWinnings={liveBatchState.accumulatedWinnings}
              remainingBets={remainingBets}
              userPoolShare={userPoolShare}
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
