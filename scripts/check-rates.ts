import { getDb } from '../src/db/connection.js';
async function main() {
  const db = getDb();
  
  // Check OPPS for 72100
  const opps = (await db.execute({ sql: "SELECT * FROM opps_rates WHERE hcpcs_code='72100' LIMIT 2", args: [] })).rows;
  console.log("=== OPPS 72100 ===");
  opps.forEach((r: any) => console.log(JSON.stringify(r)));
  
  // Check if PFS has facility vs non-facility difference for common E&M codes
  const em = (await db.execute({ sql: "SELECT cpt_code, facility_rate, non_facility_rate, locality FROM cms_rates WHERE cpt_code IN ('99213','99214','99215') AND locality='00' LIMIT 5", args: [] })).rows;
  console.log("\n=== PFS E&M codes (locality 00) ===");
  em.forEach((r: any) => console.log(`  ${r.cpt_code}: facility=$${r.facility_rate}, non_facility=$${r.non_facility_rate}`));
  
  // Check tables list again for zip_locality
  const tables = (await db.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%zip%' OR name LIKE '%ncci%' OR name LIKE '%bundle%' OR name LIKE '%charity%' OR name LIKE '%opps%'", args: [] })).rows;
  console.log("\n=== Relevant tables ===");
  tables.forEach((r: any) => console.log(`  ${r.name}`));
  
  // Count OPPS
  const oppsCount = (await db.execute({ sql: "SELECT COUNT(*) as c FROM opps_rates", args: [] })).rows[0];
  console.log("\nOPPS rows:", (oppsCount as any).c);
}
main().catch(console.error);
