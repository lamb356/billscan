import { parseClfsCsv } from '../src/collector/clfs-parser.js';
import { parseAspCsv } from '../src/collector/asp-parser.js';
import { parseOppsCsv } from '../src/collector/opps-parser.js';
import { importClfsRates, importAspRates, importOppsRates } from '../src/collector/multi-importer.js';
import { seedZipLocality } from '../src/matcher/zip-locality.js';
import { seedCharityHospitals } from '../src/analyzer/charity-care.js';
import { closeDb } from '../src/db/connection.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const YEAR = parseInt(process.argv[2] ?? '2026');
const DATA_DIR = join(process.cwd(), 'data');

console.log(`\n=== BillScan Phase 2 Data Import ===`);
console.log(`Year: ${YEAR}\n`);

try {
  // CLFS
  const clfsPath = join(DATA_DIR, `cms-clfs-${YEAR}.csv`);
  if (existsSync(clfsPath)) {
    console.log('Importing CLFS...');
    const { rates, rawHash } = await parseClfsCsv(clfsPath, YEAR);
    const { rowCount } = importClfsRates(rates, `cms-clfs-${YEAR}`, YEAR, rawHash, `cms-clfs-${YEAR}.csv`);
    console.log(`✅ CLFS: ${rowCount} lab rates imported`);
  } else {
    console.log(`⚠️  CLFS CSV not found: ${clfsPath}`);
  }

  // ASP
  const aspPath = join(DATA_DIR, `cms-asp-${YEAR}.csv`);
  if (existsSync(aspPath)) {
    console.log('Importing ASP...');
    const { rates, rawHash } = await parseAspCsv(aspPath, YEAR);
    const { rowCount } = importAspRates(rates, `cms-asp-${YEAR}`, YEAR, rawHash, `cms-asp-${YEAR}.csv`);
    console.log(`✅ ASP: ${rowCount} drug rates imported`);
  } else {
    console.log(`⚠️  ASP CSV not found: ${aspPath}`);
  }

  // OPPS
  const oppsPath = join(DATA_DIR, `cms-opps-${YEAR}.csv`);
  if (existsSync(oppsPath)) {
    console.log('Importing OPPS...');
    const { rates, rawHash } = await parseOppsCsv(oppsPath, YEAR);
    const { rowCount } = importOppsRates(rates, `cms-opps-${YEAR}`, YEAR, rawHash, `cms-opps-${YEAR}.csv`);
    console.log(`✅ OPPS: ${rowCount} APC rates imported`);
  } else {
    console.log(`⚠️  OPPS CSV not found: ${oppsPath}`);
  }

  // Seed ZIP locality
  console.log('Seeding ZIP locality data...');
  seedZipLocality();
  console.log('✅ ZIP locality seeded');

  // Seed charity hospitals
  console.log('Seeding charity hospital data...');
  seedCharityHospitals();
  console.log('✅ Charity hospitals seeded');

} catch (err) {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
} finally {
  closeDb();
}
