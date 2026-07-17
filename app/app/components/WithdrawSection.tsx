"use client";

import { useState } from "react";
import { motion } from "motion/react";

interface WithdrawSectionProps {
  batchId: number;
  userDeposited: number;
  userWithdrawn?: boolean;
  isConnected: boolean;
  onClaim: () => Promise<void>;
  onJoinLottery: () => Promise<void>;
  // Whether the lottery currently has an Open round to wager into — the
  // real `claim_and_join_lottery` instruction reverts without one, so the
  // button stays disabled rather than letting that fail on-chain.
  lotteryAvailable: boolean;
}

export default function WithdrawSection({
  batchId,
  userDeposited,
  userWithdrawn = false,
  isConnected,
  onClaim,
  onJoinLottery,
  lotteryAvailable,
}: WithdrawSectionProps) {
  const [isClaiming, setIsClaiming] = useState(false);
  const [isJoiningLottery, setIsJoiningLottery] = useState(false);
  const isProcessing = isClaiming || isJoiningLottery;

  const handleClaimClick = async () => {
    setIsClaiming(true);
    try {
      await onClaim();
    } catch (e) {
      console.error(e);
    } finally {
      setIsClaiming(false);
    }
  };

  const handleJoinLotteryClick = async () => {
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
      className="border border-border-low rounded-2xl backdrop-blur-sm p-6 text-left font-sans space-y-6"
    >
      <div className="space-y-1">
        <h2 className="text-xl font-medium tracking-tight text-foreground">
          Settlement Complete
        </h2>
        <p className="text-xs text-muted max-w-xl leading-relaxed">
          Your principal and earnings are ready to claim together in a single
          transaction, or wager your earnings straight into the weekly
          lottery.
        </p>
      </div>

      <div>
        {!isConnected ? (
          <div className="p-4 text-center border border-dashed border-border-low rounded-xl">
            <p className="text-xs text-muted font-light">
              Connect wallet to view settlement options
            </p>
          </div>
        ) : userWithdrawn ? (
          <div className="p-4 text-center border border-foreground/20 bg-foreground/[0.02] rounded-xl flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-foreground" />
            <span className="text-xs font-medium text-foreground">
              Funds Claimed (Staked + Earnings)
            </span>
          </div>
        ) : userDeposited > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Claim Button — real `claim` instruction, pays out principal
                plus this user's share of accumulated winnings together. */}
            <button
              onClick={handleClaimClick}
              disabled={isProcessing}
              className="py-3 px-6 border border-border hover:border-foreground/50 hover:bg-foreground/5 dark:hover:bg-white/5 active:scale-[0.99] font-medium rounded-xl text-xs tracking-wider uppercase transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 text-foreground"
            >
              {isClaiming ? (
                <span className="inline-block animate-pulse">Processing...</span>
              ) : (
                <span>Unstake & Claim Earn</span>
              )}
            </button>

            {/* Join Lottery — real `claim_and_join_lottery` instruction: same
                principal payout, but the earnings leg buys a lottery ticket
                instead of landing in the wallet. */}
            <button
              onClick={handleJoinLotteryClick}
              disabled={isProcessing || !lotteryAvailable}
              title={lotteryAvailable ? undefined : "No open lottery round right now"}
              className="py-3 px-6 border border-border-low font-medium rounded-xl text-xs tracking-wider uppercase transition-all duration-150 flex items-center justify-center gap-2 text-foreground hover:border-foreground/50 hover:bg-foreground/5 dark:hover:bg-white/5 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border-low disabled:hover:bg-transparent cursor-pointer"
            >
              {isJoiningLottery ? (
                <span className="inline-block animate-pulse">Processing...</span>
              ) : (
                <span>Unstake & Join Lottery with Earn</span>
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
