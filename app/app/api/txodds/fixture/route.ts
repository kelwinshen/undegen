import { NextResponse } from "next/server";

const API_BASE = "https://txline-dev.txodds.com";

// /api/txodds's own fixture list drops anything with startTime <= now, so a
// match that has already kicked off never carries participant names through
// to the frontend even though TXODDS keeps serving it on this same endpoint.
// This looks a single fixture up by ID with no such filter, for exactly that
// case — a proposal that needs to show real team names after kickoff.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureIdParam = searchParams.get("fixtureId");
  const fixtureId = fixtureIdParam ? Number(fixtureIdParam) : NaN;

  if (!fixtureIdParam || Number.isNaN(fixtureId)) {
    return NextResponse.json(
      { error: "Missing or invalid fixtureId" },
      { status: 400 }
    );
  }

  const headers = {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    "X-Api-Token": process.env.API_TOKEN || "",
  };

  try {
    const currentEpochDay = Math.floor(Date.now() / 86400000);
    const url = `${API_BASE}/api/fixtures/snapshot?startEpochDay=${currentEpochDay}`;
    const res = await fetch(url, { headers, cache: "no-store" });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Upstream error ${res.status}: ${text}` },
        { status: 502 }
      );
    }

    const fixtures = await res.json();
    const found = Array.isArray(fixtures)
      ? fixtures.find((f: any) => f.FixtureId === fixtureId)
      : null;

    if (!found) {
      return NextResponse.json({ error: "Fixture not found" }, { status: 404 });
    }

    return NextResponse.json({
      fixtureId: found.FixtureId,
      participant1: found.Participant1,
      participant2: found.Participant2,
      startTime: Number(found.StartTime),
      competition: found.Competition,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
