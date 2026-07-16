"use client";

import React from "react";

interface DashboardMetricsProps {
  principal: string;
  setPrincipal: (value: string) => void;
  userDailyYield: number;
  globalTVL: number;
  globalDailyYield: number;
  isConnected: boolean;
  phase?: string;
}

export default function DashboardMetrics({
  principal,
  setPrincipal,
  userDailyYield,
  globalTVL,
  globalDailyYield,
  isConnected,
  phase = "Active",
}: DashboardMetricsProps) {
  const isLobby = phase === "Lobby";

  return (
    <div className="p-6 rounded-2xl backdrop-blur-sm border border-border-low space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {isLobby ? "Join the Syndicate" : "Your Dashboard"}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Simulated principal:</span>
          <input
            type="number"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            className="w-24 border border-border-low rounded-lg px-2 py-1 text-sm text-foreground bg-transparent text-right focus:outline-none focus:border-foreground dark:focus:border-white"
          />
          <span className="text-xs text-muted">USDC</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-3  rounded-lg text-center">
          <p className="text-xs text-muted">Total Value Locked</p>
          <p className="text-lg font-bold">${globalTVL.toLocaleString()}</p>
        </div>

        {!isLobby && (
          <>
            <div className="p-3  rounded-lg text-center">
              <p className="text-xs text-muted">Daily Yield Pool</p>
              <p className="text-lg font-bold">
                ${globalDailyYield.toFixed(2)}
              </p>
            </div>
            {isConnected && (
              <div className="p-3  rounded-lg text-center">
                <p className="text-xs text-muted">Your Daily Yield</p>
                <p className="text-lg font-bold text-foreground">
                  ${userDailyYield.toFixed(4)}
                </p>
              </div>
            )}
          </>
        )}

        {isLobby && (
          <div className="p-3  rounded-lg text-center">
            <p className="text-xs text-muted">Projected Daily Yield</p>
            <p className="text-lg font-bold">${globalDailyYield.toFixed(2)}</p>
          </div>
        )}

        {!isConnected && !isLobby && (
          <div className="p-3  rounded-lg text-center">
            <p className="text-xs text-muted">Wallet</p>
            <p className="text-sm text-amber-600 dark:text-yellow-300">Not connected</p>
          </div>
        )}
      </div>
    </div>
  );
}
