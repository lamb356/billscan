import { getDb } from '../src/db/connection.js';
async function m() {
  const db = getDb();
  // Check what user data tables exist and have data
  const tables = ['audits', 'users', 'community_prices', 'hospital_prices'];
  for (const t of tables) {
    try {
      const c = (await db.execute({ sql: `SELECT COUNT(*) as c FROM ${t}`, args: [] })).rows[0];
      console.log(`  ${t}: ${(c as any).c} rows`);
    } catch { console.log(`  ${t}: table not found`); }
  }
  // Check audits - what's in report_json
  const a = (await db.execute({ sql: "SELECT id, report_id, input_hash, total_billed, created_at FROM audits LIMIT 2", args: [] })).rows;
  console.log("\n=== SAMPLE AUDIT RECORDS ===");
  a.forEach((r: any) => console.log(`  id=${r.id}, hash=${r.input_hash?.slice(0,20)}..., billed=$${r.total_billed}`));
}
m();
