"use client";

import React, { useState, useMemo } from "react";

interface MiniCalendarProps {
  fixtures: Array<{
    fixtureId: number;
    startTime: number;
  }>;
  liveScores: Record<
    number,
    {
      fixtureId: number;
      status: string;
    }
  >;
  selectedDate: string | null;
  setSelectedDate: (date: string | null) => void;
}

// Helper to get YYYY-MM-DD string in UTC
const getTodayUTCString = (): string => {
  return new Date().toISOString().slice(0, 10);
};

// Helper to add/subtract days in UTC
const addDaysUTC = (dateStr: string, days: number): string => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const formatUTCDate = (dateStr: string) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const monthStr = date.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const dayStr = date.toLocaleDateString("en-US", {
    day: "numeric",
    timeZone: "UTC",
  });
  return { month: monthStr, day: dayStr };
};

export default function MiniCalendar({
  fixtures,
  liveScores,
  selectedDate,
  setSelectedDate,
}: MiniCalendarProps) {
  const [viewStartDate, setViewStartDate] = useState(() => getTodayUTCString());

  // Generate 5 days starting from viewStartDate
  const visibleDates = useMemo(() => {
    if (!viewStartDate) return [];
    const dates = [];
    for (let i = 0; i < 5; i++) {
      dates.push(addDaysUTC(viewStartDate, i));
    }
    return dates;
  }, [viewStartDate]);

  // Navigate view start date back/forward by 1 day
  const handlePrev = () => {
    setViewStartDate((prev) => addDaysUTC(prev, -1));
  };

  const handleNext = () => {
    setViewStartDate((prev) => addDaysUTC(prev, 1));
  };

  // Helper to check if a specific date has any scheduled matches
  const checkAnyMatch = (dateStr: string) => {
    return fixtures.some((fixture) => {
      const fixtureDateStr = new Date(fixture.startTime)
        .toISOString()
        .slice(0, 10);
      return fixtureDateStr === dateStr;
    });
  };

  // Helper to check if a specific date has any LIVE matches
  const checkLiveMatch = (dateStr: string) => {
    return fixtures.some((fixture) => {
      const fixtureDateStr = new Date(fixture.startTime)
        .toISOString()
        .slice(0, 10);
      if (fixtureDateStr !== dateStr) return false;

      const matchStarted = fixture.startTime <= Date.now();
      const score = liveScores[fixture.fixtureId];
      const isLive = matchStarted && (!score || score.status !== "Finished");
      return isLive;
    });
  };

  const handleDateClick = (dateStr: string) => {
    if (selectedDate === dateStr) {
      // Toggle off if clicking the already selected date
      setSelectedDate(null);
    } else {
      setSelectedDate(dateStr);
    }
  };

  if (!viewStartDate) return null;

  return (
    <div className="backdrop-blur-sm border border-border-low rounded-2xl p-1 md:p-3 flex items-center justify-between select-none">
      {/* Prev Arrow */}
      <button
        onClick={handlePrev}
        className="p-1.5 md:p-3 text-muted hover:text-foreground hover:bg-foreground/5 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5 rounded-xl transition active:scale-95 flex items-center justify-center shrink-0"
        aria-label="Previous day"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>

      {/* 5-Day Strip */}
      <div className="flex flex-1 items-center justify-around gap-0.5 md:gap-1.5 px-1 md:px-2 min-w-0">
        {visibleDates.map((dateStr) => {
          const isSelected = selectedDate === dateStr;
          const { month, day } = formatUTCDate(dateStr);
          const isLive = checkLiveMatch(dateStr);
          const hasMatches = checkAnyMatch(dateStr);

          return (
            <button
              key={dateStr}
              onClick={() => handleDateClick(dateStr)}
              className={`flex flex-col items-center justify-center py-1.5 px-0.5 md:py-2 md:px-4 rounded-xl transition-all duration-200 cursor-pointer flex-1 min-w-0 max-w-[70px] ${
                isSelected
                  ? "bg-foreground/10 text-foreground shadow-md ring-1 ring-foreground/15 dark:bg-white/10 dark:text-white dark:ring-white/15"
                  : "text-muted hover:text-foreground hover:bg-foreground/5 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5"
              }`}
            >
              {/* Month */}
              <span className="text-[9px] md:text-[10px] uppercase tracking-wider font-bold opacity-75 mb-0.5 truncate w-full text-center">
                {month}
              </span>
              {/* Day Number */}
              <span className="text-lg md:text-xl font-bold font-sans leading-none">
                {day}
              </span>
              {/* Indicators */}
              <div className="flex items-center justify-center gap-1 mt-1.5 h-1.5">
                {isLive ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-pulse shadow-[0_0_8px_rgba(0,0,0,0.3)] dark:shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                ) : hasMatches ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600" />
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {/* Next Arrow */}
      <button
        onClick={handleNext}
        className="p-1.5 md:p-3 text-muted hover:text-foreground hover:bg-foreground/5 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5 rounded-xl transition active:scale-95 flex items-center justify-center shrink-0"
        aria-label="Next day"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
