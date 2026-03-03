import { parseClfsCsv } from '../src/collector/clfs-parser.js';
import { parseAspCsv } from '../src/collector/asp-parser.js';
import { parseOppsCsv } from '../src/collector/opps-parser.js';
import { importClfsRates, importAspRates, importOppsRates } from '../src/collector/multi-importer.js';
import { seedZipLocality } from '../src/matcher/zip-locality.js';
import { seedCharityHospitals } from '../src/analyzer/charity-care.js';
import { closeDb } from '../src/db/connection.js';

async function main() {
  const year = 2026;

  // Import CLFS
  console.log('\n=== Importing CLFS ===');
  const clfs = await parseClfsCsv('data/cms-downloads/CLFS 2026 Q1V1.csv', year);
  const clfsResult = importClfsRates(
    clfs.rates,
    'https://www.cms.gov/files/zip/26clabq1.zip',
    year,
    clfs.rawHash,
    'CLFS 2026 Q1V1.csv'
  );
  console.log(`CLFS: ${clfsResult.rowCount} rates, snapshot #${clfsResult.snapshotId}`);

  // Import ASP
  console.log('\n=== Importing ASP ===');
  const asp = await parseAspCsv('data/cms-downloads/section 508 version of January 2026 Medicare Part B Payment Limit File 121725.csv', year);
  const aspResult = importAspRates(
    asp.rates,
    'https://www.cms.gov/files/zip/january-2026-medicare-part-b-payment-limit-files.zip',
    year,
    asp.rawHash,
    'January 2026 Medicare Part B Payment Limit File.csv'
  );
  console.log(`ASP: ${aspResult.rowCount} rates, snapshot #${aspResult.snapshotId}`);

  // Import OPPS
  console.log('\n=== Importing OPPS ===');
  const opps = await parseOppsCsv('data/cms-downloads/opps-addendum-b-2026.csv', year);
  const oppsResult = importOppsRates(
    opps.rates,
    'https://www.cms.gov/files/zip/january-2026-opps-addendum-b.zip',
    year,
    opps.rawHash,
    '2026 January Web Addendum B.csv'
  );
  console.log(`OPPS: ${oppsResult.rowCount} rates, snapshot #${oppsResult.snapshotId}`);

  // Seed ZIP locality and charity data
  console.log('\n=== Seeding reference data ===');
  seedZipLocality();
  seedCharityHospitals();

  console.log('\n=== Done ===');
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
