import { getDb } from '../db/connection.js';

export interface AggregateStats {
  totalAudits: number;
  totalBilled: number;
  totalSavingsFound: number;
  averageMultiplier: number | null;
  topOverchargedCodes: { cptCode: string; count: number; totalSavings: number }[];
}

export async function getAggregateStats(): Promise<AggregateStats> {
  const db = getDb();

  const summary = (await db.execute({
    sql: `
      SELECT
        COUNT(*) as total_audits,
        COALESCE(SUM(total_billed), 0) as total_billed,
        COALESCE(SUM(total_savings), 0) as total_savings
      FROM audits
    `,
    args: [],
  })).rows[0] as { total_audits: number; total_billed: number; total_savings: number };

  return {
    totalAudits: summary.total_audits,
    totalBilled: summary.total_billed,
    totalSavingsFound: summary.total_savings,
    averageMultiplier: null, // would need to parse report_json for this
    topOverchargedCodes: [],
  };
}

export function formatStats(stats: AggregateStats): string {
  const lines = [
    '=== BillScan Transparency Stats ===',
    '',
    `Total Audits:        ${stats.totalAudits}`,
    `Total Billed:        $${stats.totalBilled.toLocaleString()}`,
    `Total Savings Found: $${stats.totalSavingsFound.toLocaleString()}`,
    '',
    'These stats are from real CMS fee schedule comparisons.',
    'Every finding is reproducible with the report ID and CMS data hash.',
  ];
  return lines.join('\n');
}
