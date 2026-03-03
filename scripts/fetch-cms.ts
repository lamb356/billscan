import { fetchCmsData } from '../src/collector/cms-fetcher.js';
import { parseCmsCsv } from '../src/collector/cms-parser.js';
import { importCmsRates } from '../src/collector/cms-importer.js';
import { basename } from 'node:path';

const year = parseInt(process.argv[2] ?? '2026');
const refresh = process.argv.includes('--refresh');

console.log(`\n=== BillScan CMS Fetcher ===`);
console.log(`Fetching CMS PFS data for year: ${year}`);
console.log(`Force refresh: ${refresh}\n`);

try {
  // Step 1: Fetch
  console.log('Step 1: Downloading CMS data...');
  const { csvPath, sourceUrl } = await fetchCmsData(year, refresh);
  console.log(`  Downloaded to: ${csvPath}`);
  console.log(`  Source URL: ${sourceUrl}\n`);

  // Step 2: Parse
  console.log('Step 2: Parsing CSV...');
  const { rates, rawHash, totalParsed, totalSkipped } = await parseCmsCsv(csvPath, year);
  console.log(`  Parsed: ${totalParsed} rates`);
  console.log(`  Skipped: ${totalSkipped} invalid rows`);
  console.log(`  Hash: ${rawHash}\n`);

  // Step 3: Import
  console.log('Step 3: Importing to database...');
  const { snapshotId, rowCount, cached } = importCmsRates(
    rates, sourceUrl, year, rawHash, basename(csvPath), refresh
  );
  console.log(`  Snapshot ID: ${snapshotId}`);
  console.log(`  Rows imported: ${rowCount}`);
  console.log(`  Cached: ${cached}\n`);

  console.log(`✅ Done! ${rowCount} CMS rates ready for auditing.`);
} catch (err) {
  console.error(`\n❌ Error: ${(err as Error).message}`);
  process.exit(1);
}
