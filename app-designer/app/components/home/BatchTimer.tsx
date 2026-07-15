"use client";

import { useEffect, useState } from "react";

interface BatchTimerProps {
  remainingBets?: number;
  phase?: string;
  batchWeek?: string;
}

export default function BatchTimer({
  remainingBets,
  phase = "Active",
  batchWeek = "Active Batch (1)",
}: BatchTimerProps) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
      const nextMonday = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + daysUntilMonday
        )
      );
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

  const label =
    phase === "Lobby"
      ? "Batch starts in"
      : phase === "Ended"
        ? "Batch Status"
        : "Batch ends in";

  const displayTime = phase === "Ended" ? "Ended" : timeLeft;

  return (
    <div className="border border-border-low rounded-2xl backdrop-blur-sm p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-left font-sans">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-foreground">{batchWeek}</h2>
        <p className="text-sm text-muted">
          The community decides how the weekly treasury is allocated.{" "}
          {phase !== "Ended" && remainingBets !== undefined
            ? `${remainingBets} prediction${remainingBets !== 1 ? "s" : ""} remaining.`
            : ""}
        </p>
      </div>

      <div className="flex flex-col items-start md:items-end text-left md:text-right bg-foreground/5 backdrop-blur-sm border border-border-low dark:bg-white/0 dark:border-white/5 rounded-xl p-3 min-w-[250px]">
        <p className="text-xs text-muted uppercase tracking-wider font-semibold">
          {label}
        </p>
        <p className="text-2xl font-bold font-mono text-foreground mt-0.5">
          {displayTime}
        </p>
      </div>
    </div>
  );
}
