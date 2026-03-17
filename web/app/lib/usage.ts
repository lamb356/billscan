import { getDb } from '../../../src/db/connection';

export const FREE_TIER_LIMIT = 3;

interface UsageStatus {
  allowed: boolean;
  count: number;
  limit: number;
  isPro: boolean;
  resetAt: string | null;
}

interface UserRow {
  id: string;
  plan: string;
  audit_count: number;
  audit_reset_at: string | null;
}

/**
 * Check whether a user is allowed to run an audit.
 * - Pro users are always allowed.
 * - Free users are allowed up to FREE_TIER_LIMIT audits per calendar month.
 *   The counter resets on the 1st of each month.
 */
export async function checkUsage(email: string): Promise<UsageStatus> {
  const db = getDb();

  const result = await db.execute({
    sql: 'SELECT id, plan, audit_count, audit_reset_at FROM users WHERE email = ?',
    args: [email],
  });

  const row = result.rows[0] as UserRow | undefined;

  if (!row) {
    // User doesn't exist yet — allow (will be created on next signIn)
    return { allowed: true, count: 0, limit: FREE_TIER_LIMIT, isPro: false, resetAt: null };
  }

  const isPro = row.plan === 'pro';

  if (isPro) {
    return { allowed: true, count: row.audit_count, limit: Infinity, isPro: true, resetAt: null };
  }

  // Check if we need to reset the monthly counter
  const now = new Date();
  const resetAt = row.audit_reset_at ? new Date(row.audit_reset_at) : null;
  const shouldReset = !resetAt || resetAt.getMonth() !== now.getMonth() || resetAt.getFullYear() !== now.getFullYear();

  if (shouldReset) {
    // Reset counter
    const newResetAt = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    await db.execute({
      sql: 'UPDATE users SET audit_count = 0, audit_reset_at = ? WHERE id = ?',
      args: [newResetAt, row.id],
    });
    return { allowed: true, count: 0, limit: FREE_TIER_LIMIT, isPro: false, resetAt: newResetAt };
  }

  const count = row.audit_count;
  const allowed = count < FREE_TIER_LIMIT;

  return {
    allowed,
    count,
    limit: FREE_TIER_LIMIT,
    isPro: false,
    resetAt: row.audit_reset_at,
  };
}

/**
 * Increment the audit counter for a user after a successful audit.
 */
export async function incrementUsage(email: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: 'UPDATE users SET audit_count = audit_count + 1 WHERE email = ?',
    args: [email],
  });
}
