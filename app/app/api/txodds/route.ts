import { NextResponse } from "next/server";

const API_BASE = "https://txline-dev.txodds.com";
const TRUSTED_BOOKMAKER_ID = 10021;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fetchAll = searchParams.get("all") === "1";
  const fetchPast = searchParams.get("past") === "1";
  const fetchYesterday = true;

  const headers = {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    "X-Api-Token": process.env.API_TOKEN || "",
  };

  const now = Date.now();
  const currentEpochDay = Math.floor(now / 86400000);

  try {
    let allFixtures: any[] = [];

    if (fetchYesterday) {
      const startEpochDay = currentEpochDay - 7;
      const url = `${API_BASE}/api/fixtures/snapshot?startEpochDay=${startEpochDay}`;
      const res = await fetch(url, { headers, cache: "no-store" });
      if (res.ok) {
        allFixtures = await res.json();
      }
    } else if (fetchPast) {
      const targetDays = [1, 2, 3, 4, 5].map(
        (offset) => currentEpochDay - offset
      );
      const fetchPromises = targetDays.map((epochDay) =>
        fetch(`${API_BASE}/api/fixtures/snapshot?startEpochDay=${epochDay}`, {
          headers,
          cache: "no-store",
        })
          .then((res) => (res.ok ? res.json() : []))
          .catch(() => [])
      );
      const snapshots = await Promise.all(fetchPromises);
      allFixtures = snapshots.flat();
    } else {
      const fixtureRes = await fetch(`${API_BASE}/api/fixtures/snapshot`, {
        headers,
        cache: "no-store",
      });
      allFixtures = await fixtureRes.json();
    }

    if (!Array.isArray(allFixtures))
      throw new Error("Invalid fixtures data received");

    const uniqueFixturesMap = new Map<number, any>();
    for (const f of allFixtures) {
      if (!f.FixtureId || !f.StartTime) continue;

      const startTime = Number(f.StartTime);
      if (startTime > now) {
        uniqueFixturesMap.set(f.FixtureId, f);
      }
    }

    const batchFixtures = Array.from(uniqueFixturesMap.values());
    batchFixtures.sort(
      (a: any, b: any) => Number(a.StartTime) - Number(b.StartTime)
    );

    const options: any[] = [];

    for (const f of batchFixtures) {
      const startTime = Number(f.StartTime);
      const oddsUrl = fetchYesterday
        ? `${API_BASE}/api/odds/snapshot/${f.FixtureId}?asOf=${startTime}`
        : `${API_BASE}/api/odds/snapshot/${f.FixtureId}`;

      const oddsRes = await fetch(oddsUrl, { headers, cache: "no-store" });
      const rawOddsData = await oddsRes.json();
      const oddsMarkets = Array.isArray(rawOddsData)
        ? rawOddsData
        : [rawOddsData];

      const seen = new Set<string>();

      for (const market of oddsMarkets) {
        if (market.BookmakerId !== TRUSTED_BOOKMAKER_ID) continue;
        const messageId: string = market.MessageId || "";
        const ts: number = market.Ts || 0;
        if (!market.PriceNames || !market.Prices) continue;

        const period = market.MarketPeriod ?? "ft";
        const isFirstHalf = period === "half=1";
        const isSecondHalf = period === "half=2"; // Adding explicit support for H2-only markets

        let periodLabel = "Full Time";
        let periodPrefix = 0; // Default to 0 for Full Time / Total

        if (isFirstHalf) {
          periodLabel = "1st Half";
          periodPrefix = 1000;
        } else if (isSecondHalf) {
          periodLabel = "2nd Half";
          periodPrefix = 3000;
        }

        for (let j = 0; j < market.PriceNames.length; j++) {
          const rawOdds = Number(market.Prices[j]);
          if (isNaN(rawOdds)) continue;

          const odds = rawOdds / 1000;
          const outcome = market.PriceNames[j];
          const parameters = market.MarketParameters ?? "";

          const key = `${market.SuperOddsType}|${outcome}|${parameters}|${period}`;
          if (seen.has(key)) continue;
          seen.add(key);

          options.push({
            id: `${f.FixtureId}-${market.SuperOddsType}-${parameters}-${outcome}-${period}`,
            messageId,
            ts,
            outcomeIndex: j,
            fixtureId: f.FixtureId,
            participant1: f.Participant1,
            participant2: f.Participant2,
            odds: Math.round(odds * 10) / 10,
            startTime: f.StartTime,
            marketType: market.SuperOddsType,
            outcome,
            period: periodPrefix,
            competition: f.Competition,
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
    }

    return NextResponse.json({ options });
  } catch (error: any) {
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
