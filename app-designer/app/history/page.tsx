"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import HowItWorks from "../components/home/HowItWorks";
import FAQ from "../components/home/FAQ";
import { useUndegenProgram } from "../context/UndegenProgramContext";

export default function HistoryPage() {
  const router = useRouter();
  const { batches, isLoading, isConnected, withdraw } = useUndegenProgram();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handleWithdraw = async (batchId: number, amount: number) => {
    try {
      await withdraw(batchId);
      setToastMessage(
        `Successfully withdrew $${amount.toLocaleString()} USDC from Batch #${batchId}!`
      );
    } catch (e) {
      console.error(e);
      setToastMessage(`Failed to withdraw from Batch #${batchId}`);
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-foreground">
      {/* Toast Alert */}
      <AnimatePresence>
        {toastMessage && (
          <div className="fixed bottom-24 left-4 right-4 z-50 flex justify-center pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="bg-card/95 dark:bg-[#111218]/95 border border-border-strong text-foreground text-xs font-bold tracking-wider py-3 px-6 rounded-full shadow-2xl backdrop-blur-md flex items-center gap-2 pointer-events-auto"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              {toastMessage}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="relative z-10 mx-auto flex max-w-6xl min-h-screen flex-col gap-8 border-border-low px-6 pt-28 pb-28 md:pb-12">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Batch History
            </h2>
            <p className="text-sm text-muted mt-1">
              Review completed and active prediction pools. Click on any batch
              to see the available matches, consensus predictions, and
              historical results.
            </p>
          </div>

          {isLoading ? (
            <div className="animate-pulse text-muted py-12 text-center">
              Loading syndicate batches...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {batches
                .filter((batch) => batch.phase === "Ended")
                .map((batch) => {
                  const hasDeposit = batch.userDeposited > 0;
                  const isWithdrawn = !!batch.userWithdrawn;

                  return (
                    <div
                      key={batch.batchId}
                      className="p-6 rounded-2xl border border-border-low backdrop-blur-sm flex flex-col justify-between space-y-6 hover:border-foreground/10 dark:hover:border-white/10 transition duration-300"
                    >
                      <div className="space-y-4">
                        {/* Top Header */}
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-bold text-foreground">
                              Batch #{batch.batchId}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-neutral-100 text-neutral-800 border border-neutral-200 dark:bg-neutral-500/10 dark:text-neutral-400 dark:border-neutral-500/20`}
                            >
                              {batch.phase}
                            </span>
                          </div>
                        </div>

                        {/* Treasury metric */}
                        <div className="p-4 rounded-xl bg-foreground/5 border border-border-low dark:bg-white/5 dark:border-white/5 space-y-1">
                          <p className="text-xs text-muted">
                            Weekly Treasury Pool
                          </p>
                          <p className="text-3xl font-black text-foreground font-mono">
                            $
                            {batch.weeklyYieldPool.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        </div>

                        {/* User Deposit Info */}
                        {isConnected && hasDeposit && (
                          <div className="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex justify-between items-center">
                            <div>
                              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">
                                Your Deposit
                              </p>
                              <p className="text-sm font-bold text-foreground font-mono mt-0.5">
                                ${batch.userDeposited.toLocaleString()} USDC
                              </p>
                            </div>
                            <span
                              className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                isWithdrawn
                                  ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-500/20"
                              }`}
                            >
                              {isWithdrawn ? "Withdrawn" : "Claimable"}
                            </span>
                          </div>
                        )}

                        {/* Additional Details */}
                        <div className="grid grid-cols-2 gap-4 text-sm pt-2">
                          <div>
                            <p className="text-xs text-muted">Total Staked</p>
                            <p className="font-semibold text-foreground font-mono mt-0.5">
                              ${batch.totalDeposited.toLocaleString()} USDC
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted">Participants</p>
                            <p className="font-semibold text-foreground font-mono mt-0.5">
                              {batch.participantCount} users
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-col sm:flex-row gap-3">
                        <button
                          onClick={() =>
                            router.push(`/?batch=${batch.batchId}`)
                          }
                          className="flex-1 py-3 rounded-xl font-bold transition text-sm cursor-pointer bg-card border border-border text-foreground hover:bg-foreground/5 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800"
                        >
                          View Ended Results ➜
                        </button>

                        {/* Withdraw option for ended batches with active deposits */}
                        {batch.phase === "Ended" && hasDeposit && (
                          <>
                            {!isWithdrawn ? (
                              <button
                                onClick={() =>
                                  handleWithdraw(
                                    batch.batchId,
                                    batch.userDeposited
                                  )
                                }
                                className="flex-1 py-3 rounded-xl font-bold transition text-sm cursor-pointer bg-emerald-500 hover:bg-emerald-600 text-white"
                              >
                                Withdraw ${batch.userDeposited} USDC
                              </button>
                            ) : (
                              <div className="flex-1 py-3 rounded-xl font-bold text-sm bg-neutral-100 text-neutral-400 border border-neutral-200 dark:bg-neutral-800/40 dark:text-neutral-500 dark:border-neutral-800 text-center flex items-center justify-center gap-1.5 select-none">
                                <svg
                                  className="w-4 h-4 text-neutral-400"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M4.5 12.75l6 6 9-13.5"
                                  />
                                </svg>
                                Withdrawn
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <HowItWorks />
        <FAQ />
      </main>
    </div>
  );
}
