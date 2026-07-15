"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUndegenProgram } from "../context/UndegenProgramContext";
import HowItWorks from "../components/home/HowItWorks";
import FAQ from "../components/home/FAQ";

export default function UpcomingBatchesPage() {
  const router = useRouter();
  const { batches, isLoading } = useUndegenProgram();

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-foreground">
      <main className="relative z-10 mx-auto flex max-w-6xl min-h-screen flex-col gap-8 border-border-low px-6 pt-28 pb-28 md:pb-12">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Prediction Pools
            </h2>
            <p className="text-sm text-muted mt-1">
              These are all the batches you can monitor and join. Click on any batch to see the available matches you can predict and participate in.
            </p>
          </div>

          {isLoading ? (
            <div className="animate-pulse text-muted py-12 text-center">
              Loading syndicate batches...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {batches
                .filter((batch) => batch.phase === "Lobby")
                .map((batch) => {
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
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20`}
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

                      <button
                        onClick={() => router.push(`/?batch=${batch.batchId}`)}
                        className="w-full py-3 rounded-xl font-bold transition text-sm cursor-pointer bg-card border border-border text-foreground hover:bg-foreground/5 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800"
                      >
                        Join Lobby Phase ➜
                      </button>
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
