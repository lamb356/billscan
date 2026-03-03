import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/auth';
import { checkRateLimit, getClientIp } from '../../lib/rate-limit';
import { getDb } from '../../../../src/db/connection';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit(session?.user?.email ?? ip, !!session);
  if (!rateCheck.allowed) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });

  try {
    const db = getDb();
    const [totalsResult, topSavingsResult, recentResult] = await Promise.all([
      db.execute({ sql: `SELECT COUNT(*) AS total_audits, SUM(total_billed) AS total_billed, SUM(total_savings) AS total_savings, AVG(total_savings) AS avg_savings, MAX(total_savings) AS max_savings FROM audits`, args: [] }),
      db.execute({ sql: `SELECT report_id, total_billed, total_savings, finding_count, created_at FROM audits ORDER BY total_savings DESC LIMIT 5`, args: [] }),
      db.execute({ sql: `SELECT report_id, total_billed, total_savings, finding_count, created_at FROM audits ORDER BY created_at DESC LIMIT 10`, args: [] }),
    ]);
    const totals = totalsResult.rows[0] as { total_audits: number; total_billed: number; total_savings: number; avg_savings: number; max_savings: number };
    return NextResponse.json({
      totalAudits: totals.total_audits ?? 0,
      totalBilledAcrossAllAudits: totals.total_billed ?? 0,
      totalSavingsFound: totals.total_savings ?? 0,
      averageSavingsPerAudit: totals.avg_savings ? +totals.avg_savings.toFixed(2) : 0,
      maxSavingsFound: totals.max_savings ?? 0,
      topSavings: topSavingsResult.rows.map((r) => ({ reportId: r.report_id, totalBilled: r.total_billed, totalSavings: r.total_savings, findingCount: r.finding_count, createdAt: r.created_at })),
      recentAudits: recentResult.rows.map((r) => ({ reportId: r.report_id, totalBilled: r.total_billed, totalSavings: r.total_savings, findingCount: r.finding_count, createdAt: r.created_at })),
    });
  } catch (err) {
    console.error('[stats]', err);
    return NextResponse.json({ error: 'Failed to retrieve stats' }, { status: 500 });
  }
}
