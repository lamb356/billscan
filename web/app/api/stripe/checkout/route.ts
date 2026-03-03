import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Stripe from 'stripe';
import { authOptions } from '../../../lib/auth';
import { checkRateLimit, getClientIp } from '../../../lib/rate-limit';
import { getDb } from '../../../../../src/db/connection';

export const runtime = 'nodejs';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
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
    const userResult = await db.execute({ sql: 'SELECT id, stripe_customer_id, plan FROM users WHERE email = ?', args: [email] });
    const user = userResult.rows[0] as { id: string; stripe_customer_id: string | null; plan: string } | undefined;
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.plan === 'pro') return NextResponse.json({ error: 'Already on Pro plan' }, { status: 400 });

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { userId: user.id } });
      customerId = customer.id;
      await db.execute({ sql: 'UPDATE users SET stripe_customer_id = ? WHERE id = ?', args: [customerId, user.id] });
    }

    const baseUrl = process.env.NEXTAUTH_URL ?? 'https://billscan.app';
    const priceId = process.env.STRIPE_PRO_PRICE_ID;
    if (!priceId) return NextResponse.json({ error: 'Stripe price not configured' }, { status: 500 });

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId, mode: 'subscription', payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/audit?upgraded=true`, cancel_url: `${baseUrl}/pricing?cancelled=true`,
      metadata: { userId: user.id, email }, subscription_data: { metadata: { userId: user.id, email } },
    });
    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    console.error('[stripe/checkout]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create checkout session' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', '/api/stripe/checkout');
    return NextResponse.redirect(loginUrl);
  }
  const patchedReq = new Request(req.url, { method: 'POST', headers: req.headers });
  return POST(patchedReq as NextRequest);
}
