import { redis } from "../../lib/redis";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { batchId, fixtureId, optionsMapping, timestamps, slotsMapping } = body;

    if (batchId === undefined || !fixtureId || !optionsMapping || !slotsMapping) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const redisKey = `undegen:batch:${batchId}`;
    const payload = JSON.stringify({
      fixtureId,
      optionsMapping,
      slotsMapping,
      timestamps: timestamps || {},
    });

    await redis.set(redisKey, payload);

    return NextResponse.json({ success: true, message: "Mapping saved to Redis" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const batchId = searchParams.get("batchId");

    if (!batchId) {
      return NextResponse.json({ error: "Batch ID is required" }, { status: 400 });
    }

    const redisKey = `undegen:batch:${batchId}`;
    const data = await redis.get(redisKey);

    if (!data) {
      return NextResponse.json({ error: "Mapping not found for this batch" }, { status: 404 });
    }

    return NextResponse.json(JSON.parse(data));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
