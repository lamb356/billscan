import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/auth';
import { checkRateLimit, getClientIp } from '../../lib/rate-limit';
import { checkCharityCare } from '../../../../src/analyzer/charity-care';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit(session?.user?.email ?? ip, !!session);
  if (!rateCheck.allowed) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });

  let body: { facilityName?: string; zip?: string; state?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const { facilityName, zip, state } = body;
  if (!facilityName) return NextResponse.json({ error: 'facilityName is required' }, { status: 400 });

  try {
    const result = await checkCharityCare(facilityName, zip, state);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[charity-check]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Charity care check failed' }, { status: 500 });
  }
}
