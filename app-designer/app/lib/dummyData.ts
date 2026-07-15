// ---------- DUMMY DATA MODULE ----------
export const MAX_WEEKLY_BETS = 5;
export const WEEKLY_YIELD_RATE = 0.05 / 52;
export const GLOBAL_TVL = 1_250_000;

export interface Option {
  id: string;
  fixtureId: number;
  participant1: string;
  participant2: string;
  odds: number;
  startTime: number;
  label: string;
  // Present when sourced from the real /api/txodds feed; used to resolve
  // this option to its on-chain bet_terms slot index for voting.
  messageId?: string;
  ts?: number;
  outcomeIndex?: number;
  marketType?: string;
  outcome?: string;
  period?: number;
}

export interface Fixture {
  fixtureId: number;
  participant1: string;
  participant2: string;
  startTime: number;
  options: Option[];
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function generateSimulatedVotes(fixtures: Fixture[], batchStart: number) {
  const votes: Record<string, number> = {};
  fixtures.forEach((fixture) => {
    fixture.options.forEach((opt) => {
      const seed = batchStart + fixture.fixtureId * 31 + opt.id.length * 7;
      votes[opt.id] = Math.floor(seededRandom(seed) * 500) + 50;
    });
    const skipId = `${fixture.fixtureId}-skip`;
    votes[skipId] =
      Math.floor(seededRandom(batchStart + fixture.fixtureId * 17 + 13) * 400) +
      20;
  });
  return votes;
}

function computeMatchDecisions(
  fixtures: Fixture[],
  simulatedVotes: Record<string, number>,
  batchStart: number
) {
  const now = Date.now();
  const decisions: Record<number, any> = {};
  const sorted = [...fixtures].sort((a, b) => a.startTime - b.startTime);
  let betsUsed = 0;

  for (const fixture of sorted) {
    if (fixture.startTime > now) break;

    const skipId = `${fixture.fixtureId}-skip`;
    let maxVotes = simulatedVotes[skipId] || 0;
    let winnerId: string | null = skipId;

    fixture.options.forEach((opt) => {
      const v = simulatedVotes[opt.id] || 0;
      if (v > maxVotes) {
        maxVotes = v;
        winnerId = opt.id;
      }
    });

    const isSkip = winnerId === skipId;
    const isBet = !isSkip && betsUsed < MAX_WEEKLY_BETS;
    if (!isSkip && isBet) betsUsed++;

    // Simulate won/lost for accepted bets (deterministic)
    const won = isBet
      ? seededRandom(batchStart + fixture.fixtureId * 7 + betsUsed) > 0.5
      : false;

    decisions[fixture.fixtureId] = {
      winnerOptionId: winnerId,
      isSkip,
      isBet,
      accepted: isBet,
      won,
    };
  }

  return decisions;
}

const dummyBatchRecord = { wins: 2, losses: 1, pending: 2 };

export function useDummyData(fixtures: Fixture[], batchStart: number | null) {
  if (!batchStart) {
    return {
      simulatedVotes: {} as Record<string, number>,
      matchDecisions: {} as Record<number, any>,
      protocolStats: {
        globalTVL: GLOBAL_TVL,
        weeklyYieldRate: WEEKLY_YIELD_RATE,
        weeklyYieldPool: GLOBAL_TVL * WEEKLY_YIELD_RATE,
        maxWeeklyBets: MAX_WEEKLY_BETS,
      },
      batchRecord: dummyBatchRecord,
    };
  }

  const simulatedVotes = generateSimulatedVotes(fixtures, batchStart);
  const matchDecisions = computeMatchDecisions(
    fixtures,
    simulatedVotes,
    batchStart
  );

  return {
    simulatedVotes,
    matchDecisions,
    protocolStats: {
      globalTVL: GLOBAL_TVL,
      weeklyYieldRate: WEEKLY_YIELD_RATE,
      weeklyYieldPool: GLOBAL_TVL * WEEKLY_YIELD_RATE,
      maxWeeklyBets: MAX_WEEKLY_BETS,
    },
    batchRecord: dummyBatchRecord,
  };
}
