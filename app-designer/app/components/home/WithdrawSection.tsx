"use client";

import { useState } from "react";
import { motion } from "motion/react";

interface WithdrawSectionProps {
  batchId: number;
  userDeposited: number;
  userWithdrawn?: boolean;
  isConnected: boolean;
  onWithdraw: () => Promise<void>;
  onJoinLottery: () => Promise<void>;
}

export default function WithdrawSection({
  batchId,
  userDeposited,
  userWithdrawn = false,
  isConnected,
  onWithdraw,
  onJoinLottery,
}: WithdrawSectionProps) {
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isJoiningLottery, setIsJoiningLottery] = useState(false);

  const isProcessing = isWithdrawing || isJoiningLottery;

  const handleWithdrawClick = async () => {
    setIsWithdrawing(true);
    try {
      await onWithdraw();
    } catch (e) {
      console.error(e);
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleLotteryClick = async () => {
    setIsJoiningLottery(true);
    try {
      await onJoinLottery();
    } catch (e) {
      console.error(e);
    } finally {
      setIsJoiningLottery(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="border border-border-low rounded-2xl backdrop-blur-sm p-6 text-left font-sans  space-y-6"
    >
      {/* Row 1: Details & Capital Information */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2"></div>
          <h2 className="text-xl font-medium tracking-tight text-foreground">
            Settlement Complete
          </h2>
          <p className="text-xs text-muted max-w-xl leading-relaxed">
            Your principal is now unlocked and available. Choose to withdraw to
            your wallet or roll it over into the weekly yield lottery.
          </p>
        </div>

        {isConnected && userDeposited > 0 && !userWithdrawn && (
          <div className="flex flex-col items-start md:items-end shrink-0">
            <span className="text-[10px] uppercase tracking-widest text-muted/60">
              Staked Amount
            </span>
            <span className="text-2xl font-light font-mono text-foreground mt-0.5">
              ${userDeposited.toLocaleString()}
              <span className="text-xs font-sans text-muted ml-1">USDC</span>
            </span>
          </div>
        )}
      </div>

      {/* Separator line between rows (only visible if interactive options are shown) */}
      {isConnected && userDeposited > 0 && !userWithdrawn && (
        <div className="h-[1px] w-full bg-border-low" />
      )}

      {/* Row 2: Settlement Buttons */}
      <div>
        {!isConnected ? (
          <div className="p-4 text-center border border-dashed border-border-low rounded-xl">
            <p className="text-xs text-muted font-light">
              Connect wallet to view settlement options
            </p>
          </div>
        ) : userWithdrawn ? (
          <div className="p-4 text-center border border-emerald-500/20 bg-emerald-500/[0.02] rounded-xl flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Funds Settled (Capital Reclaimed / Lottery Joined)
            </span>
          </div>
        ) : userDeposited > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Withdraw Button */}
            <button
              onClick={handleWithdrawClick}
              disabled={isProcessing}
              className="py-3 px-6 border border-border hover:border-foreground/50 hover:bg-foreground/5 dark:hover:bg-white/5 active:scale-[0.99] font-medium rounded-xl text-xs tracking-wider uppercase transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 text-foreground"
            >
              {isWithdrawing ? (
                <span className="inline-block animate-pulse">Releasing...</span>
              ) : (
                <span>Withdraw Funds</span>
              )}
            </button>

            {/* Join Lottery Button */}
            <button
              onClick={handleLotteryClick}
              disabled={isProcessing}
              className="py-3 px-6 bg-foreground text-background dark:bg-white dark:text-black hover:opacity-90 active:scale-[0.99] font-medium rounded-xl text-xs tracking-wider uppercase transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
            >
              {isJoiningLottery ? (
                <span className="inline-block animate-pulse">Joining...</span>
              ) : (
                <span>Join Yield Lottery</span>
              )}
            </button>
          </div>
        ) : (
          <div className="p-4 text-center border border-border-low rounded-xl bg-foreground/[0.01]">
            <p className="text-xs text-muted font-light">
              No active stake in Batch #{batchId} to settle.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
