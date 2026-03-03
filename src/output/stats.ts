import { getDb } from '../db/connection.js';

export interface AggregateStats {
  totalAudits: number;
  totalBilled: number;
  totalSavings: number;
  avgSavingsPerAudit: number;
  topOverchargedCodes: Array<{ cptCode: string; count: number; totalOvercharge: number }>;
}

export function getAggregateStats(): AggregateStats {
  const db = getDb();

  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_audits,
      SUM(total_billed) as total_billed,
      SUM(total_savings) as total_savings,
      AVG(total_savings) as avg_savings
    FROM audits
  `).get() as any;

  return {
    totalAudits: summary.total_audits || 0,
    totalBilled: summary.total_billed || 0,
    totalSavings: summary.total_savings || 0,
    avgSavingsPerAudit: summary.avg_savings || 0,
    topOverchargedCodes: [],
  };
}

export function formatStats(stats: AggregateStats): string {
  const lines = [
    '═══════════════════════════════════════',
    '  BILLSCAN AGGREGATE STATISTICS',
    '═══════════════════════════════════════',
    `  Total Audits:    ${stats.totalAudits}`,
    `  Total Billed:    $${stats.totalBilled.toFixed(2)}`,
    `  Total Savings:   $${stats.totalSavings.toFixed(2)}`,
    `  Avg Savings:     $${stats.avgSavingsPerAudit.toFixed(2)} per audit`,
    '═══════════════════════════════════════',
  ];
  return lines.join('\n');
}
