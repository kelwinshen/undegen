import { NextResponse } from 'next/server';

const API_BASE = 'https://txline.txodds.com';
const TRUSTED_BOOKMAKER_ID = 10021;

const dailyCache = new Map<string, any>();

function getUTCDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getBatchEndTime(): number {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
  const nextMonday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday)
  );
  return nextMonday.getTime();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fetchAll = searchParams.get('all') === '1';
  const fetchPast = searchParams.get('past') === '1';

  const headers = {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    'X-Api-Token': process.env.API_TOKEN || '',
  };

  const todayKey = getUTCDateString();

  if (!fetchAll && !fetchPast && dailyCache.has(todayKey)) {
    return NextResponse.json(dailyCache.get(todayKey));
  }

  try {
    const now = Date.now();
    let allFixtures: any[] = [];

    if (fetchPast) {
      // Aggressive Lookback: Fetch the last 5 days of snapshots in parallel
      const currentEpochDay = Math.floor(now / 86400000);
      const targetDays = [1, 2, 3, 4, 5].map((offset) => currentEpochDay - offset);

      const fetchPromises = targetDays.map((epochDay) =>
        fetch(`${API_BASE}/api/fixtures/snapshot/${epochDay}`, {
          headers,
          next: { revalidate: 3600 },
        })
          .then((res) => (res.ok ? res.json() : []))
          .catch(() => [])
      );

      const snapshots = await Promise.all(fetchPromises);
      allFixtures = snapshots.flat();
    } else {
      // Standard current snapshot fetch
      const fixtureRes = await fetch(`${API_BASE}/api/fixtures/snapshot`, {
        headers,
        next: { revalidate: 3600 },
      });
      allFixtures = await fixtureRes.json();
    }

    if (!Array.isArray(allFixtures)) throw new Error("Invalid fixtures data received");

    const batchEnd = getBatchEndTime();

    // Deduplicate fixtures by FixtureId since multiple day snapshots might overlap match entries
    const uniqueFixturesMap = new Map<number, any>();
    for (const f of allFixtures) {
      if (!f.FixtureId || !f.StartTime) continue;
      uniqueFixturesMap.set(f.FixtureId, f);
    }

    const batchFixtures = Array.from(uniqueFixturesMap.values()).filter((f: any) => {
      const start = Number(f.StartTime);
      
      if (fetchPast) {
        return start < now;
      }
      
      if (fetchAll) {
        return start >= now;
      }
      
      return start >= now && start < batchEnd;
    });

    // Sort: newest completed matches first when viewing past matches
    batchFixtures.sort((a: any, b: any) => {
      if (fetchPast) return Number(b.StartTime) - Number(a.StartTime);
      return Number(a.StartTime) - Number(b.StartTime);
    });

    const options: any[] = [];

    for (const f of batchFixtures) {
      const oddsRes = await fetch(
        `${API_BASE}/api/odds/snapshot/${f.FixtureId}`,
        { headers, next: { revalidate: 3600 } }
      );
      const rawOddsData = await oddsRes.json();
      const oddsMarkets = Array.isArray(rawOddsData) ? rawOddsData : [rawOddsData];

      const seen = new Set<string>();

      for (const market of oddsMarkets) {
        if (market.BookmakerId !== TRUSTED_BOOKMAKER_ID) continue;
        const messageId: string = market.MessageId || '';
        const ts: number = market.Ts || 0;
        if (!market.PriceNames || !market.Prices) continue;

        const period = market.MarketPeriod ?? 'ft';
        const isFirstHalf = period === 'half=1';
        const periodLabel = isFirstHalf ? '1st Half' : 'Full Time';

        for (let j = 0; j < market.PriceNames.length; j++) {
          const rawOdds = Number(market.Prices[j]);
          if (isNaN(rawOdds)) continue;

          const odds = rawOdds / 1000;
          const outcome = market.PriceNames[j];
          const parameters = market.MarketParameters ?? '';

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
            period: isFirstHalf ? 1 : 0,
            label: buildReadableLabel(
              f.Participant1,
              f.Participant2,
              market.SuperOddsType,
              outcome,
              parameters,
              periodLabel,
            ),
          });
        }
      }
    }

    const payload = { options };

    if (!fetchAll && !fetchPast) {
      dailyCache.clear();
      dailyCache.set(todayKey, payload);
    }

    return NextResponse.json(payload);
  } catch (error: any) {
    if (!fetchAll && !fetchPast && dailyCache.has(todayKey)) {
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
  period: string,
): string {
  const match = `${p1} vs ${p2}`;

  if (type === '1X2_PARTICIPANT_RESULT') {
    if (outcome === 'part1') return `${p1} to win (${period})`;
    if (outcome === 'part2') return `${p2} to win (${period})`;
    if (outcome === 'draw')   return `Draw – ${match} (${period})`;
  }
  if (type === 'ASIANHANDICAP_PARTICIPANT_GOALS') {
    const line = params.replace('line=', '');
    const team = outcome === 'part1' ? p1 : p2;
    return `${team} Asian Handicap ${line} (${period})`;
  }
  if (type === 'OVERUNDER_PARTICIPANT_GOALS') {
    const line = params.replace('line=', '');
    const side = outcome === 'over' ? 'Over' : 'Under';
    return `Total Goals ${side} ${line} – ${match} (${period})`;
  }
  return `${type.replace(/_/g, ' ')} ${outcome} – ${match} (${period})`;
}