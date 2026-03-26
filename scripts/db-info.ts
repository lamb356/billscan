import { getDb } from '../src/db/connection.js';
async function main() {
  const db = getDb();
  const t = (await db.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", args: [] })).rows;
  console.log("Tables:", t.map((r:any) => r.name).join(', '));
  const a = (await db.execute({ sql: "PRAGMA table_info(audits)", args: [] })).rows;
  console.log("Audits schema:", a.map((r:any) => `${r.name}(${r.type})`).join(', '));
  const cnt = (await db.execute({ sql: "SELECT COUNT(*) as c FROM audits", args: [] })).rows[0];
  console.log("Audits count:", (cnt as any).c);
}
main();
