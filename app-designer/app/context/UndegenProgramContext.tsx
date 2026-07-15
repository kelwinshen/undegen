"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, PropsWithChildren } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { SOLANA_CONFIG } from "../lib/solanaConfig";
import {
  fetchBatchState,
  fetchVotes,
  fetchMatchDecisions,
  depositToLobby,
  withdrawFromLobby,
  buyLotteryTicket,
  submitVote,
  joinBatchOnChain,
  castVoteOnChain,
  resolveVoteIndex,
  BatchState,
  VoteResult,
} from "../services/undegenProgram";
import { Option, Fixture } from "../lib/dummyData";

// Stable base time for mock match time offsets
const baseTime = Date.now();

interface UndegenProgramContextType {
  // Config
  isMockMode: boolean;

  // Blockchain States
  batches: BatchState[];
  options: Option[];
  fixtures: Fixture[];
  votes: Record<string, number>;
  matchDecisions: Record<number, VoteResult>;
  isLoading: boolean;
  
  // Navigation & Selection
  selectedBatchId: number;
  setSelectedBatchId: (id: number) => void;
  
  // Wallet Connection helper
  isConnected: boolean;
  walletAddress: string | null;
  walletStatus: string;

  // Actions / Instructions
  deposit: (amount: number, batchId?: number) => Promise<void>;
  withdraw: (batchId?: number) => Promise<void>;
  vote: (fixtureId: number, optionId: string) => Promise<void>;
  buyLottery: (batchId?: number) => Promise<void>;
  refreshState: () => Promise<void>;

  // Simulation Controls & States
  isSimulating: boolean;
  setIsSimulating: (val: boolean) => void;
  simulatedScore1: number;
  setSimulatedScore1: React.Dispatch<React.SetStateAction<number>>;
  simulatedScore2: number;
  setSimulatedScore2: React.Dispatch<React.SetStateAction<number>>;
  liveMatchFinished: boolean;
  setLiveMatchFinished: React.Dispatch<React.SetStateAction<boolean>>;
  simData: any;
}

const UndegenProgramContext = createContext<UndegenProgramContextType | null>(null);

export function UndegenProgramProvider({ children }: PropsWithChildren) {
  const { status, wallet } = useWalletConnection();
  const isConnected = status === "connected";
  const walletAddress = wallet?.account.address?.toString() ?? null;

  const [batches, setBatches] = useState<BatchState[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [matchDecisions, setMatchDecisions] = useState<Record<number, VoteResult>>({});
  const [selectedBatchId, setSelectedBatchId] = useState(5);

  // Simulation Mode States
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedScore1, setSimulatedScore1] = useState(2);
  const [simulatedScore2, setSimulatedScore2] = useState(1);
  const [liveMatchFinished, setLiveMatchFinished] = useState(false);

  // Simulated active match day data (matches the logic from original Home component)
  const simData = useMemo(() => {
    const mockFixtures: Fixture[] = [
      {
        fixtureId: 9001,
        participant1: "Argentina",
        participant2: "France",
        startTime: baseTime - 2 * 3600000,
        options: [
          {
            id: "opt-9001-1",
            fixtureId: 9001,
            participant1: "Argentina",
            participant2: "France",
            odds: 2.1,
            startTime: baseTime - 2 * 3600000,
            label: "Argentina to win",
          },
          {
            id: "opt-9001-2",
            fixtureId: 9001,
            participant1: "Argentina",
            participant2: "France",
            odds: 3.2,
            startTime: baseTime - 2 * 3600000,
            label: "France to win",
          },
        ],
      },
      {
        fixtureId: 9002,
        participant1: "Brazil",
        participant2: "Croatia",
        startTime: baseTime - 1.5 * 3600000,
        options: [
          {
            id: "opt-9002-1",
            fixtureId: 9002,
            participant1: "Brazil",
            participant2: "Croatia",
            odds: 1.9,
            startTime: baseTime - 1.5 * 3600000,
            label: "Croatia to win",
          },
          {
            id: "opt-9002-2",
            fixtureId: 9002,
            participant1: "Brazil",
            participant2: "Croatia",
            odds: 3.5,
            startTime: baseTime - 1.5 * 3600000,
            label: "Brazil to win",
          },
        ],
      },
      {
        fixtureId: 9003,
        participant1: "England",
        participant2: "Portugal",
        startTime: baseTime - 75 * 60000,
        options: [
          {
            id: "opt-9003-1",
            fixtureId: 9003,
            participant1: "England",
            participant2: "Portugal",
            odds: 1.8,
            startTime: baseTime - 75 * 60000,
            label: "Over 2.5 goals",
          },
          {
            id: "opt-9003-2",
            fixtureId: 9003,
            participant1: "England",
            participant2: "Portugal",
            odds: 2.1,
            startTime: baseTime - 75 * 60000,
            label: "Under 2.5 goals",
          },
        ],
      },
      {
        fixtureId: 9004,
        participant1: "Spain",
        participant2: "Germany",
        startTime: baseTime - 2 * 60000,
        options: [
          {
            id: "opt-9004-1",
            fixtureId: 9004,
            participant1: "Spain",
            participant2: "Germany",
            odds: 1.6,
            startTime: baseTime - 2 * 60000,
            label: "Spain to win",
          },
          {
            id: "opt-9004-2",
            fixtureId: 9004,
            participant1: "Spain",
            participant2: "Germany",
            odds: 4.5,
            startTime: baseTime - 2 * 60000,
            label: "Germany to win",
          },
        ],
      },
      {
        fixtureId: 9005,
        participant1: "Belgium",
        participant2: "Netherlands",
        startTime: baseTime + 4 * 3600000,
        options: [
          {
            id: "opt-9005-1",
            fixtureId: 9005,
            participant1: "Belgium",
            participant2: "Netherlands",
            odds: 1.5,
            startTime: baseTime + 4 * 3600000,
            label: "Belgium to win",
          },
          {
            id: "opt-9005-2",
            fixtureId: 9005,
            participant1: "Belgium",
            participant2: "Netherlands",
            odds: 5.2,
            startTime: baseTime + 4 * 3600000,
            label: "Netherlands to win",
          },
        ],
      },
    ];

    const mockVotes: Record<string, number> = {
      "opt-9001-1": 350,
      "opt-9001-2": 120,
      "9001-skip": 45,
      "opt-9002-1": 290,
      "opt-9002-2": 150,
      "9002-skip": 30,
      "opt-9003-1": 410,
      "opt-9003-2": 190,
      "9003-skip": 55,
      "opt-9004-1": 480,
      "opt-9004-2": 90,
      "9004-skip": 20,
      "opt-9005-1": 150,
      "opt-9005-2": 60,
      "9005-skip": 15,
    };

    const mockDecisions: Record<number, VoteResult> = {
      9001: {
        fixtureId: 9001,
        winningOptionId: "opt-9001-1",
        isSkip: false,
        accepted: true,
        won: true,
      },
      9002: {
        fixtureId: 9002,
        winningOptionId: "opt-9002-1",
        isSkip: false,
        accepted: true,
        won: false,
      },
      9003: {
        fixtureId: 9003,
        winningOptionId: "opt-9003-1",
        isSkip: false,
        accepted: true,
        won: liveMatchFinished,
      },
      9004: {
        fixtureId: 9004,
        winningOptionId: "opt-9004-1",
        isSkip: false,
        accepted: true,
        won: false,
      },
    };

    const mockScores: Record<number, any> = {
      9001: {
        fixtureId: 9001,
        status: "Finished",
        participant1: "Argentina",
        participant2: "France",
        p1Goals: 3,
        p2Goals: 1,
      },
      9002: {
        fixtureId: 9002,
        status: "Finished",
        participant1: "Brazil",
        participant2: "Croatia",
        p1Goals: 1,
        p2Goals: 0,
      },
      9003: {
        fixtureId: 9003,
        status: liveMatchFinished ? "Finished" : "In Play",
        participant1: "England",
        participant2: "Portugal",
        p1Goals: simulatedScore1,
        p2Goals: simulatedScore2,
      },
      9004: {
        fixtureId: 9004,
        status: "Not Started",
        participant1: "Spain",
        participant2: "Germany",
        p1Goals: 0,
        p2Goals: 0,
      },
    };

    const mockBatchState: BatchState = {
      batchId: 5,
      phase: "Active",
      totalDeposited: 1250000,
      weeklyYieldPool: (1250000 * 0.05) / 52,
      acceptedPredictions: 4,
      maxPredictions: 5,
      operatorAddress: "OP...",
      userDeposited: 1000,
      batchStartTime: baseTime - 24 * 3600000,
      participantCount: 1287,
      minimumDeposit: 100,
    };

    return {
      mockFixtures,
      mockVotes,
      mockDecisions,
      mockScores,
      mockBatchState,
    };
  }, [simulatedScore1, simulatedScore2, liveMatchFinished]);

  // Load configuration & initial batches
  const loadState = async () => {
    try {
      setIsLoading(true);
      const batchIds = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const [optionsRes, ...batchesRes] = await Promise.all([
        fetch("/api/txodds").then((r) => r.json()),
        ...batchIds.map((id) => fetchBatchState(id, walletAddress)),
      ]);
      setOptions(optionsRes.options || []);
      setBatches(batchesRes);
    } catch (e) {
      console.error("Error loading program state:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, [walletAddress, isConnected]);

  // Map options to fixtures
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

  // Fetch votes and match decisions on fixtures change
  useEffect(() => {
    if (fixtures.length === 0) return;
    const loadVotesAndDecisions = async () => {
      const [votesRes, decisionsRes] = await Promise.all([
        fetchVotes(fixtures),
        fetchMatchDecisions(fixtures),
      ]);
      setVotes(votesRes);
      setMatchDecisions(decisionsRes);
    };
    loadVotesAndDecisions();
  }, [fixtures]);

  // Actions
  const deposit = async (amount: number, batchId?: number) => {
    const targetBatchId = batchId ?? selectedBatchId;
    if (SOLANA_CONFIG.MOCK_MODE) {
      await depositToLobby(targetBatchId, amount);
      // Optimistic update for local mock state
      setBatches(prev => prev.map(b => b.batchId === targetBatchId ? {
        ...b,
        userDeposited: b.userDeposited + amount,
        totalDeposited: b.totalDeposited + amount,
        participantCount: b.userDeposited === 0 ? b.participantCount + 1 : b.participantCount
      } : b));
    } else {
      if (!wallet?.account?.address) throw new Error("Connect your wallet first.");
      const sig = await joinBatchOnChain(targetBatchId, amount, wallet);
      console.log(`[join_batch] Deposited ${amount} to Batch ${targetBatchId}. Tx: ${sig}`);
      await refreshState();
    }
  };

  const withdraw = async (batchId?: number) => {
    const targetBatchId = batchId ?? selectedBatchId;
    if (SOLANA_CONFIG.MOCK_MODE) {
      await withdrawFromLobby(targetBatchId);
      // Optimistic update
      setBatches(prev => prev.map(b => b.batchId === targetBatchId ? {
        ...b,
        userDeposited: 0,
        userWithdrawn: true
      } : b));
    } else {
      // TODO: Connect smart contract withdraw instruction here
      console.log(`[REAL CONTRACT] Withdrawing from Batch ${targetBatchId}`);
    }
  };

  const vote = async (fixtureId: number, optionId: string) => {
    if (SOLANA_CONFIG.MOCK_MODE) {
      await submitVote(fixtureId, optionId);
    } else {
      if (!wallet?.account?.address) throw new Error("Connect your wallet first.");
      const index = await resolveVoteIndex(selectedBatchId, fixtureId, optionId);
      const sig = await castVoteOnChain(selectedBatchId, index, wallet);
      console.log(`[cast_vote] Voted index ${index} on fixture ${fixtureId}. Tx: ${sig}`);
      await refreshState();
    }
  };

  const buyLottery = async (batchId?: number) => {
    const targetBatchId = batchId ?? selectedBatchId;
    if (SOLANA_CONFIG.MOCK_MODE) {
      await buyLotteryTicket();
      await withdrawFromLobby(targetBatchId);
      // Optimistic update
      setBatches(prev => prev.map(b => b.batchId === targetBatchId ? {
        ...b,
        userDeposited: 0,
        userWithdrawn: true
      } : b));
    } else {
      // TODO: Connect smart contract lottery ticket instruction here
      console.log(`[REAL CONTRACT] Buying lottery ticket for Batch ${targetBatchId}`);
    }
  };

  const refreshState = async () => {
    await loadState();
  };

  const value = useMemo(
    () => ({
      isMockMode: SOLANA_CONFIG.MOCK_MODE,
      batches,
      options,
      fixtures,
      votes,
      matchDecisions,
      isLoading,
      selectedBatchId,
      setSelectedBatchId,
      isConnected,
      walletAddress,
      walletStatus: status,
      deposit,
      withdraw,
      vote,
      buyLottery,
      refreshState,
      isSimulating,
      setIsSimulating,
      simulatedScore1,
      setSimulatedScore1,
      simulatedScore2,
      setSimulatedScore2,
      liveMatchFinished,
      setLiveMatchFinished,
      simData,
    }),
    [
      batches,
      options,
      fixtures,
      votes,
      matchDecisions,
      isLoading,
      selectedBatchId,
      isConnected,
      walletAddress,
      status,
      isSimulating,
      simulatedScore1,
      simulatedScore2,
      liveMatchFinished,
      simData,
    ]
  );

  return (
    <UndegenProgramContext.Provider value={value}>
      {children}
    </UndegenProgramContext.Provider>
  );
}

export function useUndegenProgram() {
  const context = useContext(UndegenProgramContext);
  if (!context) {
    throw new Error("useUndegenProgram must be used within an UndegenProgramProvider");
  }
  return context;
}
