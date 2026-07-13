"use client";

import React, { useState, useEffect, useMemo } from "react";

export interface Option {
  id: string;
  fixtureId: number;
  participant1: string;
  participant2: string;
  odds: number;
  startTime: number;
  label: string;
}

export interface Fixture {
  fixtureId: number;
  participant1: string;
  participant2: string;
  startTime: number;
  options: Option[];
}

interface MatchDecision {
  winnerOptionId: string | null;
  isSkip: boolean;
  accepted: boolean;
  won: boolean;
}

interface ScoreInfo {
  fixtureId: number;
  status: string;
  participant1: string;
  participant2: string;
  p1Goals: number;
  p2Goals: number;
}

interface ConsensusVotingProps {
  isLoading: boolean;
  fixtures: Fixture[];
  userVotes: Record<number, string>;
  setUserVotes: (votes: Record<number, string>) => void;
  simulatedVotes: Record<string, number>;
  matchDecisions: Record<number, MatchDecision>;
  remainingBets: number;
  weeklyYieldPool: number;
  batchWeek?: string;
  activeFixtureId: number | null;
  onSkip: (fixtureId: number) => void;
}

const MAX_WEEKLY_BETS = 5;
const TOP_PER_MATCH = 3;

function formatStartTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function formatVotingDeadline(startTimeMs: number, nowMs: number): string {
  const diff = startTimeMs - nowMs;
  if (diff <= 0) return "Voting closed";
  const totalMinutes = Math.floor(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `Voting ends in ${hours}h ${minutes}m`;
  return `Voting ends in ${minutes}m`;
}

function confidenceLabel(ratio: number): { text: string; color: string } {
  if (ratio >= 0.7) return { text: "Very High", color: "text-emerald-400" };
  if (ratio >= 0.5) return { text: "High", color: "text-green-400" };
  if (ratio >= 0.3) return { text: "Medium", color: "text-yellow-400" };
  return { text: "Low", color: "text-red-400" };
}

export default function ConsensusVoting({
  isLoading,
  fixtures,
  userVotes,
  setUserVotes,
  simulatedVotes,
  matchDecisions,
  remainingBets,
  weeklyYieldPool,
  batchWeek = "Current Week",
  activeFixtureId,
  onSkip,
}: ConsensusVotingProps) {
  const [now, setNow] = useState(Date.now());
  const [expandedFixtureIds, setExpandedFixtureIds] = useState<Set<number>>(new Set());
  const [liveScores, setLiveScores] = useState<Record<number, ScoreInfo>>({});

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (fixtures.length === 0) return;
    const fixtureIds = fixtures.map(f => f.fixtureId).join(',');
    const fetchScores = async () => {
      try {
        const res = await fetch(`/api/scores?fixtureIds=${fixtureIds}`);
        const data = await res.json();
        const map: Record<number, ScoreInfo> = {};
        (data.scores || []).forEach((s: ScoreInfo) => { map[s.fixtureId] = s; });
        setLiveScores(map);
      } catch {}
    };
    fetchScores();
    const interval = setInterval(fetchScores, 30000);
    return () => clearInterval(interval);
  }, [fixtures]);

  const acceptedBetsCount = useMemo(
    () => Object.values(matchDecisions).filter(d => d.accepted).length,
    [matchDecisions]
  );
  const skippedMatchesCount = useMemo(
    () => Object.values(matchDecisions).filter(d => d.isSkip).length,
    [matchDecisions]
  );
  const remainingCapacity = MAX_WEEKLY_BETS - acceptedBetsCount;
  const allocatedBudget = (acceptedBetsCount / MAX_WEEKLY_BETS) * weeklyYieldPool;
  const remainingBudget = weeklyYieldPool - allocatedBudget;
  const perBetAllocation = acceptedBetsCount > 0 ? allocatedBudget / acceptedBetsCount : 0;

  const displayFixtures = useMemo(
    () =>
      fixtures.map(f => ({
        ...f,
        options: [...f.options].sort((a, b) => b.odds - a.odds).slice(0, TOP_PER_MATCH),
      })),
    [fixtures]
  );

  const handleVote = (fixtureId: number, optionId: string) => {
    if (fixtureId !== activeFixtureId) return;
    const fixture = fixtures.find(f => f.fixtureId === fixtureId);
    if (fixture && fixture.startTime <= Date.now()) return;
    setUserVotes({ ...userVotes, [fixtureId]: optionId });
  };

  const toggleExpanded = (fixtureId: number) => {
    setExpandedFixtureIds(prev => {
      const next = new Set(prev);
      next.has(fixtureId) ? next.delete(fixtureId) : next.add(fixtureId);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 bg-bg2 rounded-xl border border-border-low animate-pulse">
        <div className="h-5 w-32 bg-gray-700 rounded mb-4" />
        {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-800 rounded mb-3" />)}
      </div>
    );
  }

  if (!fixtures.length) {
    return (
      <div className="p-6 bg-bg2 rounded-xl border border-border-low text-center">
        <h2 className="text-lg font-bold mb-2">No upcoming voting opportunities</h2>
        <p className="text-gray-400">The syndicate is waiting for the next TXODDS fixture batch.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{batchWeek} Consensus Batch</h2>
        <p className="text-sm text-gray-400 mt-1">
          The community decides how the weekly treasury is allocated. {remainingBets} prediction{remainingBets !== 1 ? 's' : ''} remaining.
        </p>

        <div className="mt-4 p-4 bg-bg2 rounded-xl border border-border-low space-y-3">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Accepted Predictions</span>
            <span className="font-mono">{acceptedBetsCount} / {MAX_WEEKLY_BETS}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-emerald-400 h-2 rounded-full transition-all"
              style={{ width: `${(acceptedBetsCount / MAX_WEEKLY_BETS) * 100}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
            <span>Skipped: {skippedMatchesCount}</span>
            <span>Remaining: {remainingCapacity} prediction{remainingCapacity !== 1 ? 's' : ''}</span>
            <span>Status: {acceptedBetsCount === MAX_WEEKLY_BETS ? 'Full' : 'Active'}</span>
          </div>

          <div className="mt-2">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Weekly Treasury Budget</span>
              <span className="font-mono">${weeklyYieldPool.toLocaleString()}</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-400 h-2 rounded-full"
                style={{ width: `${(allocatedBudget / weeklyYieldPool) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Allocated: ${allocatedBudget.toFixed(0)}</span>
              <span>Remaining: ${remainingBudget.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      {remainingBets === 0 && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-300">
          Weekly prediction budget exhausted. Remaining fixtures are automatically skipped.
        </div>
      )}

      {displayFixtures.map(fixture => {
        const matchStarted = fixture.startTime <= now;
        const isActive = fixture.fixtureId === activeFixtureId;
        const isVotingClosed = matchStarted;
        const decision = matchDecisions[fixture.fixtureId];
        const userVoteForMatch = userVotes[fixture.fixtureId];
        const isExpanded = expandedFixtureIds.has(fixture.fixtureId);
        const score = liveScores[fixture.fixtureId];

        const skipId = `${fixture.fixtureId}-skip`;
        const skipVotes = simulatedVotes[skipId] || 0;
        const totalVotes =
          fixture.options.reduce((sum, opt) => sum + (simulatedVotes[opt.id] || 0), 0) + skipVotes;

        let leaderId: string | null = null;
        let maxVotes = -1;
        if (!isVotingClosed && isActive) {
          fixture.options.forEach(opt => {
            const v = simulatedVotes[opt.id] || 0;
            if (v > maxVotes) { maxVotes = v; leaderId = opt.id; }
          });
          if (skipVotes > maxVotes) { leaderId = skipId; maxVotes = skipVotes; }
        }

        let communityDecisionText = "";
        let communityDecisionOdds = 0;
        let winningOptionForCalc: Option | undefined;
        if (decision) {
          if (decision.isSkip) communityDecisionText = "Skip";
          else {
            winningOptionForCalc = fixture.options.find(o => o.id === decision.winnerOptionId);
            if (winningOptionForCalc) {
              communityDecisionText = winningOptionForCalc.label;
              communityDecisionOdds = winningOptionForCalc.odds;
            }
          }
        }

        const votingDeadlineText = formatVotingDeadline(fixture.startTime, now);
        const leadingRatio = totalVotes > 0 ? (maxVotes / totalVotes) : 0;
        const confidence = confidenceLabel(leadingRatio);

        let settlementStage = "Voting Open";
        if (isVotingClosed && !decision) settlementStage = "Consensus Locked";
        else if (decision && !score) settlementStage = "Awaiting Result";
        else if (score && score.status !== "Finished") settlementStage = "Match Live";
        else if (score && score.status === "Finished") settlementStage = "Settled";

        const stateBadge = !matchStarted ? (isActive ? "Vote Now" : "Upcoming") :
                           score && score.status === "Finished" ? "Finished" :
                           "Live";

        let treasuryChange = 0;
        let outcomeText = "";
        if (decision && decision.accepted && settlementStage === "Settled" && winningOptionForCalc) {
          const won = decision.won ?? false;
          if (won) {
            treasuryChange = perBetAllocation * (winningOptionForCalc.odds - 1);
            outcomeText = "Prediction Won";
          } else {
            treasuryChange = -perBetAllocation;
            outcomeText = "Prediction Lost";
          }
        }

        const userVotedInMatch = !!userVoteForMatch;
        const userAlignedWithLeader = userVotedInMatch && userVoteForMatch === leaderId;
        const userAlignedWithConsensus = decision && userVoteForMatch === decision.winnerOptionId;

        return (
          <div
            key={fixture.fixtureId}
            className={`bg-bg2 rounded-xl border transition-colors ${
              userVoteForMatch && !isVotingClosed ? "border-emerald-400 ring-1 ring-emerald-400/20" : "border-border-low"
            }`}
          >
            <button
              onClick={() => toggleExpanded(fixture.fixtureId)}
              className={`w-full px-5 py-4 flex items-center justify-between text-left group hover:bg-white/5 transition-colors rounded-xl ${
                isExpanded ? "rounded-b-none" : ""
              }`}
            >
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-semibold">{fixture.participant1} vs {fixture.participant2}</h3>
                  <div className="flex items-center gap-2 ml-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      stateBadge === "Vote Now" ? "bg-emerald-500/20 text-emerald-300 animate-pulse" :
                      stateBadge === "Live" ? "bg-green-900 text-green-300 animate-pulse" :
                      stateBadge === "Finished" ? "bg-gray-700 text-gray-300" :
                      "bg-gray-800 text-gray-400"
                    }`}>{stateBadge}</span>
                    {isVotingClosed ? null : userVoteForMatch ? (
                      <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-medium">Voted</span>
                    ) : null}
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  {formatStartTime(fixture.startTime)}
                  <span className="mx-1">·</span>
                  <span className={`font-medium ${isVotingClosed ? "text-red-400" : "text-emerald-300"}`}>{votingDeadlineText}</span>
                </p>
                {score && matchStarted && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded ${
                      score.status === "Finished" ? "bg-gray-700 text-gray-300" : "bg-green-900 text-green-300 animate-pulse"
                    }`}>{score.status}</span>
                    <span className="font-mono text-white">{score.p1Goals} - {score.p2Goals}</span>
                    <span className="text-gray-500">Live via TXODDS</span>
                  </div>
                )}
              </div>
              <svg className={`w-5 h-5 text-gray-400 transform transition-transform duration-200 ml-3 ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}`}>
              <div className="px-5 pb-5 space-y-4">
                {!isActive && !decision && (
                  <div className="p-2 bg-bg1 rounded-lg text-center text-xs text-gray-400">
                    Voting opens after the current match is settled.
                  </div>
                )}

                {decision && (
                  <div className="p-3 bg-bg1 rounded-lg">
                    <p className="text-xs text-gray-400">Community Decision</p>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-sm font-medium text-white">✓ {communityDecisionText}</span>
                      {!decision.isSkip && <span className="text-sm font-bold text-emerald-300">{communityDecisionOdds.toFixed(1)}x</span>}
                    </div>
                    {decision.accepted && (
                      <p className="text-xs text-emerald-400 mt-1">Protocol bet placed</p>
                    )}
                    {!decision.isSkip && !decision.accepted && (
                      <p className="text-xs text-yellow-400 mt-1">No allocation — budget full</p>
                    )}
                    {settlementStage === "Settled" && decision.accepted && (
                      <div className="mt-2 pt-2 border-t border-border-low">
                        <div className="flex justify-between text-xs">
                          <span className={`${decision.won ? "text-emerald-300" : "text-red-400"}`}>{outcomeText}</span>
                          <span className="font-mono">{treasuryChange >= 0 ? "+" : ""}${treasuryChange.toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Principal always protected</p>
                      </div>
                    )}
                  </div>
                )}

                {isActive && !isVotingClosed && !decision && (
                  <div className="text-xs text-gray-400">
                    {userVotedInMatch && (userAlignedWithLeader ? (
                      <span className="text-emerald-300">✓ You're aligned with the current consensus.</span>
                    ) : (
                      <span>Community currently favors another prediction.</span>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  {fixture.options.map(opt => {
                    const disabled = !isActive || isVotingClosed || (remainingBets === 0 && !isVotingClosed);
                    const isSelected = userVoteForMatch === opt.id;
                    const voteCount = simulatedVotes[opt.id] || 0;
                    const percentage = totalVotes > 0 ? (voteCount / totalVotes) * 100 : 0;
                    const isLeading = isActive && !isVotingClosed && leaderId === opt.id;
                    const isCommunityWinner = decision && decision.winnerOptionId === opt.id && !decision.isSkip;

                    const glowClass = isLeading ? "shadow-[0_0_12px_rgba(52,211,153,0.4)] border-emerald-400/50" : "";
                    const barColor = isLeading ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-emerald-600/60";

                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleVote(fixture.fixtureId, opt.id)}
                        disabled={disabled}
                        className={`w-full text-left p-3 rounded-lg border transition ${glowClass} ${
                          disabled && !isVotingClosed ? "border-gray-800 bg-gray-900/50 cursor-not-allowed opacity-70" :
                          isSelected ? "border-emerald-400 bg-emerald-500/10" :
                          "border-border-low bg-bg1 hover:border-gray-500"
                        }`}
                      >
                        <div className="flex justify-between items-center gap-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{opt.label}</span>
                            {isLeading && <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full font-semibold shadow-[0_0_6px_rgba(52,211,153,0.3)]">Leading</span>}
                            {isCommunityWinner && <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full font-semibold">Winner</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">{percentage.toFixed(0)}%</span>
                            <span className="text-xs text-gray-500">{voteCount}</span>
                            <span className="text-lg font-bold text-emerald-300 whitespace-nowrap">{opt.odds.toFixed(1)}x</span>
                          </div>
                        </div>
                        <div className="mt-2 w-full bg-gray-700 rounded-full h-1">
                          <div className={`h-1 rounded-full ${barColor}`} style={{ width: `${percentage}%` }} />
                        </div>
                      </button>
                    );
                  })}

                  {isActive && !isVotingClosed && (
                    <button
                      onClick={() => onSkip(fixture.fixtureId)}
                      disabled={isVotingClosed}
                      className={`w-full text-left p-3 rounded-lg border transition ${
                        isVotingClosed ? "border-gray-800 bg-gray-900/50 cursor-not-allowed opacity-70" :
                        userVoteForMatch === skipId ? "border-emerald-400 bg-emerald-500/10" :
                        "border-border-low bg-bg1 hover:border-gray-500"
                      } ${!isVotingClosed && leaderId === skipId ? "shadow-[0_0_12px_rgba(52,211,153,0.4)] border-emerald-400/50" : ""}`}
                    >
                      <div className="flex justify-between items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-300">Skip this match</span>
                          {!isVotingClosed && leaderId === skipId && <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full font-semibold shadow-[0_0_6px_rgba(52,211,153,0.3)]">Leading</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">{totalVotes > 0 ? ((skipVotes / totalVotes) * 100).toFixed(0) + "%" : "0%"}</span>
                          <span className="text-xs text-gray-500">{skipVotes}</span>
                          <span className="text-sm text-gray-400">—</span>
                        </div>
                      </div>
                      <div className="mt-2 w-full bg-gray-700 rounded-full h-1">
                        <div className={`h-1 rounded-full ${leaderId === skipId ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-emerald-600/60"}`} style={{ width: `${totalVotes > 0 ? (skipVotes / totalVotes) * 100 : 0}%` }} />
                      </div>
                    </button>
                  )}
                </div>

                {totalVotes > 0 && isActive && !isVotingClosed && (
                  <div className="flex items-center justify-between text-xs text-gray-500 mt-2">
                    <span>{totalVotes} participants voted</span>
                    <span>Confidence: <span className={confidence.color}>{confidence.text}</span></span>
                  </div>
                )}

                <div className="flex items-center gap-1 text-xs text-gray-600 mt-2">
                  <span className={settlementStage === "Voting Open" ? "text-white" : ""}>Voting Open</span>
                  <span className="mx-1">→</span>
                  <span className={settlementStage === "Consensus Locked" ? "text-white" : ""}>Locked</span>
                  <span className="mx-1">→</span>
                  <span className={settlementStage === "Awaiting Result" || settlementStage === "Match Live" ? "text-white" : ""}>Live</span>
                  <span className="mx-1">→</span>
                  <span className={settlementStage === "Settled" ? "text-white" : ""}>Settled</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}