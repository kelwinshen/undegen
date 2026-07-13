"use client";

import { useEffect, useState } from "react";

interface BatchTimerProps {
  remainingBets?: number;
  phase?: string;
}

export default function BatchTimer({ remainingBets, phase = "Active" }: BatchTimerProps) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
      const nextMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
      const diff = nextMonday.getTime() - now.getTime();
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const label = phase === "Lobby" ? "Batch starts in" : "Batch ends in";

  return (
    <div className="bg-bg2 border border-border-low rounded-xl p-4 text-center">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-2xl font-bold font-mono">{timeLeft}</p>
      <p className="text-xs text-gray-500 mt-1">
        {remainingBets !== undefined
          ? `${remainingBets} prediction${remainingBets !== 1 ? "s" : ""} left this week`
          : "New batch resets then"}
      </p>
    </div>
  );
}