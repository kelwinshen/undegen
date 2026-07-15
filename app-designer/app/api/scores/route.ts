import { NextResponse } from "next/server";

const API_BASE = "https://txline.txodds.com";

const STATUS_MAP: Record<string, string> = {
  NS: "Not Started",
  I: "In Play",
  HT: "Half Time",
  F: "Finished",
  ET1: "Extra Time 1",
  ET2: "Extra Time 2",
  FET: "Finished Extra Time",
  P: "Penalties",
  PE: "Penalties Ended",
  WET: "Waiting Extra Time",
  WPE: "Waiting Penalties",
};

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
          const scoreRes = await fetch(
            `${API_BASE}/api/scores/snapshot/${fixtureId}`,
            { headers }
          );
          const scoreData = await scoreRes.json();
          const latest = Array.isArray(scoreData) ? scoreData[0] : scoreData;
          if (latest) {
            const rawStatus =
              latest.statusSoccerId?.toString() ?? latest.gameState;
            scoresMap[fixtureId] = {
              fixtureId,
              status: STATUS_MAP[rawStatus] ?? rawStatus ?? "Unknown",
              p1Goals: latest.scoreSoccer?.Participant1?.Total?.Goals ?? 0,
              p2Goals: latest.scoreSoccer?.Participant2?.Total?.Goals ?? 0,
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
