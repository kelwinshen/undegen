"use client";

import React, { useState } from "react";

interface SimulationControlsProps {
  isSimulating: boolean;
  setIsSimulating: (val: boolean) => void;
  onTriggerGoal: () => void;
  onSettleMatch: () => void;
  liveMatchFinished: boolean;
}

export default function SimulationControls({
  isSimulating,
  setIsSimulating,
  onTriggerGoal,
  onSettleMatch,
  liveMatchFinished,
}: SimulationControlsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Collapsed View
  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="fixed bottom-24 left-4 z-40 lg:bottom-6 lg:right-6 flex items-center justify-center h-12 w-12 bg-card hover:bg-card/90 active:scale-95 text-foreground rounded-full border border-border-strong shadow-2xl backdrop-blur-md transition-all duration-200 cursor-pointer"
        title="Open Match Simulator"
      >
        <span className="text-xl">🛠️</span>
        {isSimulating && (
          <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
        )}
      </button>
    );
  }

  // Expanded View
  return (
    <div className="fixed bottom-24 left-4 z-40 lg:bottom-6 lg:right-6 max-w-sm w-80 font-sans animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-card/95 border border-border-low dark:border-neutral-800 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.6)] transition-all duration-300 backdrop-blur-md">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-border-low dark:border-neutral-950">
          <div className="flex items-center gap-2">
            <span className="text-base">🛠️</span>
            <span className="font-bold text-xs tracking-wider uppercase text-muted">
              Match Simulator
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              {isSimulating && (
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              )}
              <span
                className={`text-[10px] font-mono font-bold ${
                  isSimulating ? "text-emerald-400" : "text-neutral-500"
                }`}
              >
                {isSimulating ? "ACTIVE" : "OFF"}
              </span>
            </div>
            
            {/* Collapse Button */}
            <button
              onClick={() => setIsExpanded(false)}
              className="text-xs text-muted hover:text-foreground cursor-pointer transition-colors p-1"
              title="Minimize"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Simulation Mode</span>
            <button
              onClick={() => setIsSimulating(!isSimulating)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isSimulating ? "bg-emerald-500" : "bg-neutral-200 dark:bg-neutral-800"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  isSimulating ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {isSimulating ? (
            <div className="space-y-2.5 pt-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <p className="text-[11px] text-muted leading-relaxed">
                Simulating a live match day: 2 Settled matches, 1 Live match, 1 Locked, and 1 Upcoming match.
              </p>
              
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onTriggerGoal}
                  disabled={liveMatchFinished}
                  className="flex items-center justify-center gap-1 bg-foreground/5 hover:bg-foreground/10 active:scale-95 border border-border-low text-foreground dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-white transition disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  <span>⚽</span> Goal!
                </button>
                <button
                  onClick={onSettleMatch}
                  disabled={liveMatchFinished}
                  className="flex items-center justify-center gap-1 bg-foreground/5 hover:bg-foreground/10 active:scale-95 border border-border-low text-foreground dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-white transition disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  <span>🏁</span> Settle Match
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted leading-relaxed">
              Enable simulation mode to preview dynamic live/finished match states and treasury allocations.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
