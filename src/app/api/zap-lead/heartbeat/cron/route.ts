import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { runZapLeadHeartbeatSweep } from '@/lib/zap-lead/heartbeat';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'heartbeat cron is not configured' },
      { status: 503 }
    );
  }

  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '');
  const expectedBytes = Buffer.from(expected);
  if (
    supplied.length !== expectedBytes.length ||
    !timingSafeEqual(supplied, expectedBytes)
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await runZapLeadHeartbeatSweep();
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'heartbeat sweep failed' },
      { status: 503 }
    );
  }
}
