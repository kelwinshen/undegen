import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const messageId = searchParams.get('messageId');
  const ts = searchParams.get('ts');

  if (!messageId || !ts) {
    return NextResponse.json({ error: 'Missing messageId or ts' }, { status: 400 });
  }

  const headers = {
    Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    'X-Api-Token': process.env.API_TOKEN || '',
  };

  const url = `https://txline-dev.txodds.com/api/odds/validation?messageId=${encodeURIComponent(messageId)}&ts=${ts}`;

  try {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const text = await res.text();
      // Return a detailed error to the client
      return NextResponse.json({
        error: `Upstream error ${res.status}: ${text}`,
        upstreamStatus: res.status,
        upstreamBody: text,
      }, { status: 502 });
    }

    const data = await res.json();
    console.log("FULL API RESPONSE:", JSON.stringify(data, null, 2));
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}