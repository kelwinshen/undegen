"use client";

import React from "react";

interface SyndicateSidebarProps {
  isLoading: boolean;
  weeklyYieldPool: number;
  allocatedBudget: number;
  remainingBudget: number;
  acceptedBetsCount: number;
  skippedMatchesCount: number;
  remainingBets: number;
  userPoolShare: number;
  userWeeklyYield: number;
  userLockedAmount: number;
  isConnected: boolean;
  phase: string;
  batchRecord?: { wins: number; losses: number; pending: number };
}

export default function SyndicateSidebar({
  isLoading,
  weeklyYieldPool,
  allocatedBudget,
  remainingBudget,
  acceptedBetsCount,
  skippedMatchesCount,
  remainingBets,
  userPoolShare,
  userWeeklyYield,
  userLockedAmount,
  isConnected,
  phase,
  batchRecord = { wins: 0, losses: 0, pending: 0 },
}: SyndicateSidebarProps) {
  const isLobby = phase === "Lobby";
  const yourPotentialReward = userPoolShare * weeklyYieldPool;

  if (isLobby) {
    return (
      <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-5">
        <div className="p-2 bg-bg1 rounded-lg text-xs text-gray-500">
          <span className="text-emerald-400">✓ Verified by TXODDS Oracle</span>
          <br />
          <span className="text-gray-600">
            Settlement verified using on-chain cryptographic proofs.
          </span>
        </div>
        {!isConnected && (
          <p className="text-xs text-yellow-300">Connect wallet to participate in the syndicate.</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 bg-bg2 rounded-xl border border-border-low space-y-5">
      <h2 className="text-lg font-bold">Treasury Dashboard</h2>

      <div className="p-3 bg-bg1 rounded-lg space-y-2">
        <p className="text-xs text-gray-400">Weekly Treasury Budget</p>
        <p className="text-2xl font-bold text-emerald-400">
          ${weeklyYieldPool.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </p>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className="bg-blue-400 h-2 rounded-full"
            style={{ width: `${(allocatedBudget / weeklyYieldPool) * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>Allocated: ${allocatedBudget.toFixed(0)}</span>
          <span>Remaining: ${remainingBudget.toFixed(0)}</span>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Accepted Predictions</span>
          <span className="font-mono">{acceptedBetsCount} / 5</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Skipped Matches</span>
          <span className="font-mono">{skippedMatchesCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Remaining Capacity</span>
          <span className="font-mono">{remainingBets} prediction{remainingBets !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {isConnected && (
        <div className="p-3 bg-bg1 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Your Pool Share</span>
            <span className="font-mono">{(userPoolShare * 100).toFixed(4)}%</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Your Weekly Yield</span>
            <span className="font-mono">${userWeeklyYield.toFixed(4)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Expected Reward</span>
            <span className="font-mono">${yourPotentialReward.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Locked Principal</span>
            <span className="font-mono">${userLockedAmount.toFixed(0)}</span>
          </div>
        </div>
      )}

      <div className="p-3 bg-bg1 rounded-lg space-y-2">
        <p className="text-xs text-gray-400">Current Batch Record</p>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Wins</span>
          <span className="text-emerald-300 font-mono">{batchRecord.wins}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Losses</span>
          <span className="text-red-400 font-mono">{batchRecord.losses}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Pending</span>
          <span className="text-yellow-400 font-mono">{batchRecord.pending}</span>
        </div>
      </div>

      <div className="p-2 bg-bg1 rounded-lg text-xs text-gray-500">
        <span className="text-emerald-400">✓ Verified by TXODDS Oracle</span>
        <br />
        <span className="text-gray-600">
          Settlement verified using on-chain cryptographic proofs.
        </span>
      </div>

      {!isConnected && (
        <p className="text-xs text-yellow-300">Connect wallet to participate in the syndicate.</p>
      )}
    </div>
  );
}