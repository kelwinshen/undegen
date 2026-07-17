import { NextResponse } from 'next/server';

const API_BASE = 'https://txline-dev.txodds.com';
const TRUSTED_BOOKMAKER_ID = 10021;

// This route fans out into an odds/snapshot fetch per fixture on every call,
// and gets hit repeatedly — page polling, multiple components resolving the
// same batch's options independently, dev Fast Refresh re-running effects —
// with no caching at all. That's enough volume to trip TxOdds rate limits,
// which getFixtureCandidates (undegenProgram.ts) swallows into an empty
// array, silently degrading a real match into an unreadable "Fixture <id>"
// label. Cache each variant's response for a bit, and keep serving the last
// good payload on error instead of surfacing an empty result.
const CACHE_TTL_MS = 30_000;
type CacheEntry = { payload: { options: any[] }; expiresAt: number };
const cache = new Map<string, CacheEntry>();

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
  const cacheKey = `all=${fetchAll}&past=${fetchPast}`;

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload);
  }

  const headers = {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    'X-Api-Token': process.env.API_TOKEN || '',
  };

  try {
    const now = Date.now();
    let allFixtures: any[] = [];

    if (fetchPast) {
      // Aggressive Lookback: Fetch today's snapshot plus the last 5 days in
      // parallel. Offset 0 (today) matters most — a match that kicked off
      // earlier today is neither "upcoming" (all=1 excludes anything with
      // start < now) nor covered by yesterday-and-earlier snapshots, so
      // omitting it left just-started fixtures unresolvable to a live option
      // (falling back to the raw "Fixture <id>" label instead of team names).
      const currentEpochDay = Math.floor(now / 86400000);
      const targetDays = [0, 1, 2, 3, 4, 5,6,7].map((offset) => currentEpochDay - offset);

      const fetchPromises = targetDays.map((epochDay) =>
        fetch(`${API_BASE}/api/fixtures/snapshot/${epochDay}`, {
          headers,
          cache: 'no-store',
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
        cache: 'no-store',
      });
      if (!fixtureRes.ok) {
        throw new Error(`TxOdds fixtures request failed: ${fixtureRes.status} ${fixtureRes.statusText}`);
      }
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
      // The plain snapshot endpoint only holds CURRENT odds — once a match
      // has kicked off/finished, it returns [] for it. asOf=<fixture's own
      // StartTime> pulls the odds as they stood at that moment instead, which
      // is what actually lets already-started/past fixtures resolve to real
      // team names + odds rather than falling back to a bare "Fixture <id>".
      const isPastFixture = Number(f.StartTime) < now;
      const oddsUrl = isPastFixture
        ? `${API_BASE}/api/odds/snapshot/${f.FixtureId}?asOf=${f.StartTime}`
        : `${API_BASE}/api/odds/snapshot/${f.FixtureId}`;
      const oddsRes = await fetch(oddsUrl, { headers, cache: 'no-store' });
      if (!oddsRes.ok) {
        throw new Error(`TxOdds odds request failed for fixture ${f.FixtureId}: ${oddsRes.status} ${oddsRes.statusText}`);
      }
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
    cache.set(cacheKey, { payload, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json(payload);
  } catch (error: any) {
    // A rate limit or transient TxOdds failure shouldn't blank out data the
    // UI already had — serve the last good snapshot (even if past its TTL)
    // rather than an empty options list.
    if (cached) return NextResponse.json(cached.payload);
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