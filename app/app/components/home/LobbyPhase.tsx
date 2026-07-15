"use client";

import { useState, useEffect } from "react";

interface LobbyPhaseProps {
  batchId: number;
  lobbyExpiresAt: number | null;
  userDeposited: number;
  totalDeposited: number;
  participantCount: number;
  minimumDeposit: number;
  projectedDailyYield: number;
  walletBalance: number;
  onDeposit: (amount: number) => Promise<void>;
  onWithdraw: (amount: number) => Promise<void>;
}

export default function LobbyPhase({
  batchId,
  lobbyExpiresAt,
  userDeposited,
  totalDeposited,
  participantCount,
  minimumDeposit,
  projectedDailyYield,
  walletBalance,
  onDeposit,
  onWithdraw,
}: LobbyPhaseProps) {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [timeLeft, setTimeLeft] = useState("");
  const [isExpired, setIsExpired] = useState(false);
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [actionResult, setActionResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

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
    setActionResult(null);
    setIsDepositing(true);
    try {
      await onDeposit(amount);
      setDepositAmount("");
      setActionResult({ type: "success", message: `Deposited $${amount.toLocaleString()} USDC.` });
    } catch (e: any) {
      setActionResult({ type: "error", message: e?.message || "Deposit failed." });
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
    setActionResult(null);
    setIsWithdrawing(true);
    try {
      await onWithdraw(amount);
      setWithdrawAmount("");
      setActionResult({ type: "success", message: `Withdrew $${amount.toLocaleString()} USDC.` });
    } catch (e: any) {
      setActionResult({ type: "error", message: e?.message || "Withdrawal failed." });
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleDepositPercentageClick = (pct: number) => {
    if (isExpired) return;
    const amount = (walletBalance * pct) / 100;
    setDepositAmount(amount.toString());
  };

  const handleWithdrawPercentageClick = (pct: number) => {
    const amount = (userDeposited * pct) / 100;
    setWithdrawAmount(amount.toString());
  };

  return (
    <div className="rounded-2xl backdrop-blur-sm border border-border-low p-6 space-y-6 ">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Batch #{batchId}
          </h2>
          <p className="text-sm text-muted mt-1">
            {isExpired
              ? "This batch's Lobby has expired. Deposits are closed — withdraw your stake below."
              : "Earn yield on your assets."}
          </p>
        </div>

        {/* Countdown timer pill matching "Liquid" placement */}
        <div className="flex items-center gap-1.5 rounded-full border border-border-low px-3 py-1 text-xs text-muted bg-neutral-900/20 dark:bg-neutral-950/20 backdrop-blur-sm">
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isExpired ? "bg-red-500" : "bg-emerald-500"}`} />
          <span>Expires in:</span>
          <span className="font-mono font-medium text-foreground">
            {timeLeft}
          </span>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex justify-center mt-4">
        <div className="inline-flex rounded-full bg-neutral-900/30 dark:bg-neutral-950/50 p-1 border border-border-low">
          <button
            onClick={() => {
              setActiveTab("deposit");
              setActionResult(null);
            }}
            className={`rounded-full px-6 py-1.5 text-xs font-semibold transition ${
              activeTab === "deposit"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Deposit
          </button>
          <button
            onClick={() => {
              setActiveTab("withdraw");
              setActionResult(null);
            }}
            className={`rounded-full px-6 py-1.5 text-xs font-semibold transition ${
              activeTab === "withdraw"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Withdraw
          </button>
        </div>
      </div>

      {/* Central Numeric Input/Display */}
      <div className="flex flex-col items-center justify-center py-6">
        {activeTab === "deposit" ? (
          <>
            <div className="relative w-full flex items-center justify-center">
              <input
                type="number"
                placeholder="0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                disabled={isExpired}
                className="text-6xl font-bold text-center bg-transparent focus:outline-none w-full max-w-[280px] text-foreground placeholder-neutral-700 dark:placeholder-neutral-800 [appearance:textfield] [&::-webkit-outer-spin-button]:margin-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:margin-0 [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted mt-3">
              <span>Balance: {walletBalance.toLocaleString()} USDC</span>
            </div>
          </>
        ) : (
          <>
            <div className="relative w-full flex items-center justify-center">
              <input
                type="number"
                placeholder="0"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                disabled={userDeposited <= 0}
                className="text-6xl font-bold text-center bg-transparent focus:outline-none w-full max-w-[280px] text-foreground placeholder-neutral-700 dark:placeholder-neutral-800 [appearance:textfield] [&::-webkit-outer-spin-button]:margin-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:margin-0 [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted mt-3">
              <span>Your Stake: ${userDeposited.toFixed(2)}</span>
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
              ? "Depositing..."
              : !depositAmount
                ? "Enter Amount"
                : parseFloat(depositAmount) < minimumDeposit
                  ? `Min Deposit $${minimumDeposit}`
                  : "Deposit"}
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
              ? "Withdrawing..."
              : !withdrawAmount
                ? "Enter Amount"
                : parseFloat(withdrawAmount) > userDeposited
                  ? "Exceeds Your Stake"
                  : "Withdraw"}
          </button>
        )}

        {actionResult && (
          <div
            className={`p-2.5 rounded-lg text-xs text-center ${
              actionResult.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-500"
                : "bg-red-500/10 border border-red-500/30 text-red-500"
            }`}
          >
            {actionResult.message}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border-low/60 my-4" />

      {/* Summary Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
          Summary
        </h3>

        <div className="space-y-3.5 text-sm">
          <div className="flex justify-between items-center relative">
            <div className="relative group">
              <span className="text-muted border-b border-dashed border-neutral-700/50 pb-0.5 cursor-help">
                Total Deposit
              </span>
              <div className="absolute bottom-full left-0 mb-2 pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 w-60 p-2.5 text-[11.5px] leading-normal text-muted bg-neutral-900/95 dark:bg-neutral-950/95 border border-border-low rounded-lg shadow-xl z-30 origin-bottom-left">
                Total amount deposited by all users in this batch.
              </div>
            </div>
            <span className="font-bold text-foreground">
              ${totalDeposited.toLocaleString()}
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

          <div className="flex justify-between items-center relative">
            <div className="relative group">
              <span className="text-muted border-b border-dashed border-neutral-700/50 pb-0.5 cursor-help">
                Projected Daily Yield
              </span>
              <div className="absolute bottom-full left-0 mb-2 pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 w-60 p-2.5 text-[11.5px] leading-normal text-muted bg-neutral-900/95 dark:bg-neutral-950/95 border border-border-low rounded-lg shadow-xl z-30 origin-bottom-left">
                Estimated daily yield generated by this batch based on performance.
              </div>
            </div>
            <span className="font-bold text-foreground">
              ${projectedDailyYield.toFixed(2)}
            </span>
          </div>

          <div className="flex justify-between items-center relative">
            <div className="relative group">
              <span className="text-muted border-b border-dashed border-neutral-700/50 pb-0.5 cursor-help">
                Your Stake
              </span>
              <div className="absolute bottom-full left-0 mb-2 pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 w-60 p-2.5 text-[11.5px] leading-normal text-muted bg-neutral-900/95 dark:bg-neutral-950/95 border border-border-low rounded-lg shadow-xl z-30 origin-bottom-left">
                Your active deposit amount committed and earning yield in this batch.
              </div>
            </div>
            <span className="font-bold text-foreground">
              ${userDeposited.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Footer Info Text */}
      <p className="text-xs text-muted/80 text-center leading-relaxed mt-2 pt-2 border-t border-border-low/40">
        {isExpired
          ? "This batch's Lobby window has closed without starting. Deposits are no longer accepted — withdraw your stake whenever you're ready."
          : "You can deposit or withdraw freely while the Lobby is open. If the operator hasn't started this batch within 24h of creation, it expires and can no longer accept deposits."}
      </p>
    </div>
  );
}
