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
    <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {isLobby ? "Join the Syndicate" : "Your Dashboard"}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Simulated principal:</span>
          <input
            type="number"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            className="w-24 bg-bg1 border border-border-low rounded-lg px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-emerald-400"
          />
          <span className="text-xs text-gray-400">USDC</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-3 bg-bg1 rounded-lg text-center">
          <p className="text-xs text-gray-400">Total Value Locked</p>
          <p className="text-lg font-bold">${globalTVL.toLocaleString()}</p>
        </div>

        {!isLobby && (
          <>
            <div className="p-3 bg-bg1 rounded-lg text-center">
              <p className="text-xs text-gray-400">Daily Yield Pool</p>
              <p className="text-lg font-bold">${globalDailyYield.toFixed(2)}</p>
            </div>
            {isConnected && (
              <div className="p-3 bg-bg1 rounded-lg text-center">
                <p className="text-xs text-gray-400">Your Daily Yield</p>
                <p className="text-lg font-bold text-emerald-300">${userDailyYield.toFixed(4)}</p>
              </div>
            )}
          </>
        )}

        {isLobby && (
          <div className="p-3 bg-bg1 rounded-lg text-center">
            <p className="text-xs text-gray-400">Projected Daily Yield</p>
            <p className="text-lg font-bold">${globalDailyYield.toFixed(2)}</p>
          </div>
        )}

        {!isConnected && !isLobby && (
          <div className="p-3 bg-bg1 rounded-lg text-center">
            <p className="text-xs text-gray-400">Wallet</p>
            <p className="text-sm text-yellow-300">Not connected</p>
          </div>
        )}
      </div>
    </div>
  );
}