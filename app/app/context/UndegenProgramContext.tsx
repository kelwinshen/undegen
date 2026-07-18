"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  PropsWithChildren,
} from "react";
import { useWalletConnection } from "@solana/react-hooks";
import {
  joinBatchOnChain,
  leaveBatchOnChain,
  claimOnChain,
  claimAndJoinLotteryOnChain,
  buyTicketOnChain,
  claimPrizeOnChain,
  castVoteOnChain,
  settleDefaultOnChain,
  resolveVoteIndex,
  fetchAllBatchesOnChain,
  fetchLatestBatchId,
  fetchLiveMatchForBatch,
  fetchUsdcBalance,
  subscribeToUsdcAccount,
  subscribeToBatchAccount,
  BatchState,
  VoteResult,
  Option,
  Fixture,
} from "../services/undegenProgram";

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
  // Lobby-only — redeems a Lobby-phase deposit back to the wallet (real
  // `leave_batch`). Reverts once the batch has locked; a Settled batch's
  // payout comes from `claim` instead.
  withdraw: (amount?: number, batchId?: number) => Promise<void>;
  // Settled-only — pays out a batch's full final position (principal +
  // this user's share of accumulated winnings) in one shot (real `claim`).
  claim: (batchId?: number) => Promise<void>;
  // Settled-only — same payout as `claim`, except the winnings leg is
  // wagered straight into the lottery's currently Open round instead of
  // landing in the wallet (real `claim_and_join_lottery`). Reverts if
  // there's no Open round.
  claimAndJoinLottery: (batchId?: number) => Promise<void>;
  // Permissionless — buys a lottery ticket for `amount` USDC in the
  // currently Open round (real `buy_ticket`). No relationship to any
  // undegen_core batch; anyone with a connected wallet can call this.
  buyLotteryTicket: (amount: number) => Promise<void>;
  // Claims a Drawn round's jackpot for this wallet (real `claim_prize`).
  // Reverts unless this wallet's ticket range covers the round's
  // winning_number and it hasn't already been claimed.
  claimLotteryPrize: (roundId: bigint) => Promise<void>;
  vote: (fixtureId: number, optionId: string) => Promise<void>;
  // For proposals recovered straight from bet_terms (describeBatchBetTerms) —
  // the slot index (0-3) is already known, so there's no optionId to resolve.
  voteBySlotIndex: (index: number) => Promise<void>;
  // Settles the current bet as a default user-win — real `settle_default`,
  // callable by anyone once the operator has gone silent past the proof
  // deadline; no on-chain signer requirement, just needs a connected wallet
  // to pay the tx fee.
  settleDefault: (batchId?: number) => Promise<void>;
  refreshState: () => Promise<void>;
}

const UndegenProgramContext = createContext<UndegenProgramContextType | null>(
  null
);

export function UndegenProgramProvider({ children }: PropsWithChildren) {
  const { status, wallet } = useWalletConnection();
  const isConnected = status === "connected";
  const walletAddress = wallet?.account.address?.toString() ?? null;

  const [batches, setBatches] = useState<BatchState[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [matchDecisions, setMatchDecisions] = useState<
    Record<number, VoteResult>
  >({});
  const [selectedBatchId, setSelectedBatchId] = useState(-1);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const didAutoSelectLiveBatch = useRef(false);

  // Load every real batch on-chain (0..next_batch_id-1). `silent` skips the
  // isLoading flip — used by the background poll below so a periodic refresh
  // just seamlessly swaps in updated numbers (vote weights, batch status,
  // odds) instead of flashing the whole page back to a loading skeleton.
  const loadState = async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
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
          const liveBatch = activeBatches.reduce((a, b) =>
            b.batchId > a.batchId ? b : a
          );
          setSelectedBatchId(liveBatch.batchId);
        } else if (realBatches.length > 0) {
          setSelectedBatchId(realBatches[0].batchId);
        }
        didAutoSelectLiveBatch.current = true;
      }
    } catch (e) {
      console.error("Error loading program state:", e);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, [walletAddress, isConnected]);

  // Background poll so batch status (AwaitingCollateral -> Active), vote
  // weights, and odds stay live without the user ever having to reload —
  // silent so it never re-triggers the loading skeleton, just swaps in
  // whatever changed. /api/txodds is cached server-side (30s TTL) so this
  // doesn't hammer TxOdds even though it re-fetches on every tick. This is a
  // fallback safety net for every OTHER batch in the list (there could be 30+
  // of them — too many to hold one WebSocket subscription each); the batch
  // the user is actually looking at also gets a real-time push below.
  useEffect(() => {
    const interval = setInterval(() => {
      loadState(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [walletAddress, isConnected]);

  // Real-time push for the selected batch: subscribes to its Batch account
  // and (if connected) this wallet's UserPosition account for it, so a
  // deposit/vote/settlement — this wallet's or anyone else's — shows up the
  // instant it lands on-chain instead of waiting for the next 15s poll tick.
  // Debounced because one transaction can touch both accounts at once,
  // firing this twice back-to-back. Re-subscribes whenever the selected
  // batch or the connected wallet changes (switching wallet accounts included).
  useEffect(() => {
    if (selectedBatchId < 0) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToBatchAccount(
      selectedBatchId,
      walletAddress,
      () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => loadState(true), 400);
      }
    );
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, [selectedBatchId, walletAddress]);

  // Real USDC balance for the connected wallet — fetched immediately, kept
  // live via a WebSocket subscription on the ATA (fires the instant a
  // deposit/withdrawal/transfer changes it), and backed by a slow poll in
  // case the socket silently drops (public devnet RPC can do that). Switching
  // wallet accounts re-runs this whole effect: the old subscription is torn
  // down and a fresh one opens for the new address.
  useEffect(() => {
    if (!walletAddress) {
      setUsdcBalance(0);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      fetchUsdcBalance(walletAddress).then((balance) => {
        if (!cancelled) setUsdcBalance(balance);
      });
    };
    refresh();
    const unsubscribe = subscribeToUsdcAccount(walletAddress, refresh);
    const interval = setInterval(refresh, 20000);
    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(interval);
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
    fetchLiveMatchForBatch(selectedBatchId, batchState, options).then(
      ({ fixture, votes, decision }) => {
        if (cancelled) return;
        setFixtures(fixture ? [fixture] : []);
        setVotes(votes);
        setMatchDecisions(decision ? { [decision.fixtureId]: decision } : {});
      }
    );
    return () => {
      cancelled = true;
    };
  }, [selectedBatchId, batches, options]);

  // Actions
  const deposit = async (amount: number, batchId?: number) => {
    const targetBatchId = batchId ?? selectedBatchId;
    if (!wallet?.account?.address)
      throw new Error("Connect your wallet first.");
    const sig = await joinBatchOnChain(targetBatchId, amount, wallet);
    console.log(
      `[join_batch] Deposited ${amount} to Batch ${targetBatchId}. Tx: ${sig}`
    );
    await refreshState();
  };

  const withdraw = async (amount?: number, batchId?: number) => {
    const targetBatchId = batchId ?? selectedBatchId;
    if (!wallet?.account?.address)
      throw new Error("Connect your wallet first.");
    const targetAmount =
      amount ??
      batches.find((b) => b.batchId === targetBatchId)?.userDeposited ??
      0;
    if (targetAmount <= 0)
      throw new Error("Nothing to unstake from this batch.");
    const sig = await leaveBatchOnChain(targetBatchId, targetAmount, wallet);
    console.log(
      `[leave_batch] Withdrew ${targetAmount} from Batch ${targetBatchId}. Tx: ${sig}`
    );
    await refreshState();
  };

  const claim = async (batchId?: number) => {
    const targetBatchId = batchId ?? selectedBatchId;
    if (!wallet?.account?.address)
      throw new Error("Connect your wallet first.");
    const targetBatch = batches.find((b) => b.batchId === targetBatchId);
    if (!targetBatch || targetBatch.userDeposited <= 0)
      throw new Error("Nothing to claim from this batch.");
    if (targetBatch.userWithdrawn)
      throw new Error("Already claimed from this batch.");
    const sig = await claimOnChain(targetBatchId, wallet);
    console.log(`[claim] Claimed Batch ${targetBatchId}. Tx: ${sig}`);
    await refreshState();
  };

  const claimAndJoinLottery = async (batchId?: number) => {
    const targetBatchId = batchId ?? selectedBatchId;
    if (!wallet?.account?.address)
      throw new Error("Connect your wallet first.");
    const targetBatch = batches.find((b) => b.batchId === targetBatchId);
    if (!targetBatch || targetBatch.userDeposited <= 0)
      throw new Error("Nothing to claim from this batch.");
    if (targetBatch.userWithdrawn)
      throw new Error("Already claimed from this batch.");
    const sig = await claimAndJoinLotteryOnChain(targetBatchId, wallet);
    console.log(
      `[claim_and_join_lottery] Claimed Batch ${targetBatchId} into the lottery. Tx: ${sig}`
    );
    await refreshState();
  };

  const buyLotteryTicket = async (amount: number) => {
    if (!wallet?.account?.address)
      throw new Error("Connect your wallet first.");
    if (amount <= 0) throw new Error("Enter an amount to wager.");
    const sig = await buyTicketOnChain(amount, wallet);
    console.log(`[buy_ticket] Bought a ${amount} USDC ticket. Tx: ${sig}`);
    await refreshState();
  };

  const claimLotteryPrize = async (roundId: bigint) => {
    if (!wallet?.account?.address)
      throw new Error("Connect your wallet first.");
    const sig = await claimPrizeOnChain(roundId, wallet);
    console.log(`[claim_prize] Claimed Round ${roundId}. Tx: ${sig}`);
    await refreshState();
  };

  const vote = async (fixtureId: number, optionId: string) => {
    if (!wallet?.account?.address)
      throw new Error("Connect your wallet first.");
    const batchState = batches.find((b) => b.batchId === selectedBatchId);
    const index = await resolveVoteIndex(
      selectedBatchId,
      fixtureId,
      optionId,
      batchState,
      options
    );
    const sig = await castVoteOnChain(selectedBatchId, index, wallet);
    console.log(
      `[cast_vote] Voted index ${index} on fixture ${fixtureId}. Tx: ${sig}`
    );
    await refreshState();
  };

  const voteBySlotIndex = async (index: number) => {
    if (!wallet?.account?.address)
      throw new Error("Connect your wallet first.");
    const sig = await castVoteOnChain(selectedBatchId, index, wallet);
    console.log(
      `[cast_vote] Voted index ${index} directly on Batch ${selectedBatchId}. Tx: ${sig}`
    );
    await refreshState();
  };

  const settleDefault = async (batchId?: number) => {
    const targetBatchId = batchId ?? selectedBatchId;
    if (!wallet?.account?.address)
      throw new Error("Connect your wallet first.");
    const sig = await settleDefaultOnChain(targetBatchId, wallet);
    console.log(
      `[settle_default] Settled Batch ${targetBatchId} as default win. Tx: ${sig}`
    );
    await refreshState();
  };

  // Silent — after the user's own action (vote/deposit/withdraw) the on-chain
  // write already succeeded, so this is just picking up its result. There's
  // nothing to show a loading skeleton for; the UI should just update.
  const refreshState = async () => {
    await loadState(true);
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
      claim,
      claimAndJoinLottery,
      buyLotteryTicket,
      claimLotteryPrize,
      vote,
      voteBySlotIndex,
      settleDefault,
      refreshState,
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
      usdcBalance,
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
    throw new Error(
      "useUndegenProgram must be used within an UndegenProgramProvider"
    );
  }
  return context;
}
