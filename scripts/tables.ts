import { getDb } from '../src/db/connection.js';
async function m() {
  const db = getDb();
  const t = (await db.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", args: [] })).rows;
  for (const r of t) {
    const c = (await db.execute({ sql: `SELECT COUNT(*) as c FROM ${(r as any).name}`, args: [] })).rows[0];
    console.log(`  ${(r as any).name}: ${(c as any).c} rows`);
  }
}
m();
