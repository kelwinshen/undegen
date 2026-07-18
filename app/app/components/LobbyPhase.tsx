"use client";

import { useState, useEffect } from "react";
import { SOLANA_CONFIG } from "../lib/solanaConfig";

// USDC's on-chain precision. Percentage math floors to this many decimal
// places so raw floating-point noise (123.45 * 33 / 100 === 40.72850000000001)
// never leaks into the input, and — just as importantly — flooring instead
// of rounding never suggests an amount a hair above what's actually available.
const AMOUNT_DECIMALS = SOLANA_CONFIG.TOKEN_DECIMALS;
// Matches MAX_BETS in start_batch.rs — each batch splits its weekly yield across 5 bets.
const MAX_WEEKLY_BETS = 5;

function trimTrailingZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function calcPercentageAmount(balance: number, pct: number): string {
  if (pct >= 100) {
    // MAX skips the percentage math entirely — hand back the exact balance
    // instead of a value flooring could leave a hair short.
    return trimTrailingZeros(balance.toFixed(AMOUNT_DECIMALS));
  }
  const scale = 10 ** AMOUNT_DECIMALS;
  const raw = (balance * pct) / 100;
  const floored = Math.floor(raw * scale) / scale;
  return trimTrailingZeros(floored.toFixed(AMOUNT_DECIMALS));
}

interface LobbyPhaseProps {
  batchId: number;
  lobbyExpiresAt: number | null;
  userDeposited: number;
  totalDeposited: number;
  participantCount: number;
  minimumDeposit: number;
  apyBps: number;
  walletBalance: number;
  onDeposit: (amount: number) => Promise<void>;
  onWithdraw: (amount: number) => Promise<void>;
  // Reports the outcome of a deposit/withdraw attempt (success or error
  // message) up to the page, which shows it as a bottom pop-up — same
  // pattern as the lottery and history pages' on-chain action toasts.
  onResult?: (message: string) => void;
}

export default function LobbyPhase({
  batchId,
  lobbyExpiresAt,
  userDeposited,
  totalDeposited,
  participantCount,
  minimumDeposit,
  apyBps,
  walletBalance,
  onDeposit,
  onWithdraw,
  onResult,
}: LobbyPhaseProps) {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [timeLeft, setTimeLeft] = useState("");
  const [isExpired, setIsExpired] = useState(false);
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const poolSharePct = totalDeposited > 0 ? (userDeposited / totalDeposited) * 100 : 0;
  // Mirrors the on-chain bet_size math in start_batch.rs: annual yield / 52
  // weeks, split evenly across the batch's 5 weekly bets.
  const estimatedWeeklyYield = (totalDeposited * (apyBps / 10000)) / 52;
  const estimatedYieldPerBet = estimatedWeeklyYield / MAX_WEEKLY_BETS;

  useEffect(() => {
    const update = () => {
      // Batches created before the created_at/expiry field existed have no
      // real deadline to show — say so plainly rather than fabricating one.
      if (lobbyExpiresAt === null) {
        setTimeLeft("Unknown");
        setIsExpired(false);
        return;
      }
      const now = Date.now();
      const diff = lobbyExpiresAt - now;
      if (diff <= 0) {
        setTimeLeft("Lobby expired");
        setIsExpired(true);
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [lobbyExpiresAt]);

  const handleDeposit = async () => {
    if (isExpired) return;
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount < minimumDeposit) return;
    setIsDepositing(true);
    try {
      await onDeposit(amount);
      setDepositAmount("");
      onResult?.(`Staked ${amount.toLocaleString()} USDC.`);
    } catch (e: any) {
      onResult?.(e?.message || "Stake failed.");
    } finally {
      setIsDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    // Withdrawal stays open even after Lobby expiry — leave_batch still
    // works on an expired-but-still-Lobby batch, only join_batch/start_batch
    // get blocked on-chain.
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0 || amount > userDeposited) return;
    setIsWithdrawing(true);
    try {
      await onWithdraw(amount);
      setWithdrawAmount("");
      onResult?.(`Unstaked ${amount.toLocaleString()} USDC.`);
    } catch (e: any) {
      onResult?.(e?.message || "Unstake failed.");
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleDepositPercentageClick = (pct: number) => {
    if (isExpired) return;
    setDepositAmount(calcPercentageAmount(walletBalance, pct));
  };

  const handleWithdrawPercentageClick = (pct: number) => {
    setWithdrawAmount(calcPercentageAmount(userDeposited, pct));
  };

  return (
    <div className="rounded-2xl backdrop-blur-sm border border-border-low p-6 space-y-6 ">
      {/* Header */}
      <div className="flex justify-end items-start">
       

        {/* Countdown timer pill matching "Liquid" placement */}
        <div className="flex items-center gap-1.5 rounded-full border border-border-low px-3 py-1 text-xs text-muted bg-neutral-900/20 dark:bg-neutral-950/20 backdrop-blur-sm">
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isExpired ? "bg-red-500" : "bg-foreground"}`} />
          <span>Starts in:</span>
          <span className="font-mono font-medium text-foreground">
            {timeLeft}
          </span>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex justify-center mt-4">
        <div className="inline-flex rounded-full bg-neutral-900/30 dark:bg-neutral-950/50 p-1 border border-border-low">
          <button
            onClick={() => setActiveTab("deposit")}
            className={`rounded-full px-6 py-1.5 text-xs font-semibold transition ${
              activeTab === "deposit"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Stake
          </button>
          <button
            onClick={() => setActiveTab("withdraw")}
            className={`rounded-full px-6 py-1.5 text-xs font-semibold transition ${
              activeTab === "withdraw"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Unstake
          </button>
        </div>
      </div>

      {/* Central Numeric Input/Display */}
      <div className="flex flex-col items-center justify-center py-6">
        {activeTab === "deposit" ? (
          <>
            <div className="relative w-full flex items-center justify-center">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={depositAmount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^[0-9]*\.?[0-9]*$/.test(val)) setDepositAmount(val);
                }}
                disabled={isExpired}
                className="text-6xl font-bold text-center bg-transparent focus:outline-none w-full max-w-[280px] text-foreground placeholder-neutral-700 dark:placeholder-neutral-800"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted mt-3">
              <span>Balance: {walletBalance.toFixed(AMOUNT_DECIMALS)} USDC</span>
            </div>
          </>
        ) : (
          <>
            <div className="relative w-full flex items-center justify-center">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={withdrawAmount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^[0-9]*\.?[0-9]*$/.test(val)) setWithdrawAmount(val);
                }}
                disabled={userDeposited <= 0}
                className="text-6xl font-bold text-center bg-transparent focus:outline-none w-full max-w-[280px] text-foreground placeholder-neutral-700 dark:placeholder-neutral-800"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted mt-3">
              <span>Your Stake: {userDeposited.toFixed(AMOUNT_DECIMALS)} USDC</span>
            </div>
          </>
        )}
      </div>

      {/* Percentage Quick-Select Buttons */}
      <div className="grid grid-cols-4 gap-2">
        {[25, 50, 75, 100].map((pct) => (
          <button
            key={pct}
            onClick={() =>
              activeTab === "deposit"
                ? handleDepositPercentageClick(pct)
                : handleWithdrawPercentageClick(pct)
            }
            disabled={activeTab === "deposit" ? isExpired : userDeposited <= 0}
            className="rounded-xl py-2.5 text-xs font-semibold bg-neutral-900/20 dark:bg-neutral-800/40 border border-border-low text-muted hover:text-foreground hover:bg-neutral-900/40 dark:hover:bg-neutral-800/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pct === 100 ? "MAX" : `${pct}%`}
          </button>
        ))}
      </div>

      {/* Main Action Button */}
      <div className="space-y-2">
        {activeTab === "deposit" ? (
          <button
            onClick={handleDeposit}
            disabled={
              isExpired ||
              isDepositing ||
              !depositAmount ||
              parseFloat(depositAmount) < minimumDeposit
            }
            className={`w-full py-3.5 font-bold rounded-full transition text-sm ${
              isExpired ||
              isDepositing ||
              !depositAmount ||
              parseFloat(depositAmount) < minimumDeposit
                ? "bg-neutral-800/40 text-neutral-500 border border-border-low cursor-not-allowed"
                : "bg-foreground text-background hover:bg-foreground/90"
            }`}
          >
            {isDepositing
              ? "Staking..."
              : !depositAmount
                ? "Enter Amount"
                : parseFloat(depositAmount) < minimumDeposit
                  ? `Min Stake ${minimumDeposit} USDC`
                  : "Stake"}
          </button>
        ) : (
          <button
            onClick={handleWithdraw}
            disabled={
              isWithdrawing ||
              userDeposited <= 0 ||
              !withdrawAmount ||
              parseFloat(withdrawAmount) <= 0 ||
              parseFloat(withdrawAmount) > userDeposited
            }
            className={`w-full py-3.5 font-bold rounded-full transition text-sm ${
              isWithdrawing ||
              userDeposited <= 0 ||
              !withdrawAmount ||
              parseFloat(withdrawAmount) <= 0 ||
              parseFloat(withdrawAmount) > userDeposited
                ? "bg-neutral-800/40 text-neutral-500 border border-border-low cursor-not-allowed"
                : "bg-red-500/20 border border-red-500/30 text-red-500 hover:bg-red-500/30 dark:bg-red-500/25 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/35"
            }`}
          >
            {isWithdrawing
              ? "Unstaking..."
              : !withdrawAmount
                ? "Enter Amount"
                : parseFloat(withdrawAmount) > userDeposited
                  ? "Exceeds Your Stake"
                  : "Unstake"}
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border-low/60 my-4" />

      {/* Summary Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
          Summary
        </h3>

        <div className="space-y-4">
          <div className="space-y-3.5">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Your Position</p>

            <div className="flex justify-between items-center relative">
              <div className="relative group">
                <span className="text-muted border-b border-dashed border-neutral-700/50 pb-0.5 cursor-help">
                  Your Stake
                </span>
                <div className="absolute bottom-full left-0 mb-2 pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 w-60 p-2.5 text-[11.5px] leading-normal text-muted bg-neutral-900/95 dark:bg-neutral-950/95 border border-border-low rounded-lg shadow-xl z-30 origin-bottom-left">
                  Your active stake amount committed and earning yield in this batch.
                </div>
              </div>
              <span className="font-bold text-foreground">
                {userDeposited.toFixed(AMOUNT_DECIMALS)} USDC
              </span>
            </div>

            <div className="flex justify-between items-center relative">
              <div className="relative group">
                <span className="text-muted border-b border-dashed border-neutral-700/50 pb-0.5 cursor-help">
                  Your Pool Share
                </span>
                <div className="absolute bottom-full left-0 mb-2 pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 w-60 p-2.5 text-[11.5px] leading-normal text-muted bg-neutral-900/95 dark:bg-neutral-950/95 border border-border-low rounded-lg shadow-xl z-30 origin-bottom-left">
                  Your stake as a share of this batch's total pool.
                </div>
              </div>
              <span className="font-bold text-foreground">
                {poolSharePct.toFixed(5)}%
              </span>
            </div>
          </div>

          <div className="border-t border-border-low/60 pt-3.5 space-y-3.5">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Pool</p>

            <div className="flex justify-between items-center relative">
              <div className="relative group">
                <span className="text-muted border-b border-dashed border-neutral-700/50 pb-0.5 cursor-help">
                  APY
                </span>
                <div className="absolute bottom-full left-0 mb-2 pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 w-60 p-2.5 text-[11.5px] leading-normal text-muted bg-neutral-900/95 dark:bg-neutral-950/95 border border-border-low rounded-lg shadow-xl z-30 origin-bottom-left">
                  Annual yield rate proposed by the operator when this batch was created.
                </div>
              </div>
              <span className="font-bold text-foreground">
                {(apyBps / 100).toFixed(2)}%
              </span>
            </div>

            <div className="flex justify-between items-center relative">
              <div className="relative group">
                <span className="text-muted border-b border-dashed border-neutral-700/50 pb-0.5 cursor-help">
                  Total Pool Stake
                </span>
                <div className="absolute bottom-full left-0 mb-2 pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 w-60 p-2.5 text-[11.5px] leading-normal text-muted bg-neutral-900/95 dark:bg-neutral-950/95 border border-border-low rounded-lg shadow-xl z-30 origin-bottom-left">
                  Total amount staked by all users in this batch.
                </div>
              </div>
              <span className="font-bold text-foreground">
                {totalDeposited.toFixed(AMOUNT_DECIMALS)} USDC
              </span>
            </div>

            <div className="flex justify-between items-center relative">
              <div className="relative group">
                <span className="text-muted border-b border-dashed border-neutral-700/50 pb-0.5 cursor-help">
                  Total Bet Capital
                </span>
                <div className="absolute bottom-full left-0 mb-2 pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 w-60 p-2.5 text-[11.5px] leading-normal text-muted bg-neutral-900/95 dark:bg-neutral-950/95 border border-border-low rounded-lg shadow-xl z-30 origin-bottom-left">
                  Total pool stake × APY ÷ 52 weeks — the guaranteed weekly yield available to bet with.
                </div>
              </div>
              <span className="font-bold text-foreground">
                {estimatedWeeklyYield.toFixed(AMOUNT_DECIMALS)} USDC
              </span>
            </div>

            <div className="flex justify-between items-center relative">
              <div className="relative group">
                <span className="text-muted border-b border-dashed border-neutral-700/50 pb-0.5 cursor-help">
                  Bet Size
                </span>
                <div className="absolute bottom-full left-0 mb-2 pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 w-60 p-2.5 text-[11.5px] leading-normal text-muted bg-neutral-900/95 dark:bg-neutral-950/95 border border-border-low rounded-lg shadow-xl z-30 origin-bottom-left">
                  Total bet capital split evenly across this batch's 5 weekly bets.
                </div>
              </div>
              <span className="font-bold text-foreground">
                {estimatedYieldPerBet.toFixed(AMOUNT_DECIMALS)} USDC
              </span>
            </div>

            <div className="flex justify-between items-center relative">
              <div className="relative group">
                <span className="text-muted border-b border-dashed border-neutral-700/50 pb-0.5 cursor-help">
                  Participants
                </span>
                <div className="absolute bottom-full left-0 mb-2 pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 w-60 p-2.5 text-[11.5px] leading-normal text-muted bg-neutral-900/95 dark:bg-neutral-950/95 border border-border-low rounded-lg shadow-xl z-30 origin-bottom-left">
                  Total number of users who have joined and committed funds to this batch.
                </div>
              </div>
              <span className="font-bold text-foreground">
                {participantCount}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Info Text */}
      <p className="text-xs text-muted/80 text-center leading-relaxed mt-2 pt-2 border-t border-border-low/40">
        {isExpired
          ? "This batch's Lobby window has closed without starting. Staking is no longer accepted — unstake whenever you're ready."
          : "You can stake or unstake freely while the Lobby is open. If the operator hasn't started this batch within 24h of creation, it expires and can no longer accept new stakes."}
      </p>
    </div>
  );
}
