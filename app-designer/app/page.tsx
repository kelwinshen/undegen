"use client";

import React, { useState, useMemo } from "react";
import ConsensusVoting, { Fixture } from "./components/home/ConsensusVoting";
import SyndicateSidebar from "./components/home/SyndicateSidebar";
import BatchTimer from "./components/home/BatchTimer";
import WithdrawSection from "./components/home/WithdrawSection";
import HowItWorks from "./components/home/HowItWorks";
import FAQ from "./components/home/FAQ";
import LobbyPhase from "./components/home/LobbyPhase";
import SimulationControls from "./components/home/SimulationControls";
import { useUndegenProgram } from "./context/UndegenProgramContext";
import {
  MAX_WEEKLY_BETS,
  WEEKLY_YIELD_RATE,
  GLOBAL_TVL,
} from "./lib/dummyData";

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
    deposit,
    withdraw,
    buyLottery,
    isSimulating,
    setIsSimulating,
    simulatedScore1,
    setSimulatedScore1,
    simulatedScore2,
    setSimulatedScore2,
    liveMatchFinished,
    setLiveMatchFinished,
    simData,
  } = useUndegenProgram();

  const [principal, setPrincipal] = useState("1000");
  const [userVotes, setUserVotes] = useState<Record<number, string>>({});

  const handleDeposit = async (amount: number) => {
    await deposit(amount);
  };

  const handleWithdraw = async () => {
    await withdraw();
  };

  const handleJoinLottery = async () => {
    await buyLottery();
  };

  const selectedBatchState = useMemo(() => {
    return batches.find((b) => b.batchId === selectedBatchId) || null;
  }, [batches, selectedBatchId]);

  const activeBatchState = useMemo(() => {
    if (isSimulating && selectedBatchId === 5) {
      return simData.mockBatchState;
    }
    return selectedBatchState;
  }, [isSimulating, selectedBatchId, simData, selectedBatchState]);

  const activeFixtures = isSimulating ? simData.mockFixtures : fixtures;
  const activeVotes = isSimulating ? simData.mockVotes : votes;
  const activeDecisions = isSimulating ? simData.mockDecisions : matchDecisions;
  const activeLiveScores = isSimulating ? simData.mockScores : undefined;

  const weeklyYieldPool =
    activeBatchState?.weeklyYieldPool ?? GLOBAL_TVL * WEEKLY_YIELD_RATE;

  const acceptedBetsCount =
    selectedBatchId === 5 ? (activeBatchState?.acceptedPredictions ?? 0) : 0;
  const remainingBets =
    selectedBatchId === 5 ? MAX_WEEKLY_BETS - acceptedBetsCount : 5;
  const allocatedBudget =
    selectedBatchId === 5
      ? (acceptedBetsCount / MAX_WEEKLY_BETS) * weeklyYieldPool
      : 0;
  const remainingBudget = weeklyYieldPool - allocatedBudget;

  const userLockedAmount =
    selectedBatchId === 5
      ? parseFloat(principal) || 0
      : (activeBatchState?.userDeposited ?? 0);

  const userPoolShare =
    selectedBatchId === 5
      ? userLockedAmount / (activeBatchState?.totalDeposited ?? GLOBAL_TVL)
      : activeBatchState?.totalDeposited && activeBatchState.totalDeposited > 0
        ? userLockedAmount / activeBatchState.totalDeposited
        : 0;

  const userWeeklyYield = userPoolShare * weeklyYieldPool;
  const dailyYieldProjection = weeklyYieldPool / 7;
  const batchWeek =
    activeBatchState?.phase === "Active"
      ? `Active Batch`
      : activeBatchState?.phase === "Ended"
        ? `Ended Batch (${selectedBatchId})`
        : `Lobby Batch (${selectedBatchId})`;

  // User's deposits in each batch
  const joinedBatches = useMemo(() => {
    return batches.map((b) => {
      let userDeposited = isConnected ? b.userDeposited : 0;
      if (b.batchId === 5 && isConnected) {
        userDeposited = parseFloat(principal) || 0;
      }
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
      };
    });
  }, [isConnected, principal, batches]);

  if (isLoading || !activeBatchState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg1">
        <div className="animate-pulse text-gray-400">Loading syndicate...</div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-foreground">
      <main className="relative z-10 mx-auto flex max-w-6xl min-h-screen  flex-col gap-8 border-border-low px-6 pt-28 pb-28 md:pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {activeBatchState?.phase === "Active" ||
            activeBatchState?.phase === "Ended" ? (
              <>
                <BatchTimer
                  remainingBets={remainingBets}
                  phase={activeBatchState?.phase}
                  batchWeek={batchWeek}
                />
                {activeBatchState?.phase === "Ended" && (
                  <WithdrawSection
                    batchId={selectedBatchId}
                    userDeposited={activeBatchState.userDeposited}
                    userWithdrawn={activeBatchState.userWithdrawn}
                    isConnected={isConnected}
                    onWithdraw={handleWithdraw}
                    onJoinLottery={handleJoinLottery}
                  />
                )}
                <ConsensusVoting
                  isLoading={isLoading}
                  fixtures={activeFixtures}
                  userVotes={userVotes}
                  setUserVotes={setUserVotes}
                  simulatedVotes={activeVotes}
                  matchDecisions={activeDecisions}
                  remainingBets={remainingBets}
                  weeklyYieldPool={weeklyYieldPool}
                  batchWeek={batchWeek}
                  overrideLiveScores={activeLiveScores}
                  isEnded={activeBatchState?.phase === "Ended"}
                />
              </>
            ) : (
              <LobbyPhase
                batchId={selectedBatchId}
                batchStartTime={activeBatchState?.batchStartTime ?? Date.now()}
                userDeposited={activeBatchState?.userDeposited ?? 0}
                totalDeposited={activeBatchState?.totalDeposited ?? 420000}
                participantCount={activeBatchState?.participantCount ?? 87}
                minimumDeposit={activeBatchState?.minimumDeposit ?? 100}
                projectedDailyYield={weeklyYieldPool / 7}
                onDeposit={handleDeposit}
                onWithdraw={handleWithdraw}
              />
            )}
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
              phase={activeBatchState?.phase ?? "Active"}
              batchRecord={
                isSimulating
                  ? liveMatchFinished
                    ? { wins: 2, losses: 1, pending: 1 }
                    : { wins: 1, losses: 1, pending: 2 }
                  : { wins: 2, losses: 1, pending: 2 }
              }
              joinedBatches={joinedBatches}
              currentBatchId={selectedBatchId}
              onNavigateToBatch={(batchId) => setSelectedBatchId(batchId)}
            />
          </div>
        </div>
        <HowItWorks />
        <FAQ />
      </main>

      <SimulationControls
        isSimulating={isSimulating}
        setIsSimulating={(val) => {
          setIsSimulating(val);
          if (!val) {
            setSimulatedScore1(2);
            setSimulatedScore2(1);
            setLiveMatchFinished(false);
          }
        }}
        onTriggerGoal={() => {
          if (Math.random() > 0.5) {
            setSimulatedScore1((prev) => prev + 1);
          } else {
            setSimulatedScore2((prev) => prev + 1);
          }
        }}
        onSettleMatch={() => {
          setLiveMatchFinished(true);
        }}
        liveMatchFinished={liveMatchFinished}
      />
    </div>
  );
}
