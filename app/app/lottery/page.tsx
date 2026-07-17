"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import HowItWorks from "../components/HowItWorks";
import FAQ from "../components/FAQ";
import { useUndegenProgram } from "../context/UndegenProgramContext";
import {
  fetchActiveLotteryRound,
  fetchLotteryEntry,
  LotteryRoundState,
  LotteryEntryState,
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

export default function LotteryPage() {
  const { isConnected, walletAddress, usdcBalance, buyLotteryTicket } = useUndegenProgram();

  const [isLoading, setIsLoading] = useState(true);
  const [round, setRound] = useState<LotteryRoundState | null>(null);
  const [myEntry, setMyEntry] = useState<LotteryEntryState | null>(null);
  const [amount, setAmount] = useState("");
  const [isBuying, setIsBuying] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadRound = useCallback(async () => {
    const activeRound = await fetchActiveLotteryRound();
    setRound(activeRound);
    if (activeRound && walletAddress) {
      const entry = await fetchLotteryEntry(activeRound.roundPda, walletAddress);
      setMyEntry(entry);
    } else {
      setMyEntry(null);
    }
  }, [walletAddress]);

  useEffect(() => {
    setIsLoading(true);
    loadRound().finally(() => setIsLoading(false));
  }, [loadRound]);

  // Background poll, same cadence as the batch state poll — the pool grows
  // as other people buy tickets, not just when this wallet acts.
  useEffect(() => {
    const interval = setInterval(() => loadRound(), 15000);
    return () => clearInterval(interval);
  }, [loadRound]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handlePercentageClick = (pct: number) => {
    setAmount(calcPercentageAmount(usdcBalance, pct));
  };

  const parsedAmount = parseFloat(amount);
  const canBuy =
    round?.status === "Open" &&
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
      await loadRound();
    } catch (e: any) {
      setToastMessage(e?.message || "Ticket purchase failed.");
    } finally {
      setIsBuying(false);
    }
  };

  const winChancePct = round && round.totalPool > 0 && myEntry ? (myEntry.amount / round.totalPool) * 100 : 0;

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
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Weekly Lottery</h2>
          <p className="text-sm text-muted mt-1">
            One shared jackpot, open to anyone — buy a ticket with any amount of
            USDC and your odds scale with your share of the pool. No syndicate
            stake required.
          </p>
        </div>

        {isLoading ? (
          <div className="animate-pulse text-muted py-12 text-center">Loading lottery round...</div>
        ) : !round ? (
          <div className="p-8 rounded-2xl border border-dashed border-border-low text-center space-y-2">
            <div className="text-muted text-lg font-semibold">No open round right now</div>
            <p className="text-muted text-sm max-w-sm mx-auto">
              Check back once the next round starts — or claim into a future
              round straight from a settled batch on{" "}
              <a href="/history" className="underline hover:text-foreground">History</a>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="p-6 rounded-2xl border border-border-low backdrop-blur-sm space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <span>Round #{round.roundId.toString()}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20">
                      {round.status}
                    </span>
                  </h3>
                </div>

                <div className="p-4 rounded-xl bg-foreground/5 border border-border-low dark:bg-white/5 dark:border-white/5 space-y-1">
                  <p className="text-xs text-muted">Current Jackpot</p>
                  <p className="text-3xl font-black text-foreground font-mono">
                    {round.totalPool.toFixed(AMOUNT_DECIMALS)} USDC
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
                    <span>Balance: {usdcBalance.toFixed(AMOUNT_DECIMALS)} USDC</span>
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
                    <p className="text-xs text-muted font-light">Connect your wallet to buy a ticket.</p>
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
            </div>

            <div className="space-y-6">
              <div className="p-6 rounded-2xl border border-border-low backdrop-blur-sm space-y-4">
                <h3 className="text-lg font-bold">Your Entry</h3>
                {!isConnected ? (
                  <p className="text-xs text-muted">Connect your wallet to see your tickets for this round.</p>
                ) : !myEntry ? (
                  <p className="text-xs text-muted">
                    You haven&apos;t bought a ticket for Round #{round.roundId.toString()} yet.
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
                      <span className="font-mono text-foreground">{winChancePct.toFixed(4)}%</span>
                    </div>
                    <p className="text-[10px] text-muted/70">
                      A random point in the pool decides the winner — the more
                      of the pool your tickets cover, the better your odds.
                    </p>
                  </div>
                )}
              </div>

              <div className="p-6 rounded-2xl border border-border-low backdrop-blur-sm space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted">How it works</h3>
                <ul className="text-xs text-muted space-y-2 list-disc list-inside">
                  <li>Every ticket buys a range of numbers proportional to its USDC amount.</li>
                  <li>When the round draws, one random number picks the winner.</li>
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
