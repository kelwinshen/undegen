"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useRef, PropsWithChildren } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import {
  joinBatchOnChain,
  leaveBatchOnChain,
  castVoteOnChain,
  resolveVoteIndex,
  fetchAllBatchesOnChain,
  fetchLatestBatchId,
  fetchLiveMatchForBatch,
  fetchUsdcBalance,
  BatchState,
  VoteResult,
} from "../services/undegenProgram";
import { Option, Fixture } from "../lib/dummyData";

interface UndegenProgramContextType {
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
  usdcBalance: number;

  // Actions / Instructions — all real, on-chain, user-signed.
  deposit: (amount: number, batchId?: number) => Promise<void>;
  withdraw: (amount?: number, batchId?: number) => Promise<void>;
  vote: (fixtureId: number, optionId: string) => Promise<void>;
  // For proposals recovered straight from bet_terms (describeBatchBetTerms) —
  // the slot index (0-3) is already known, so there's no optionId to resolve.
  voteBySlotIndex: (index: number) => Promise<void>;
  refreshState: () => Promise<void>;
}

const UndegenProgramContext = createContext<UndegenProgramContextType | null>(null);

export function UndegenProgramProvider({ children }: PropsWithChildren) {
  const { status, wallet } = useWalletConnection();
  const isConnected = status === "connected";
  const walletAddress = wallet?.account.address?.toString() ?? null;

  const [batches, setBatches] = useState<BatchState[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [matchDecisions, setMatchDecisions] = useState<Record<number, VoteResult>>({});
  const [selectedBatchId, setSelectedBatchId] = useState(-1);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const didAutoSelectLiveBatch = useRef(false);

  // Load every real batch on-chain (0..next_batch_id-1).
  const loadState = async () => {
    try {
      setIsLoading(true);
      const optionsRes = await fetch("/api/txodds").then((r) => r.json());
      setOptions(optionsRes.options || []);

      const latestBatchId = await fetchLatestBatchId();
      const batchIds = Array.from({ length: latestBatchId + 1 }, (_, i) => i);
      const realBatches = await fetchAllBatchesOnChain(batchIds, walletAddress);
      setBatches(realBatches);

      // Auto-select "the live batch" (highest-ID batch currently Active) once,
      // on first load — don't clobber a batch the user has since picked.
      if (!didAutoSelectLiveBatch.current) {
        const activeBatches = realBatches.filter((b) => b.phase === "Active");
        if (activeBatches.length > 0) {
          const liveBatch = activeBatches.reduce((a, b) => (b.batchId > a.batchId ? b : a));
          setSelectedBatchId(liveBatch.batchId);
        } else if (realBatches.length > 0) {
          setSelectedBatchId(realBatches[0].batchId);
        }
        didAutoSelectLiveBatch.current = true;
      }
    } catch (e) {
      console.error("Error loading program state:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, [walletAddress, isConnected]);

  // Real USDC balance for the connected wallet.
  useEffect(() => {
    if (!walletAddress) {
      setUsdcBalance(0);
      return;
    }
    let cancelled = false;
    fetchUsdcBalance(walletAddress).then((balance) => {
      if (!cancelled) setUsdcBalance(balance);
    });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // Resolve the selected batch's actual proposed match (propose_match + Redis
  // mapping) into a Fixture with real vote_weights and the real decision, if any.
  useEffect(() => {
    const batchState = batches.find((b) => b.batchId === selectedBatchId);
    if (!batchState || options.length === 0) {
      setFixtures([]);
      setVotes({});
      setMatchDecisions({});
      return;
    }
    let cancelled = false;
    fetchLiveMatchForBatch(selectedBatchId, batchState, options).then(({ fixture, votes, decision }) => {
      if (cancelled) return;
      setFixtures(fixture ? [fixture] : []);
      setVotes(votes);
      setMatchDecisions(decision ? { [decision.fixtureId]: decision } : {});
    });
    return () => {
      cancelled = true;
    };
  }, [selectedBatchId, batches, options]);

  // Actions
  const deposit = async (amount: number, batchId?: number) => {
    const targetBatchId = batchId ?? selectedBatchId;
    if (!wallet?.account?.address) throw new Error("Connect your wallet first.");
    const sig = await joinBatchOnChain(targetBatchId, amount, wallet);
    console.log(`[join_batch] Deposited ${amount} to Batch ${targetBatchId}. Tx: ${sig}`);
    await refreshState();
  };

  const withdraw = async (amount?: number, batchId?: number) => {
    const targetBatchId = batchId ?? selectedBatchId;
    if (!wallet?.account?.address) throw new Error("Connect your wallet first.");
    const targetAmount = amount ?? batches.find((b) => b.batchId === targetBatchId)?.userDeposited ?? 0;
    if (targetAmount <= 0) throw new Error("Nothing to unstake from this batch.");
    const sig = await leaveBatchOnChain(targetBatchId, targetAmount, wallet);
    console.log(`[leave_batch] Withdrew ${targetAmount} from Batch ${targetBatchId}. Tx: ${sig}`);
    await refreshState();
  };

  const vote = async (fixtureId: number, optionId: string) => {
    if (!wallet?.account?.address) throw new Error("Connect your wallet first.");
    const batchState = batches.find((b) => b.batchId === selectedBatchId);
    const index = await resolveVoteIndex(selectedBatchId, fixtureId, optionId, batchState, options);
    const sig = await castVoteOnChain(selectedBatchId, index, wallet);
    console.log(`[cast_vote] Voted index ${index} on fixture ${fixtureId}. Tx: ${sig}`);
    await refreshState();
  };

  const voteBySlotIndex = async (index: number) => {
    if (!wallet?.account?.address) throw new Error("Connect your wallet first.");
    const sig = await castVoteOnChain(selectedBatchId, index, wallet);
    console.log(`[cast_vote] Voted index ${index} directly on Batch ${selectedBatchId}. Tx: ${sig}`);
    await refreshState();
  };

  const refreshState = async () => {
    await loadState();
    if (walletAddress) setUsdcBalance(await fetchUsdcBalance(walletAddress));
  };

  const value = useMemo(
    () => ({
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
      usdcBalance,
      deposit,
      withdraw,
      vote,
      voteBySlotIndex,
      refreshState,
    }),
    [batches, options, fixtures, votes, matchDecisions, isLoading, selectedBatchId, isConnected, walletAddress, status, usdcBalance]
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
