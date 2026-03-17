import { createClient } from '@libsql/client';

const db = createClient({ url: 'file:data/billscan.db' });

async function main() {
  // Check if descriptions exist in cms_rates
  const withDesc = await db.execute({ 
    sql: "SELECT COUNT(*) as c FROM cms_rates WHERE description IS NOT NULL AND description != ''", 
    args: [] 
  });
  console.log('Rows with descriptions:', (withDesc.rows[0] as any).c);

  const withoutDesc = await db.execute({ 
    sql: "SELECT COUNT(*) as c FROM cms_rates WHERE description IS NULL OR description = ''", 
    args: [] 
  });
  console.log('Rows without descriptions:', (withoutDesc.rows[0] as any).c);

  // Sample descriptions
  const samples = await db.execute({
    sql: "SELECT DISTINCT cpt_code, description FROM cms_rates WHERE description IS NOT NULL AND description != '' LIMIT 20",
    args: []
  });
  console.log('\nSample descriptions:');
  for (const r of samples.rows) {
    console.log(`  ${(r as any).cpt_code}: ${(r as any).description}`);
  }

  // Check CLFS/ASP/OPPS for descriptions  
  for (const table of ['clfs_rates', 'asp_rates', 'opps_rates']) {
    try {
      const schema = await db.execute({ sql: `PRAGMA table_info(${table})`, args: [] });
      const cols = schema.rows.map((r: any) => r.name);
      console.log(`\n${table} columns:`, cols);
      
      const sample = await db.execute({ sql: `SELECT * FROM ${table} LIMIT 2`, args: [] });
      if (sample.rows.length > 0) {
        console.log(`  Sample:`, JSON.stringify(sample.rows[0], null, 2));
      }
    } catch (e) {
      console.log(`${table}: error -`, (e as Error).message);
    }
  }

  // Count distinct CPT codes
  const distinct = await db.execute({
    sql: "SELECT COUNT(DISTINCT cpt_code) as c FROM cms_rates",
    args: []
  });
  console.log('\nDistinct CPT codes in PFS:', (distinct.rows[0] as any).c);
}

main();
