"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import Header from "./components/home/Header";
import DashboardMetrics from "./components/home/DashboardMetrics";
import ConsensusVoting, { Fixture, Option } from "./components/home/ConsensusVoting";
import SyndicateSidebar from "./components/home/SyndicateSidebar";
import BatchTimer from "./components/home/BatchTimer";
import HowItWorks from "./components/home/HowItWorks";
import FAQ from "./components/home/FAQ";
import {
  fetchBatchState,
  fetchVotes,
  generateDecisionForFixture,
  BatchState,
  VoteResult,
} from "./services/undegenProgram";
import { MAX_WEEKLY_BETS, WEEKLY_YIELD_RATE, GLOBAL_TVL } from "./lib/dummyData";

const ACTIVE_BATCH_ID = 1;

export default function Home() {
  const { status, wallet } = useWalletConnection();
  const isConnected = status === "connected";
  const address = wallet?.account.address?.toString() ?? null;

  const [principal, setPrincipal] = useState("1000");
  const [userVotes, setUserVotes] = useState<Record<number, string>>({});
  const [options, setOptions] = useState<Option[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [batchState, setBatchState] = useState<BatchState | null>(null);
  const [simulatedVotes, setSimulatedVotes] = useState<Record<string, number>>({});
  const [matchDecisions, setMatchDecisions] = useState<Record<number, VoteResult>>({});
  const [batchStart, setBatchStart] = useState<number | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [optionsRes, batch] = await Promise.all([
          fetch('/api/txodds?all=1').then(r => r.json()), // Added ?all=1 to match test hub data scope
          fetchBatchState(ACTIVE_BATCH_ID, isConnected ? address : null),
        ]);
        setOptions(optionsRes.options || []);
        if (optionsRes.batchStart) setBatchStart(new Date(optionsRes.batchStart).getTime());
        setBatchState(batch);
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [isConnected, address]);

  const fixtures: Fixture[] = useMemo(() => {
    const map = new Map<number, Fixture>();
    options.forEach((opt) => {
      if (!map.has(opt.fixtureId)) {
        map.set(opt.fixtureId, {
          fixtureId: opt.fixtureId,
          participant1: opt.participant1,
          participant2: opt.participant2,
          startTime: opt.startTime,
          options: [],
        });
      }
      map.get(opt.fixtureId)!.options.push(opt);
    });
    return Array.from(map.values()).sort((a, b) => a.startTime - b.startTime);
  }, [options]);

  useEffect(() => {
    if (fixtures.length === 0) return;
    const loadVotes = async () => {
      const votes = await fetchVotes(fixtures);
      setSimulatedVotes(votes);
    };
    loadVotes();
  }, [fixtures]);

  const sortedFixtures = useMemo(() => {
    return [...fixtures].sort((a, b) => a.startTime - b.startTime);
  }, [fixtures]);

  const betsUsed = useMemo(() => {
    return Object.values(matchDecisions).filter(d => d.accepted).length;
  }, [matchDecisions]);

  const getActiveFixtureId = (): number | null => {
    for (const fixture of sortedFixtures) {
      const decision = matchDecisions[fixture.fixtureId];
      if (decision) continue;
      return fixture.fixtureId;
    }
    return null;
  };

  const [activeFixtureId, setActiveFixtureId] = useState<number | null>(null);

  useEffect(() => {
    setActiveFixtureId(getActiveFixtureId());
  }, [sortedFixtures, matchDecisions]);

  useEffect(() => {
    if (!activeFixtureId || Object.keys(simulatedVotes).length === 0) return;

    const fixture = sortedFixtures.find(f => f.fixtureId === activeFixtureId);
    if (!fixture) return;

    const now = Date.now();
    if (fixture.startTime <= now) {
      const decision = generateDecisionForFixture(
        fixture.fixtureId,
        simulatedVotes,
        fixture.options,
        betsUsed,
        MAX_WEEKLY_BETS,
        batchStart ?? 0
      );
      setMatchDecisions(prev => ({ ...prev, [fixture.fixtureId]: decision }));
    }
  }, [activeFixtureId, simulatedVotes, sortedFixtures, betsUsed, batchStart]);

  const handleSkip = (fixtureId: number) => {
    if (fixtureId !== activeFixtureId) return;

    const fixture = sortedFixtures.find(f => f.fixtureId === fixtureId);
    if (!fixture) return;

    const skipId = `${fixtureId}-skip`;
    const decision = generateDecisionForFixture(
      fixtureId,
      simulatedVotes,
      fixture.options,
      betsUsed,
      MAX_WEEKLY_BETS,
      batchStart ?? 0
    );

    setMatchDecisions(prev => ({ ...prev, [fixtureId]: { ...decision, winnerOptionId: skipId, isSkip: true, accepted: false } }));
  };

  const weeklyYieldPool = batchState?.weeklyYieldPool ?? GLOBAL_TVL * WEEKLY_YIELD_RATE;
  const acceptedBetsCount = betsUsed;
  const remainingBets = MAX_WEEKLY_BETS - acceptedBetsCount;
  const allocatedBudget = (acceptedBetsCount / MAX_WEEKLY_BETS) * weeklyYieldPool;
  const remainingBudget = weeklyYieldPool - allocatedBudget;
  const userLockedAmount = parseFloat(principal) || 0;
  const userPoolShare = userLockedAmount / GLOBAL_TVL;
  const userWeeklyYield = userPoolShare * weeklyYieldPool;
  const dailyYieldProjection = weeklyYieldPool / 7;
  const batchWeek = `Active Batch (${ACTIVE_BATCH_ID})`;

  const handleVote = (fixtureId: number, optionId: string) => {
    if (fixtureId !== activeFixtureId) return;
    const fixture = fixtures.find(f => f.fixtureId === fixtureId);
    if (fixture && fixture.startTime <= Date.now()) return;
    setUserVotes(prev => ({ ...prev, [fixtureId]: optionId }));
  };

  if (isLoading || !batchState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg1">
        <div className="animate-pulse text-gray-400">Loading syndicate...</div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg1 text-foreground">
      <main className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col gap-8 border-x border-border-low px-6 py-12">
        <Header />
        <DashboardMetrics
          principal={principal}
          setPrincipal={setPrincipal}
          userDailyYield={userWeeklyYield / 7}
          globalTVL={GLOBAL_TVL}
          globalDailyYield={dailyYieldProjection}
          isConnected={isConnected}
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <BatchTimer remainingBets={remainingBets} phase="Active" />
            <ConsensusVoting
              isLoading={isLoading}
              fixtures={sortedFixtures}
              userVotes={userVotes}
              setUserVotes={setUserVotes}
              simulatedVotes={simulatedVotes}
              matchDecisions={matchDecisions}
              remainingBets={remainingBets}
              weeklyYieldPool={weeklyYieldPool}
              batchWeek={batchWeek}
              activeFixtureId={activeFixtureId}
              onSkip={handleSkip}
            />
          </div>
          <div className="space-y-6">
            <SyndicateSidebar
              isLoading={isLoading}
              weeklyYieldPool={weeklyYieldPool}
              allocatedBudget={allocatedBudget}
              remainingBudget={remainingBudget}
              acceptedBetsCount={acceptedBetsCount}
              skippedMatchesCount={Object.values(matchDecisions).filter(d => d.isSkip).length}
              remainingBets={remainingBets}
              userPoolShare={userPoolShare}
              userWeeklyYield={userWeeklyYield}
              userLockedAmount={userLockedAmount}
              isConnected={isConnected}
              phase="Active"
              batchRecord={{ wins: 2, losses: 1, pending: 2 }}
            />
          </div>
        </div>
        <HowItWorks />
        <FAQ />
      </main>
    </div>
  );
}