"use client";

import { useState, useEffect } from "react";

interface LobbyPhaseProps {
  batchId: number;
  batchStartTime: number;
  userDeposited: number;
  totalDeposited: number;
  participantCount: number;
  minimumDeposit: number;
  projectedDailyYield: number;
  onDeposit: (amount: number) => Promise<void>;
  onWithdraw: () => Promise<void>;
}

export default function LobbyPhase({
  batchId,
  batchStartTime,
  userDeposited,
  totalDeposited,
  participantCount,
  minimumDeposit,
  projectedDailyYield,
  onDeposit,
  onWithdraw,
}: LobbyPhaseProps) {
  const [depositAmount, setDepositAmount] = useState("");
  const [timeLeft, setTimeLeft] = useState("");
  const [batchStarted, setBatchStarted] = useState(false);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const diff = batchStartTime - now;
      if (diff <= 0) {
        setTimeLeft("Batch has started");
        setBatchStarted(true);
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
  }, [batchStartTime]);

  const handleDeposit = async () => {
    if (batchStarted) return;
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount < minimumDeposit) return;
    await onDeposit(amount);
    setDepositAmount("");
  };

  return (
    <div className="bg-bg2 rounded-xl border border-border-low p-6 space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold">Batch {batchId} · Lobby</h2>
        <p className="text-sm text-gray-400 mt-1">
          {batchStarted
            ? "This batch has already started. Deposits are no longer accepted."
            : "Deposit to join the syndicate before the batch starts."}
        </p>
        <p className="text-sm text-gray-400 mt-1">Batch starts in</p>
        <p className="text-3xl font-bold font-mono mt-1 text-emerald-300">
          {timeLeft}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-bg1 rounded-lg p-4 border border-border-low">
          <p className="text-xs text-gray-400 mb-1">Total Deposited</p>
          <p className="text-xl font-bold">${totalDeposited.toLocaleString()}</p>
        </div>
        <div className="bg-bg1 rounded-lg p-4 border border-border-low">
          <p className="text-xs text-gray-400 mb-1">Participants</p>
          <p className="text-xl font-bold">{participantCount}</p>
        </div>
        <div className="bg-bg1 rounded-lg p-4 border border-border-low">
          <p className="text-xs text-gray-400 mb-1">Projected Daily Yield</p>
          <p className="text-xl font-bold">${projectedDailyYield.toFixed(2)}</p>
        </div>
        <div className="bg-bg1 rounded-lg p-4 border border-border-low">
          <p className="text-xs text-gray-400 mb-1">Your Stake</p>
          <p className="text-xl font-bold text-emerald-300">${userDeposited.toFixed(2)}</p>
        </div>
        <div className="bg-bg1 rounded-lg p-4 border border-border-low col-span-2">
          <p className="text-xs text-gray-400 mb-1">Minimum Deposit</p>
          <p className="text-xl font-bold">${minimumDeposit}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            type="number"
            placeholder={`Min ${minimumDeposit} USDC`}
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            disabled={batchStarted}
            className="flex-1 bg-bg1 border border-border-low rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleDeposit}
            disabled={batchStarted}
            className="px-6 py-2 bg-emerald-500 text-black font-semibold rounded-lg hover:bg-emerald-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Deposit
          </button>
        </div>

        {userDeposited > 0 && (
          <button
            onClick={onWithdraw}
            disabled={batchStarted}
            className="w-full py-2 bg-red-500/20 text-red-400 font-semibold rounded-lg hover:bg-red-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Withdraw all
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500 text-center">
        {batchStarted
          ? "The batch is now locked and all funds are committed. You can monitor the active batch in the main dashboard."
          : "You can deposit or withdraw freely until the batch starts. Once started, all funds are committed and start earning yield for the week."}
      </p>
    </div>
  );
}