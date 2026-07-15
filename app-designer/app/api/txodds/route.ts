import { NextResponse } from "next/server";

const API_BASE = "https://txline.txodds.com";
const TRUSTED_BOOKMAKER_ID = 10021;

const dailyCache = new Map<string, any>();

function getUTCDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns the timestamp for the start of the current week (Monday 00:00 UTC) */
function getBatchStartTime(): number {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  // Days since last Monday (if today is Monday, dayOfWeek=1 → 0 days)
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceMonday
    )
  );
  return monday.getTime();
}

/** Returns the timestamp for the next Monday 00:00 UTC (end of current batch) */
function getBatchEndTime(): number {
  const start = getBatchStartTime();
  return start + 7 * 24 * 60 * 60 * 1000; // +7 days
}

export async function GET() {
  const headers = {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    "X-Api-Token": process.env.API_TOKEN || "",
  };

  const todayKey = getUTCDateString();

  // Return today's cached snapshot if available
  if (dailyCache.has(todayKey)) {
    return NextResponse.json(dailyCache.get(todayKey));
  }

  try {
    const fixtureRes = await fetch(`${API_BASE}/api/fixtures/snapshot`, {
      headers,
      next: { revalidate: 3600 },
    });
    const allFixtures = await fixtureRes.json();
    if (!Array.isArray(allFixtures)) throw new Error("Invalid fixtures data");

    const now = Date.now();
    const batchStart = getBatchStartTime();
    const batchEnd = getBatchEndTime();

    // Only upcoming fixtures that belong to the current weekly batch (now → next Monday 00:00 UTC)
    const batchFixtures = allFixtures.filter((f: any) => {
      if (!f.StartTime) return false;
      const start = Number(f.StartTime);
      return start >= now && start < batchEnd;
    });

    // Sort chronologically
    batchFixtures.sort(
      (a: any, b: any) => Number(a.StartTime) - Number(b.StartTime)
    );

    // Fetch and process odds for all fixtures in parallel
    const fixturePromises = batchFixtures.map(async (f: any) => {
      const fixtureId = f.FixtureId;
      const oddsRes = await fetch(
        `${API_BASE}/api/odds/snapshot/${fixtureId}`,
        {
          headers,
          next: { revalidate: 3600 },
        }
      );
      const rawOddsData = await oddsRes.json();
      const oddsMarkets = Array.isArray(rawOddsData)
        ? rawOddsData
        : [rawOddsData];

      const options: any[] = [];
      const seen = new Set<string>();

      for (const market of oddsMarkets) {
        if (market.BookmakerId !== TRUSTED_BOOKMAKER_ID) continue;
        if (!market.PriceNames || !market.Prices) continue;

        const messageId: string = market.MessageId || "";
        const ts: number = market.Ts || 0;
        const period = market.MarketPeriod ?? "ft";
        const isFirstHalf = period === "half=1";
        const periodLabel = isFirstHalf ? "1st Half" : "Full Time";

        for (let j = 0; j < market.PriceNames.length; j++) {
          const rawOdds = Number(market.Prices[j]);
          if (isNaN(rawOdds)) continue;

          const odds = rawOdds / 1000;
          const outcome = market.PriceNames[j];
          const parameters = market.MarketParameters ?? "";

          // Deduplication key
          const key = `${market.SuperOddsType}|${outcome}|${parameters}|${period}`;
          if (seen.has(key)) continue;
          seen.add(key);

          // Prefer TXODDS unique MessageId + outcome index for a truly unique option ID
          const uniqueId = market.MessageId
            ? `${market.MessageId}-${j}`
            : `${fixtureId}-${market.SuperOddsType}-${parameters}-${outcome}-${period}`;

          options.push({
            id: uniqueId,
            messageId,
            ts,
            outcomeIndex: j,
            fixtureId: fixtureId,
            participant1: f.Participant1,
            participant2: f.Participant2,
            odds: Math.round(odds * 10) / 10,
            startTime: f.StartTime,
            marketType: market.SuperOddsType,
            outcome,
            period: isFirstHalf ? 1 : 0,
            label: buildReadableLabel(
              f.Participant1,
              f.Participant2,
              market.SuperOddsType,
              outcome,
              parameters,
              periodLabel
            ),
          });
        }
      }

      return options; // will be flattened later
    });

    const nestedOptions = await Promise.all(fixturePromises);
    const options = nestedOptions.flat();

    const payload = {
      options,
      generatedAt: new Date().toISOString(),
      batchStart: new Date(batchStart).toISOString(),
      batchEnd: new Date(batchEnd).toISOString(),
    };

    // Replace cache with today's snapshot only
    dailyCache.clear();
    dailyCache.set(todayKey, payload);

    return NextResponse.json(payload);
  } catch (error: any) {
    if (dailyCache.has(todayKey)) {
      return NextResponse.json(dailyCache.get(todayKey));
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function buildReadableLabel(
  p1: string,
  p2: string,
  type: string,
  outcome: string,
  params: string,
  period: string
): string {
  const match = `${p1} vs ${p2}`;

  if (type === "1X2_PARTICIPANT_RESULT") {
    if (outcome === "part1") return `${p1} to win (${period})`;
    if (outcome === "part2") return `${p2} to win (${period})`;
    if (outcome === "draw") return `Draw – ${match} (${period})`;
  }
  if (type === "ASIANHANDICAP_PARTICIPANT_GOALS") {
    const line = params.replace("line=", "");
    const team = outcome === "part1" ? p1 : p2;
    return `${team} Asian Handicap ${line} (${period})`;
  }
  if (type === "OVERUNDER_PARTICIPANT_GOALS") {
    const line = params.replace("line=", "");
    const side = outcome === "over" ? "Over" : "Under";
    return `Total Goals ${side} ${line} – ${match} (${period})`;
  }
  return `${type.replace(/_/g, " ")} ${outcome} – ${match} (${period})`;
}
