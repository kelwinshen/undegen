import { NextResponse } from 'next/server';

const API_BASE = 'https://txline-dev.txodds.com';

const STATUS_MAP: Record<string, string> = {
  NS: 'Not Started',   NS2: 'Not Started',
  I: 'In Play',        I2: 'In Play',
  HT: 'Half Time',     HT2: 'Half Time',
  F: 'Finished',       F2: 'Finished',  END: 'Finished',
  FET: 'Finished Extra Time',
  FPE: 'Finished Penalties',
  ET1: 'Extra Time 1', ET2: 'Extra Time 2',
  P: 'Penalties',      PE: 'Penalties Ended',
  WET: 'Waiting Extra Time',
  WPE: 'Waiting Penalties',
};

const STAT_KEY_PARTICIPANT1_GOALS = 1002;
const STAT_KEY_PARTICIPANT2_GOALS = 1003;

function extractStatus(statusObj: any): string {
  if (!statusObj) return 'Unknown';
  if (typeof statusObj === 'string') return statusObj;
  const keys = Object.keys(statusObj);
  return keys.length > 0 ? keys[0] : 'Unknown';
}

function extractGoals(entry: any): { p1: number; p2: number } | null {
  // First try scoreSoccer
  const scoreSoccer = entry.scoreSoccer;
  if (
    scoreSoccer &&
    scoreSoccer.Participant1?.Total?.Goals !== undefined &&
    scoreSoccer.Participant2?.Total?.Goals !== undefined
  ) {
    return {
      p1: scoreSoccer.Participant1.Total.Goals,
      p2: scoreSoccer.Participant2.Total.Goals,
    };
  }

  // Fallback to stats map
  const stats = entry.stats;
  if (stats && typeof stats === 'object') {
    const p1 = stats[STAT_KEY_PARTICIPANT1_GOALS];
    const p2 = stats[STAT_KEY_PARTICIPANT2_GOALS];
    if (typeof p1 === 'number' && typeof p2 === 'number') {
      return { p1, p2 };
    }
  }

  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureIdsParam = searchParams.get('fixtureIds');

  if (!fixtureIdsParam) {
    return NextResponse.json({ scores: [] });
  }

  const fixtureIds = fixtureIdsParam.split(',').map(Number).filter(Boolean);

  const headers = {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    'X-Api-Token': process.env.API_TOKEN || '',
  };

  try {
    const scoresMap: Record<number, any> = {};

    await Promise.all(
      fixtureIds.map(async (fixtureId) => {
        try {
          const url = `${API_BASE}/api/scores/snapshot/${fixtureId}?t=${Date.now()}`;
          const scoreRes = await fetch(url, {
            headers,
            cache: 'no-store',
          });
          const scoreData = await scoreRes.json();

          if (!Array.isArray(scoreData) || scoreData.length === 0) return;

          // Status always from the very last entry
          const lastEntry = scoreData[scoreData.length - 1];
          const rawStatus = extractStatus(lastEntry.statusSoccerId);

          // Search backwards for the latest entry that has goals
          let goals: { p1: number; p2: number } | null = null;
          for (let i = scoreData.length - 1; i >= 0; i--) {
            const g = extractGoals(scoreData[i]);
            if (g) {
              goals = g;
              break;
            }
          }

          if (goals === null) {
            // Still return status-only score if match has started
            scoresMap[fixtureId] = {
              fixtureId,
              status: STATUS_MAP[rawStatus] ?? rawStatus,
              p1Goals: 0,
              p2Goals: 0,
            };
          } else {
            scoresMap[fixtureId] = {
              fixtureId,
              status: STATUS_MAP[rawStatus] ?? rawStatus,
              p1Goals: goals.p1,
              p2Goals: goals.p2,
            };
          }
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