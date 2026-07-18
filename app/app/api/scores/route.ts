import { NextResponse } from "next/server";

const API_BASE = "https://txline-dev.txodds.com";

// The snapshot array isn't chronological — it's grouped by event Action name,
// not by time — so "the last entry" is essentially a random event, not the
// latest one. Seq is the real ordering key.
function sortByTime(entries: any[]): any[] {
  return [...entries].sort((a, b) => (a.Seq ?? 0) - (b.Seq ?? 0));
}

// Mirrors /api/scores/validation's hasMatchState pattern: derive status from
// specific event Actions actually present in the snapshot, rather than
// trusting a single field on a single entry (the previous version read
// `statusSoccerId`, which doesn't exist anywhere in this API's response).
function deriveStatus(sorted: any[]): string {
  const hasAction = (name: string) => sorted.some((e) => e.Action === name);

  if (hasAction("game_finalised")) return "Finished";

  const htIndex = sorted.findIndex((e) => e.Action === "halftime_finalised");
  if (htIndex !== -1) {
    const secondHalfStarted = sorted
      .slice(htIndex + 1)
      .some((e) => e.Action === "kickoff");
    if (!secondHalfStarted) return "Half Time";
  }

  if (hasAction("kickoff") || hasAction("kickoff_team")) return "In Play";

  return "Not Started";
}

// The real field is `Score` (capital), not `scoreSoccer` — pulled from the
// chronologically-latest entry (by Seq) that actually carries one, since
// most event types don't include a Score snapshot at all.
function extractGoals(sorted: any[]): { p1: number; p2: number } | null {
  for (let i = sorted.length - 1; i >= 0; i--) {
    const score = sorted[i].Score;
    const p1 = score?.Participant1?.Total?.Goals;
    const p2 = score?.Participant2?.Total?.Goals;
    if (typeof p1 === "number" && typeof p2 === "number") {
      return { p1, p2 };
    }
  }
  return null;
}

// Elapsed match time can only increase — but the raw feed can carry a
// stray clock_adjustment (or similar) event with a bogus reset value even
// after later Seq numbers already showed a much higher one, so trusting
// "whichever Clock-bearing entry has the highest Seq" isn't safe. Take the
// highest Seconds actually observed instead.
function extractClock(
  sorted: any[]
): { seconds: number; running: boolean } | null {
  let best: { seconds: number; running: boolean } | null = null;
  for (const entry of sorted) {
    const clock = entry.Clock;
    if (
      clock &&
      typeof clock.Seconds === "number" &&
      (best === null || clock.Seconds >= best.seconds)
    ) {
      best = { seconds: clock.Seconds, running: Boolean(clock.Running) };
    }
  }
  return best;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureIdsParam = searchParams.get("fixtureIds");

  if (!fixtureIdsParam) {
    return NextResponse.json({ scores: [] });
  }

  const fixtureIds = fixtureIdsParam.split(",").map(Number).filter(Boolean);

  const headers = {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    "X-Api-Token": process.env.API_TOKEN || "",
  };

  try {
    const scoresMap: Record<number, any> = {};

    await Promise.all(
      fixtureIds.map(async (fixtureId) => {
        try {
          const url = `${API_BASE}/api/scores/snapshot/${fixtureId}`;
          const scoreRes = await fetch(url, {
            headers,
            cache: "no-store",
          });
          const scoreData = await scoreRes.json();

          if (!Array.isArray(scoreData) || scoreData.length === 0) return;

          const sorted = sortByTime(scoreData);
          const status = deriveStatus(sorted);
          const goals = extractGoals(sorted);
          const clock = extractClock(sorted);

          scoresMap[fixtureId] = {
            fixtureId,
            status,
            p1Goals: goals?.p1 ?? 0,
            p2Goals: goals?.p2 ?? 0,
            clockSeconds: clock?.seconds ?? null,
            clockRunning: clock?.running ?? false,
          };
        } catch (e) {
          // skip fixture on error
        }
      })
    );

    return NextResponse.json({ scores: Object.values(scoresMap) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
