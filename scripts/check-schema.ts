import { getDb } from '../src/db/connection.js';
async function main() {
  const db = getDb();
  const pfsInfo = (await db.execute({ sql: "PRAGMA table_info(cms_rates)", args: [] })).rows;
  console.log("=== PFS columns ===");
  pfsInfo.forEach((r: any) => console.log(`  ${r.name} (${r.type})`));
  
  const sample = (await db.execute({ sql: "SELECT * FROM cms_rates WHERE cpt_code='72100' LIMIT 3", args: [] })).rows;
  console.log("\n=== Sample CPT 72100 ===");
  sample.forEach((r: any) => console.log(JSON.stringify(r)));
  
  const oppsInfo = (await db.execute({ sql: "PRAGMA table_info(opps_rates)", args: [] })).rows;
  console.log("\n=== OPPS columns ===");
  oppsInfo.forEach((r: any) => console.log(`  ${r.name} (${r.type})`));
  
  const tables = (await db.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table'", args: [] })).rows;
  console.log("\n=== All tables ===");
  tables.forEach((r: any) => console.log(`  ${r.name}`));
}
main().catch(console.error);
