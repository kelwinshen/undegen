import { NextRequest, NextResponse } from 'next/server';

function mapProofNode(node: any) {
  return { hash: node?.hash, is_right_sibling: node?.isRightSibling };
}

function mapScoreStat(stat: any) {
  if (!stat) return null;
  return { key: stat.key, value: stat.value, period: stat.period };
}

// Safely handles the API returning a Nil object {} instead of an array
function safeMapProofs(proofList: any) {
  if (Array.isArray(proofList)) {
    return proofList.map(mapProofNode);
  }
  return [];
}

function normalizeValidationResponse(raw: any, seq: number) {
  // Safely fallback to empty objects to prevent 'Cannot read properties of undefined'
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

  const statA = raw.statToProve ? {
    stat_to_prove: mapScoreStat(raw.statToProve),
    event_stat_root: raw.eventStatRoot,
    stat_proof: safeMapProofs(raw.statProof),
  } : null;

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fixtureId = searchParams.get('fixtureId');
  const statKey = searchParams.get('statKey');
  const statKey2 = searchParams.get('statKey2');
  const periodStr = searchParams.get('period');

  if (!fixtureId || !statKey) {
    return NextResponse.json(
      { error: 'Missing required parameters: fixtureId, statKey' },
      { status: 400 }
    );
  }

  const headers = {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    'X-Api-Token': process.env.API_TOKEN || '',
  };

  try {
    // 1. Fetch all snapshots
    const snapRes = await fetch(
      `https://txline-dev.txodds.com/api/scores/snapshot/${encodeURIComponent(fixtureId)}`,
      { headers }
    );
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
        { error: 'No snapshots returned for this fixture' },
        { status: 404 }
      );
    }

    // 2. Determine the correct snapshot based on period
    const period = periodStr ? parseInt(periodStr) : 0;
    let targetSnapshot = snapshots[snapshots.length - 1]; // fallback

    // StatusId mapping (soccer):
    // 1=not started, 2=first half, 3=half time, 4=second half, 7=full time
    const fullTimeStatus = 7;
    const halfTimeStatus = 3;

    if (period === 0) {
      const finished = snapshots.find(s => s.StatusId === fullTimeStatus);
      if (finished) targetSnapshot = finished;
    } else if (period === 1) {
      const htSnap = snapshots.find(s => s.StatusId === halfTimeStatus);
      if (htSnap) {
        targetSnapshot = htSnap;
      } else {
        // fallback: the last snapshot before second half started
        for (let i = snapshots.length - 1; i >= 0; i--) {
          const s = snapshots[i];
          if (s.Score?.Participant1?.HT && !s.Score?.Participant1?.H2) {
            targetSnapshot = s;
            break;
          }
        }
      }
    }


    const seq = targetSnapshot.Seq;
    if (seq === undefined || seq === null) {
      return NextResponse.json(
        { error: 'Invalid snapshot: missing seq' },
        { status: 500 }
      );
    }

    // 3. Fetch the stat validation proof
    let proofUrl = `https://txline-dev.txodds.com/api/scores/stat-validation?fixtureId=${encodeURIComponent(fixtureId)}&seq=${encodeURIComponent(seq)}&statKey=${encodeURIComponent(statKey)}`;
    if (statKey2) proofUrl += `&statKey2=${encodeURIComponent(statKey2)}`;

    const proofRes = await fetch(proofUrl, { headers });
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

    // Attach a warning if the match isn't finished
    if (period === 0 && targetSnapshot.StatusId !== fullTimeStatus) {
      return NextResponse.json({
        ...normalized,
        warning: 'Match is not finished yet; using the latest snapshot.',
      });
    }
    if (period === 1 && targetSnapshot.StatusId !== halfTimeStatus) {
      return NextResponse.json({
        ...normalized,
        warning: 'Half-time snapshot not confirmed; using closest available.',
      });
    }

    return NextResponse.json(normalized);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}