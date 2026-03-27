/**
 * BillScan Stripe Integration
 *
 * Uses Stripe API directly via fetch — no npm dependency needed.
 * Set environment variables:
 *   STRIPE_SECRET_KEY — Stripe secret key
 *   STRIPE_PRICE_ID — Price ID for the $10.99/mo plan
 *   STRIPE_WEBHOOK_SECRET — Webhook signing secret
 *   APP_URL — Public app URL for redirects
 */

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

async function stripeRequest(endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function stripeGet(endpoint: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET}` },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

/**
 * Create a Stripe Checkout session for the premium subscription.
 */
export async function createCheckoutSession(userId: number, email: string, customerId?: string): Promise<{ url: string; sessionId: string }> {
  if (!STRIPE_SECRET || !STRIPE_PRICE_ID) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID environment variables.');
  }

  const params: Record<string, string> = {
    'mode': 'subscription',
    'line_items[0][price]': STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    'success_url': `${APP_URL}/#/account?upgraded=true`,
    'cancel_url': `${APP_URL}/#/audit`,
    'client_reference_id': String(userId),
    'metadata[user_id]': String(userId),
  };

  if (customerId) {
    params['customer'] = customerId;
  } else {
    params['customer_email'] = email;
  }

  const session = await stripeRequest('/checkout/sessions', params);

  if (session.error) {
    throw new Error((session.error as Record<string, string>).message || 'Stripe error');
  }

  return {
    url: session.url as string,
    sessionId: session.id as string,
  };
}

/**
 * Create a Stripe Customer Portal session for managing subscription.
 */
export async function createPortalSession(customerId: string): Promise<{ url: string }> {
  if (!STRIPE_SECRET) {
    throw new Error('Stripe is not configured.');
  }

  const session = await stripeRequest('/billing_portal/sessions', {
    'customer': customerId,
    'return_url': `${APP_URL}/#/account`,
  });

  if (session.error) {
    throw new Error((session.error as Record<string, string>).message || 'Stripe portal error');
  }

  return { url: session.url as string };
}

/**
 * Verify a Stripe webhook signature.
 * Returns parsed event or null if verification fails.
 */
export function verifyWebhookSignature(
  payload: string,
  sigHeader: string,
): Record<string, unknown> | null {
  if (!STRIPE_WEBHOOK_SECRET) {
    // No webhook secret configured — accept in dev mode
    try { return JSON.parse(payload); } catch { return null; }
  }

  try {
    const { createHmac } = require('node:crypto');
    const parts: Record<string, string> = {};
    for (const item of sigHeader.split(',')) {
      const [key, val] = item.split('=');
      parts[key.trim()] = val;
    }

    const timestamp = parts['t'];
    const v1Sig = parts['v1'];
    if (!timestamp || !v1Sig) return null;

    // Check timestamp (reject events older than 5 minutes)
    const age = Math.floor(Date.now() / 1000) - Number(timestamp);
    if (age > 300) return null;

    const signedPayload = `${timestamp}.${payload}`;
    const expected = createHmac('sha256', STRIPE_WEBHOOK_SECRET)
      .update(signedPayload)
      .digest('hex');

    if (expected !== v1Sig) return null;

    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Get subscription details for a customer.
 */
export async function getSubscription(subscriptionId: string): Promise<Record<string, unknown>> {
  return stripeGet(`/subscriptions/${subscriptionId}`);
}

export function isStripeConfigured(): boolean {
  return !!(STRIPE_SECRET && STRIPE_PRICE_ID);
}
