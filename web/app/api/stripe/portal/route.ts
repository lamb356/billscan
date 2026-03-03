import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Stripe from 'stripe';
import { authOptions } from '../../../lib/auth';
import { checkRateLimit, getClientIp } from '../../../lib/rate-limit';
import { getDb } from '../../../../../src/db/connection';

export const runtime = 'nodejs';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit(session?.user?.email ?? ip, !!session);
  if (!rateCheck.allowed) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  if (!session?.user?.email) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const email = session.user.email;

  try {
    const stripe = getStripe();
    const db = getDb();
    const userResult = await db.execute({ sql: 'SELECT stripe_customer_id FROM users WHERE email = ?', args: [email] });
    const user = userResult.rows[0] as { stripe_customer_id: string | null } | undefined;
    if (!user?.stripe_customer_id) return NextResponse.json({ error: 'No active subscription found. Please subscribe first.' }, { status: 404 });
    const baseUrl = process.env.NEXTAUTH_URL ?? 'https://billscan.app';
    const portalSession = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${baseUrl}/audit` });
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error('[stripe/portal]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create portal session' }, { status: 500 });
  }
}
