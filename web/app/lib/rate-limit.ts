interface RateLimitEntry { count: number; windowStart: number; }

const store = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000;
const UNAUTH_LIMIT = 10;
const AUTH_LIMIT = 30;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > WINDOW_MS * 2) store.delete(key);
  }
}, 5 * 60_000);

export interface RateLimitResult { allowed: boolean; remaining: number; resetAt: number; limit: number; }

export function checkRateLimit(key: string, isAuth: boolean): RateLimitResult {
  const limit = isAuth ? AUTH_LIMIT : UNAUTH_LIMIT;
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + WINDOW_MS, limit };
  }
  entry.count++;
  store.set(key, entry);
  const remaining = Math.max(0, limit - entry.count);
  const resetAt = entry.windowStart + WINDOW_MS;
  return { allowed: entry.count <= limit, remaining, resetAt, limit };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return request.headers.get('x-real-ip') ?? 'unknown';
}
