/**
 * BillScan Analytics — Privacy-friendly, self-hosted
 *
 * Tracks only aggregate data. No PII. No third-party services.
 */

import { getDb } from './db/connection.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

// Rate limit: max 30 events per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW = 60_000; // 1 minute

export function checkAnalyticsRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export async function logEvent(
  eventType: string,
  eventData?: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO analytics_events (event_type, event_data) VALUES (?, ?)`,
    args: [eventType, eventData ? JSON.stringify(eventData) : null],
  });
}

export function isAdmin(email: string | undefined): boolean {
  if (!ADMIN_EMAIL || !email) return false;
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

export async function getAnalyticsDashboard(): Promise<Record<string, unknown>> {
  const db = getDb();

  // Page views last 7 and 30 days
  const pageViews7d = await db.execute({
    sql: `SELECT json_extract(event_data, '$.page') as page, COUNT(*) as views
          FROM analytics_events
          WHERE event_type = 'page_view'
            AND created_at >= datetime('now', '-7 days')
          GROUP BY page ORDER BY views DESC`,
    args: [],
  });

  const pageViews30d = await db.execute({
    sql: `SELECT json_extract(event_data, '$.page') as page, COUNT(*) as views
          FROM analytics_events
          WHERE event_type = 'page_view'
            AND created_at >= datetime('now', '-30 days')
          GROUP BY page ORDER BY views DESC`,
    args: [],
  });

  // Total audits
  const auditStats = await db.execute({
    sql: `SELECT COUNT(*) as total,
                 AVG(CAST(json_extract(event_data, '$.billSize') AS REAL)) as avgBillSize,
                 AVG(CAST(json_extract(event_data, '$.savings') AS REAL)) as avgSavings
          FROM analytics_events WHERE event_type = 'audit'`,
    args: [],
  });

  // Audits last 7 days
  const audits7d = await db.execute({
    sql: `SELECT COUNT(*) as total FROM analytics_events
          WHERE event_type = 'audit' AND created_at >= datetime('now', '-7 days')`,
    args: [],
  });

  // Signups and upgrades
  const signups = await db.execute({
    sql: `SELECT COUNT(*) as total FROM analytics_events WHERE event_type = 'signup'`,
    args: [],
  });
  const upgrades = await db.execute({
    sql: `SELECT COUNT(*) as total FROM analytics_events WHERE event_type = 'upgrade'`,
    args: [],
  });

  // Feature usage (downloads)
  const featureUsage = await db.execute({
    sql: `SELECT json_extract(event_data, '$.feature') as feature, COUNT(*) as uses
          FROM analytics_events
          WHERE event_type = 'download'
            AND created_at >= datetime('now', '-30 days')
          GROUP BY feature ORDER BY uses DESC`,
    args: [],
  });

  // Daily audit trend (last 30 days)
  const dailyAudits = await db.execute({
    sql: `SELECT date(created_at) as day, COUNT(*) as count
          FROM analytics_events
          WHERE event_type = 'audit' AND created_at >= datetime('now', '-30 days')
          GROUP BY day ORDER BY day`,
    args: [],
  });

  const row = auditStats.rows[0] as unknown as { total: number; avgBillSize: number | null; avgSavings: number | null };
  const a7d = audits7d.rows[0] as unknown as { total: number };
  const su = signups.rows[0] as unknown as { total: number };
  const up = upgrades.rows[0] as unknown as { total: number };

  return {
    pageViews: {
      last7Days: pageViews7d.rows,
      last30Days: pageViews30d.rows,
    },
    audits: {
      total: row.total,
      last7Days: a7d.total,
      avgBillSize: row.avgBillSize ? +row.avgBillSize.toFixed(2) : null,
      avgSavings: row.avgSavings ? +row.avgSavings.toFixed(2) : null,
    },
    signups: su.total,
    upgrades: up.total,
    featureUsage: featureUsage.rows,
    dailyAuditTrend: dailyAudits.rows,
  };
}
