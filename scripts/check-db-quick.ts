import { getDb } from '../src/db/connection.js';

async function main() {
  const db = getDb();
  const tables = ['cms_rates', 'clfs_rates', 'opps_rates', 'asp_rates', 'zip_locality', 'charity_hospitals'];
  for (const t of tables) {
    try {
      const r = await db.execute({ sql: `SELECT COUNT(*) as c FROM ${t}`, args: [] });
      console.log(`${t}: ${(r.rows[0] as any).c}`);
    } catch {
      console.log(`${t}: not found`);
    }
  }
}
main();
