"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import HowItWorks from "../components/HowItWorks";
import FAQ from "../components/FAQ";
import { useUndegenProgram } from "../context/UndegenProgramContext";
import {
  fetchLotteryConfig,
  fetchAllLotteryRoundsOnChain,
  LotteryRoundState,
  LotteryRoundStatus,
  LOTTERY_ROUND_DURATION_SECONDS,
} from "../services/undegenProgram";
import { SOLANA_CONFIG } from "../lib/solanaConfig";

const AMOUNT_DECIMALS = SOLANA_CONFIG.TOKEN_DECIMALS;

function trimTrailingZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function calcPercentageAmount(balance: number, pct: number): string {
  if (pct >= 100) return trimTrailingZeros(balance.toFixed(AMOUNT_DECIMALS));
  const scale = 10 ** AMOUNT_DECIMALS;
  const raw = (balance * pct) / 100;
  const floored = Math.floor(raw * scale) / scale;
  return trimTrailingZeros(floored.toFixed(AMOUNT_DECIMALS));
}

// "RandomnessRequested" is real but not user-facing language.
function statusLabel(status: LotteryRoundStatus): string {
  return status === "RandomnessRequested" ? "Drawing" : status;
}

function statusPillClasses(status: LotteryRoundStatus): string {
  if (status === "Settled") {
    return "bg-neutral-100 text-neutral-800 border border-neutral-200 dark:bg-neutral-500/10 dark:text-neutral-400 dark:border-neutral-500/20";
  }
  // Open, RandomnessRequested, Drawn — still "in flight" / needs attention.
  return "bg-amber-100 text-amber-800 border border-amber-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20";
}

// Right-side pill for a row in the Rounds list. Not shown at all for the
// currently-focused row — its status is already the left-side pill next to
// "Week #N", so repeating it here (as this used to do with a "Selected"
// label, then a duplicate status label) was always redundant.
function roundRowBadge(round: LotteryRoundState): {
  label: string;
  highlight: boolean;
} {
  if (round.status === "Open")
    return { label: "Buy Ticket ➜", highlight: false };
  if (round.status === "RandomnessRequested")
    return { label: "Drawing…", highlight: false };
  if (round.myEntry?.isWinner) {
    return round.myEntry.claimed
      ? { label: "Claimed", highlight: false }
      : { label: "Claimable", highlight: true };
  }
  return { label: "View ➜", highlight: false };
}

export default function LotteryPage() {
  const {
    isConnected,
    walletAddress,
    usdcBalance,
    buyLotteryTicket,
    claimLotteryPrize,
  } = useUndegenProgram();

  const [isLoading, setIsLoading] = useState(true);
  const [rounds, setRounds] = useState<LotteryRoundState[]>([]);
  // null = viewing the currently open round (buy-ticket mode). Set to a
  // round's id to view that round's result instead.
  const [selectedRoundId, setSelectedRoundId] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("");
  const [isBuying, setIsBuying] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadRounds = useCallback(async () => {
    const config = await fetchLotteryConfig();
    if (!config || config.currentRoundId <= BigInt(0)) {
      setRounds([]);
      return;
    }
    const roundIds = Array.from(
      { length: Number(config.currentRoundId) },
      (_, i) => BigInt(i + 1)
    );
    const allRounds = await fetchAllLotteryRoundsOnChain(
      roundIds,
      walletAddress
    );
    setRounds(allRounds);
  }, [walletAddress]);

  useEffect(() => {
    setIsLoading(true);
    loadRounds().finally(() => setIsLoading(false));
  }, [loadRounds]);

  // Background poll, same cadence as the batch state poll — the pool grows
  // as other people buy tickets, not just when this wallet acts.
  useEffect(() => {
    const interval = setInterval(() => loadRounds(), 15000);
    return () => clearInterval(interval);
  }, [loadRounds]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const openRound = useMemo(
    () => rounds.find((r) => r.status === "Open") ?? null,
    [rounds]
  );
  const isBuyMode = selectedRoundId === null;
  const displayRound = isBuyMode
    ? openRound
    : (rounds.find((r) => r.roundId === selectedRoundId) ?? null);

  // When request_randomness (and therefore reveal_winner) first becomes
  // callable for the open round — program-enforced via ROUND_DURATION_SECONDS
  // from start_time (request_randomness.rs). Ticket sales stay open until an
  // admin actually calls it; this is just the earliest that can happen.
  const drawDeadline = openRound
    ? openRound.startTime + LOTTERY_ROUND_DURATION_SECONDS * 1000
    : null;
  const [drawCountdown, setDrawCountdown] = useState("");

  useEffect(() => {
    if (drawDeadline === null) {
      setDrawCountdown("");
      return;
    }
    const update = () => {
      const diff = drawDeadline - Date.now();
      if (diff <= 0) {
        setDrawCountdown("Ready");
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setDrawCountdown(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [drawDeadline]);

  // Rounds this wallet has actually bought a ticket in, vs every other round
  // — split rather than mixed together so your own history isn't buried in
  // every round that's ever run. Newest first within each half.
  const { myRounds, otherRounds } = useMemo(() => {
    const sorted = [...rounds].sort((a, b) =>
      b.roundId > a.roundId ? 1 : b.roundId < a.roundId ? -1 : 0
    );
    return {
      myRounds: sorted.filter((r) => r.myEntry !== null),
      otherRounds: sorted.filter((r) => r.myEntry === null),
    };
  }, [rounds]);

  const handlePercentageClick = (pct: number) => {
    setAmount(calcPercentageAmount(usdcBalance, pct));
  };

  const parsedAmount = parseFloat(amount);
  const canBuy =
    isBuyMode &&
    openRound?.status === "Open" &&
    isConnected &&
    !isBuying &&
    !isNaN(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= usdcBalance;

  const handleBuy = async () => {
    if (!canBuy) return;
    setIsBuying(true);
    try {
      await buyLotteryTicket(parsedAmount);
      setToastMessage(`Bought a ${parsedAmount.toLocaleString()} USDC ticket!`);
      setAmount("");
      await loadRounds();
    } catch (e: any) {
      setToastMessage(e?.message || "Ticket purchase failed.");
    } finally {
      setIsBuying(false);
    }
  };

  const handleClaimPrize = async (roundId: bigint) => {
    setIsClaiming(true);
    try {
      await claimLotteryPrize(roundId);
      setToastMessage(`Claimed the Week #${roundId} jackpot!`);
      await loadRounds();
    } catch (e: any) {
      setToastMessage(e?.message || "Claim failed.");
    } finally {
      setIsClaiming(false);
    }
  };

  const myEntry = isBuyMode ? (openRound?.myEntry ?? null) : null;
  const winChancePct =
    openRound && openRound.totalPool > 0 && myEntry
      ? (myEntry.amount / openRound.totalPool) * 100
      : 0;

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

      <main className="relative z-10 mx-auto flex max-w-6xl min-h-screen flex-col gap-8 border-border-low px-6 pt-28 pb-28 md:pb-12">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Weekly Lottery
          </h2>
          <p className="text-sm text-muted mt-1">
            One shared jackpot, open to anyone — buy a ticket with any amount of
            USDC and your odds scale with your share of the pool. No syndicate
            stake required.
          </p>
        </div>

        {isLoading ? (
          <div className="animate-pulse text-muted py-12 text-center">
            Loading lottery rounds...
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {isBuyMode ? (
                !displayRound ? (
                  <div className="p-8 rounded-2xl border border-dashed border-border-low text-center space-y-2">
                    <div className="text-muted text-lg font-semibold">
                      No open round right now
                    </div>
                    <p className="text-muted text-sm max-w-sm mx-auto">
                      Check back once the next round starts — or claim into a
                      future round straight from a settled batch on{" "}
                      <a
                        href="/history"
                        className="underline hover:text-foreground"
                      >
                        History
                      </a>
                      .
                    </p>
                  </div>
                ) : (
                  <>
                    {drawCountdown && (
                      <div className="border border-border-low rounded-2xl backdrop-blur-sm p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-left font-sans">
                        <div className="space-y-1">
                          <h2 className="text-xl font-bold text-foreground">
                            Let&apos;s Join Week #
                            {displayRound.roundId.toString()}
                          </h2>
                          <p className="text-sm text-muted">
                            {drawCountdown === "Ready"
                              ? "This round has been open long enough — the draw can start any time now."
                              : "Ticket sales stay open until the admin starts the draw. this is just the earliest it can happen."}
                          </p>
                        </div>

                        <div className="flex flex-col items-start md:items-end text-left md:text-right bg-foreground/5 backdrop-blur-sm border border-border-low dark:bg-white/0 dark:border-white/5 rounded-xl p-3 min-w-[250px]">
                          <p className="text-xs text-muted uppercase tracking-wider font-semibold">
                            {drawCountdown === "Ready"
                              ? "Draw Status"
                              : "Draw Available In"}
                          </p>
                          <p className="text-2xl font-bold font-mono text-foreground mt-0.5">
                            {drawCountdown === "Ready"
                              ? "Ready to draw"
                              : drawCountdown}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="p-6 rounded-2xl border border-border-low backdrop-blur-sm space-y-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold flex items-center gap-2">
                          <span>Week #{displayRound.roundId.toString()}</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${statusPillClasses(displayRound.status)}`}
                          >
                            {statusLabel(displayRound.status)}
                          </span>
                        </h3>
                      </div>

                      <div className="p-4 rounded-xl bg-foreground/5 border border-border-low dark:bg-white/5 dark:border-white/5 space-y-1">
                        <p className="text-xs text-muted">Current Jackpot</p>
                        <p className="text-3xl font-black text-foreground font-mono">
                          {displayRound.totalPool.toFixed(AMOUNT_DECIMALS)} USDC
                        </p>
                      </div>

                      <div className="flex flex-col items-center justify-center py-4">
                        <div className="relative w-full flex items-center justify-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={amount}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (/^[0-9]*\.?[0-9]*$/.test(val)) setAmount(val);
                            }}
                            disabled={!isConnected}
                            className="text-6xl font-bold text-center bg-transparent focus:outline-none w-full max-w-[280px] text-foreground placeholder-neutral-700 dark:placeholder-neutral-800"
                          />
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted mt-3">
                          <span>
                            Balance: {usdcBalance.toFixed(AMOUNT_DECIMALS)} USDC
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        {[25, 50, 75, 100].map((pct) => (
                          <button
                            key={pct}
                            onClick={() => handlePercentageClick(pct)}
                            disabled={!isConnected}
                            className="rounded-xl py-2.5 text-xs font-semibold bg-neutral-900/20 dark:bg-neutral-800/40 border border-border-low text-muted hover:text-foreground hover:bg-neutral-900/40 dark:hover:bg-neutral-800/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {pct === 100 ? "MAX" : `${pct}%`}
                          </button>
                        ))}
                      </div>

                      {!isConnected ? (
                        <div className="p-4 text-center border border-dashed border-border-low rounded-xl">
                          <p className="text-xs text-muted font-light">
                            Connect your wallet to buy a ticket.
                          </p>
                        </div>
                      ) : (
                        <button
                          onClick={handleBuy}
                          disabled={!canBuy}
                          className={`w-full py-3.5 font-bold rounded-full transition text-sm cursor-pointer ${
                            !canBuy
                              ? "bg-neutral-800/40 text-neutral-500 border border-border-low cursor-not-allowed"
                              : "bg-foreground text-background hover:bg-foreground/90"
                          }`}
                        >
                          {isBuying
                            ? "Buying..."
                            : !amount
                              ? "Enter Amount"
                              : parsedAmount > usdcBalance
                                ? "Exceeds Wallet Balance"
                                : "Buy Ticket"}
                        </button>
                      )}
                    </div>
                  </>
                )
              ) : !displayRound ? (
                <div className="p-8 rounded-2xl border border-dashed border-border-low text-center space-y-2">
                  <div className="text-muted text-lg font-semibold">
                    Round not found
                  </div>
                </div>
              ) : (
                <div className="p-6 rounded-2xl border border-border-low backdrop-blur-sm space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <span>Week #{displayRound.roundId.toString()}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${statusPillClasses(displayRound.status)}`}
                      >
                        {statusLabel(displayRound.status)}
                      </span>
                    </h3>
                  </div>

                  <div className="p-4 rounded-xl bg-foreground/5 border border-border-low dark:bg-white/5 dark:border-white/5 space-y-1">
                    <p className="text-xs text-muted">Final Jackpot</p>
                    <p className="text-3xl font-black text-foreground font-mono">
                      {displayRound.totalPool.toFixed(AMOUNT_DECIMALS)} USDC
                    </p>
                  </div>

                  {!isConnected ? (
                    <div className="p-4 text-center border border-dashed border-border-low rounded-xl">
                      <p className="text-xs text-muted font-light">
                        Connect your wallet to see your result for this round.
                      </p>
                    </div>
                  ) : !displayRound.myEntry ? (
                    <div className="p-4 text-center border border-dashed border-border-low rounded-xl">
                      <p className="text-xs text-muted font-light">
                        You didn&apos;t play in Week #
                        {displayRound.roundId.toString()}.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted">Your Tickets</span>
                        <span className="font-mono text-foreground">
                          {displayRound.myEntry.amount.toFixed(AMOUNT_DECIMALS)}{" "}
                          USDC
                        </span>
                      </div>

                      {displayRound.status === "RandomnessRequested" ? (
                        <div className="p-4 rounded-xl border border-dashed border-border-low text-center">
                          <p className="text-xs text-muted">
                            Draw in progress — check back once it&apos;s
                            revealed.
                          </p>
                        </div>
                      ) : displayRound.myEntry.isWinner ? (
                        displayRound.myEntry.claimed ? (
                          <div className="p-4 rounded-xl bg-foreground/5 border border-border-low text-center space-y-1">
                            <p className="text-sm font-bold text-foreground">
                              You won and claimed this jackpot
                            </p>
                            <p className="text-xs text-muted">
                              {displayRound.totalPool.toFixed(AMOUNT_DECIMALS)}{" "}
                              USDC
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="p-4 rounded-xl border border-foreground/20 bg-foreground/5 text-center">
                              <p className="text-sm font-bold text-foreground">
                                You won this round&apos;s jackpot!
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                handleClaimPrize(displayRound.roundId)
                              }
                              disabled={isClaiming}
                              className="w-full py-3.5 font-bold rounded-full transition text-sm cursor-pointer bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isClaiming ? "Claiming..." : "Claim Prize"}
                            </button>
                          </div>
                        )
                      ) : (
                        <p className="text-xs text-muted">
                          Not a winner this round — better luck next time.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-6">
              {(myRounds.length > 0 || otherRounds.length > 0) && (
                <div className="p-6 rounded-2xl border border-border-low backdrop-blur-sm space-y-2">
                  {(() => {
                    const renderRow = (r: LotteryRoundState) => {
                      const isSelected = isBuyMode
                        ? r.status === "Open"
                        : r.roundId === selectedRoundId;
                      const badge = roundRowBadge(r);
                      return (
                        <button
                          key={r.roundId.toString()}
                          onClick={() =>
                            !isSelected &&
                            setSelectedRoundId(
                              r.status === "Open" ? null : r.roundId
                            )
                          }
                          disabled={isSelected}
                          className={`w-full flex justify-between items-center p-2 rounded-lg border text-left transition ${
                            isSelected
                              ? "border-foreground/15 bg-foreground/5 cursor-default"
                              : "border-border-low hover:border-border bg-foreground/[0.02] hover:bg-foreground/[0.05] dark:bg-neutral-900/50 dark:hover:bg-neutral-900/80 cursor-pointer group"
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-xs font-semibold ${isSelected ? "text-foreground" : "text-muted group-hover:text-foreground"}`}
                              >
                                Week #{r.roundId.toString()}
                              </span>
                              <span
                                className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${statusPillClasses(r.status)}`}
                              >
                                {statusLabel(r.status)}
                              </span>
                            </div>
                            {r.myEntry && (
                              <p className="text-[10px] text-muted font-sans mt-1">
                                Your Tickets:{" "}
                                <span className="font-mono text-foreground">
                                  {r.myEntry.amount.toFixed(AMOUNT_DECIMALS)}{" "}
                                  USDC
                                </span>
                              </p>
                            )}
                          </div>
                          <div className="text-right flex items-center gap-1.5">
                            {!isSelected && (
                              <span
                                className={`text-[10px] font-bold rounded px-1.5 py-0.5 font-sans transition ${
                                  badge.highlight
                                    ? "text-amber-700 dark:text-amber-400 border border-amber-500/30 bg-amber-500/10"
                                    : "text-muted group-hover:text-foreground border border-border group-hover:border-foreground/50 bg-card dark:bg-neutral-950"
                                }`}
                              >
                                {badge.label}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    };
                    return (
                      <>
                        {myRounds.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-lg font-bold">My Rounds</h3>
                            <div className="space-y-1.5">
                              {myRounds.map(renderRow)}
                            </div>
                          </div>
                        )}
                        {otherRounds.length > 0 && (
                          <div
                            className={`space-y-2 ${myRounds.length > 0 ? "pt-2 border-t border-border-low" : ""}`}
                          >
                            <h3 className="text-lg font-bold">All Rounds</h3>
                            <div className="space-y-1.5">
                              {otherRounds.map(renderRow)}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {isBuyMode && openRound && (
                <div className="p-6 rounded-2xl border border-border-low backdrop-blur-sm space-y-4">
                  <h3 className="text-lg font-bold">Your Entry</h3>
                  {!isConnected ? (
                    <p className="text-xs text-muted">
                      Connect your wallet to see your tickets for this round.
                    </p>
                  ) : !myEntry ? (
                    <p className="text-xs text-muted">
                      You haven&apos;t bought a ticket for Week #
                      {openRound.roundId.toString()} yet.
                    </p>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted">Your Tickets</span>
                        <span className="font-mono text-foreground">
                          {myEntry.amount.toFixed(AMOUNT_DECIMALS)} USDC
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Win Chance</span>
                        <span className="font-mono text-foreground">
                          {winChancePct.toFixed(4)}%
                        </span>
                      </div>
                      <p className="text-[10px] text-muted/70">
                        A random point in the pool decides the winner — the more
                        of the pool your tickets cover, the better your odds.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="p-6 rounded-2xl border border-border-low backdrop-blur-sm space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted">
                  How it works
                </h3>
                <ul className="text-xs text-muted space-y-2 list-disc list-inside">
                  <li>
                    Every ticket buys a range of numbers proportional to its
                    USDC amount.
                  </li>
                  <li>
                    When the round draws, one random number picks the winner.
                  </li>
                  <li>The winner claims the entire jackpot for that round.</li>
                  <li>Open to anyone — no syndicate stake required to join.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        <HowItWorks />
        <FAQ />
      </main>
    </div>
  );
}
