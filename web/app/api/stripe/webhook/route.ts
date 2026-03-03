import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getDb } from '../../../../../src/db/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

async function setUserPlan(db: ReturnType<typeof getDb>, email: string, plan: 'free' | 'pro', stripeCustomerId?: string, stripeSubscriptionId?: string) {
  await db.execute({
    sql: `UPDATE users SET plan = ?, stripe_customer_id = COALESCE(NULLIF(?, ''), stripe_customer_id), stripe_subscription_id = COALESCE(NULLIF(?, ''), stripe_subscription_id) WHERE email = ?`,
    args: [plan, stripeCustomerId ?? '', stripeSubscriptionId ?? '', email],
  });
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) { console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not set'); return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 }); }

  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });

  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret); }
  catch (err) { console.error('[stripe/webhook] signature verification failed:', err); return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 }); }

  const db = getDb();
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const sess = event.data.object as Stripe.Checkout.Session;
        const email = sess.metadata?.email ?? sess.customer_email;
        const customerId = typeof sess.customer === 'string' ? sess.customer : sess.customer?.id;
        const subscriptionId = typeof sess.subscription === 'string' ? sess.subscription : sess.subscription?.id;
        if (email) { await setUserPlan(db, email, 'pro', customerId, subscriptionId); console.log(`[stripe/webhook] checkout.session.completed → ${email} upgraded to pro`); }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        if (customerId) { await db.execute({ sql: `UPDATE users SET plan = 'free', stripe_subscription_id = NULL WHERE stripe_customer_id = ?`, args: [customerId] }); console.log(`[stripe/webhook] subscription.deleted → customer ${customerId} downgraded`); }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        const status = sub.status;
        if (customerId) { const isActive = status === 'active' || status === 'trialing'; const plan = isActive ? 'pro' : 'free'; await db.execute({ sql: `UPDATE users SET plan = ? WHERE stripe_customer_id = ?`, args: [plan, customerId] }); console.log(`[stripe/webhook] subscription.updated → customer ${customerId} plan=${plan} (status=${status})`); }
        break;
      }
      default: break;
    }
  } catch (err) {
    console.error('[stripe/webhook] handler error:', err);
    return NextResponse.json({ error: 'Webhook handler error' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
