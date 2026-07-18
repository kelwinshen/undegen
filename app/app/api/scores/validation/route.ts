import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function mapProofNode(node: any) {
  return { hash: node?.hash, is_right_sibling: node?.isRightSibling };
}

function mapScoreStat(stat: any) {
  if (!stat) return null;
  return { key: stat.key, value: stat.value, period: stat.period };
}

function safeMapProofs(proofList: any) {
  if (Array.isArray(proofList)) {
    return proofList.map(mapProofNode);
  }
  return [];
}

function normalizeValidationResponse(raw: any, seq: number) {
  const summary = raw.summary || {};
  const updateStats = summary.updateStats || {};

  const fixtureSummary = {
    fixture_id: summary.fixtureId ?? null,
    update_stats: {
      update_count: updateStats.updateCount ?? null,
      min_timestamp: updateStats.minTimestamp ?? null,
      max_timestamp: updateStats.maxTimestamp ?? null,
    },
    events_sub_tree_root: summary.eventStatsSubTreeRoot ?? null,
  };

  const mainTreeProof = safeMapProofs(raw.mainTreeProof);
  const fixtureProof = safeMapProofs(raw.subTreeProof);

  const statA = raw.statToProve
    ? {
        stat_to_prove: mapScoreStat(raw.statToProve),
        event_stat_root: raw.eventStatRoot,
        stat_proof: safeMapProofs(raw.statProof),
      }
    : null;

  let statB = null;
  if (raw.statToProve2) {
    statB = {
      stat_to_prove: mapScoreStat(raw.statToProve2),
      event_stat_root: raw.eventStatRoot,
      stat_proof: safeMapProofs(raw.statProof2),
    };
  }

  return {
    ts: raw.ts,
    seq,
    fixtureSummary,
    mainTreeProof,
    fixtureProof,
    statA,
    statB,
  };
}

// Helper to detect specific match states in a snapshot's events or properties
function hasMatchState(snapshot: any, stateName: string) {
  // 1. Check direct properties on the snapshot (this handles the "Action": "game_finalised" structure)
  if (
    snapshot.Action === stateName ||
    snapshot.action === stateName ||
    snapshot.status === stateName ||
    snapshot.Status === stateName ||
    snapshot.match_state === stateName ||
    snapshot.MatchState === stateName
  ) {
    return true;
  }

  // 2. Check inside game events arrays just in case it's nested differently in other responses
  const events =
    snapshot.events ||
    snapshot.Events ||
    snapshot.game_events ||
    snapshot.GameEvents ||
    [];
  if (Array.isArray(events)) {
    const hasEvent = events.some(
      (e: any) =>
        e.type === stateName ||
        e.Type === stateName ||
        e.code === stateName ||
        e.Code === stateName ||
        e.event === stateName ||
        e.Event === stateName ||
        e.action === stateName ||
        e.Action === stateName
    );
    if (hasEvent) return true;
  }

  return false;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fixtureId = searchParams.get("fixtureId");
  const statKey = searchParams.get("statKey");
  const statKey2 = searchParams.get("statKey2");
  const periodStr = searchParams.get("period");

  if (!fixtureId || !statKey) {
    return NextResponse.json(
      { error: "Missing required parameters: fixtureId, statKey" },
      { status: 400 }
    );
  }

  const headers = {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    "X-Api-Token": process.env.API_TOKEN || "",
    Accept: "application/json",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": "PostmanRuntime/7.32.3",
  };

  try {
    const cacheBuster = Date.now();
    const snapUrl = `https://txline-dev.txodds.com/api/scores/snapshot/${encodeURIComponent(fixtureId)}?_cb=${cacheBuster}`;

    const snapRes = await fetch(snapUrl, {
      headers,
      cache: "no-store",
    });

    if (!snapRes.ok) {
      const text = await snapRes.text();
      return NextResponse.json(
        { error: `Snapshot fetch failed (${snapRes.status}): ${text}` },
        { status: 502 }
      );
    }

    const snapshots: any[] = await snapRes.json();
    if (!snapshots || snapshots.length === 0) {
      return NextResponse.json(
        { error: "No snapshots returned for this fixture" },
        { status: 404 }
      );
    }

    const period = periodStr ? parseInt(periodStr) : 0;
    let targetSnapshot = snapshots[snapshots.length - 1];

    let isMatchFinished = false;
    let isHalfTime = false;

    if (period === 0) {
      const finished = snapshots.find((s) =>
        hasMatchState(s, "game_finalised")
      );
      if (finished) {
        targetSnapshot = finished;
        isMatchFinished = true;
      }
    } else if (period === 1) {
      const htSnap = snapshots.find((s) =>
        hasMatchState(s, "halftime_finalised")
      );
      if (htSnap) {
        targetSnapshot = htSnap;
        isHalfTime = true;
      } else {
        for (let i = snapshots.length - 1; i >= 0; i--) {
          const s = snapshots[i];
          if (s.Score?.Participant1?.HT && !s.Score?.Participant1?.H2) {
            targetSnapshot = s;
            isHalfTime = true;
            break;
          }
        }
      }
    }

    const seq = targetSnapshot.Seq;
    if (seq === undefined || seq === null) {
      return NextResponse.json(
        { error: "Invalid snapshot: missing seq" },
        { status: 500 }
      );
    }

    let proofUrl = `https://txline-dev.txodds.com/api/scores/stat-validation?fixtureId=${encodeURIComponent(fixtureId)}&seq=${encodeURIComponent(seq)}&statKey=${encodeURIComponent(statKey)}&_cb=${cacheBuster}`;
    if (statKey2) proofUrl += `&statKey2=${encodeURIComponent(statKey2)}`;

    const proofRes = await fetch(proofUrl, {
      headers,
      cache: "no-store",
    });

    if (!proofRes.ok) {
      const text = await proofRes.text();
      return NextResponse.json(
        { error: `Proof fetch failed (${proofRes.status}): ${text}` },
        { status: 502 }
      );
    }

    const proofData = await proofRes.json();
    proofData.seq = seq;
    const normalized = normalizeValidationResponse(proofData, seq);

    if (period === 0 && !isMatchFinished) {
      return NextResponse.json({
        ...normalized,
        warning: "Match is not finished yet; using the latest snapshot.",
      });
    }
    if (period === 1 && !isHalfTime) {
      return NextResponse.json({
        ...normalized,
        warning: "Half-time snapshot not confirmed; using closest available.",
      });
    }

    return NextResponse.json(normalized);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
