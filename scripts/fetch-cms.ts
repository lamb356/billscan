import { fetchCmsData } from '../src/collector/cms-fetcher.js';
import { parseCmsCsvStreaming } from '../src/collector/cms-parser.js';
import { checkCmsCache, beginCmsImport } from '../src/collector/cms-importer.js';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const yearFlag = args.indexOf('--year');
const year = yearFlag >= 0 ? parseInt(args[yearFlag + 1]) : new Date().getFullYear();
const refresh = args.includes('--refresh');

console.log(`\n=== BillScan CMS Data Fetcher ===`);
console.log(`Year: ${year} | Force refresh: ${refresh}\n`);

try {
  // Check cache first
  if (!refresh) {
    const cached = checkCmsCache(year);
    if (cached) {
      console.log(`\n=== Done (cached) ===`);
      console.log(`Snapshot ID: ${cached.snapshotId}`);
      console.log(`Rows: ${cached.rowCount}`);
      console.log(`Cached: true`);
      process.exit(0);
    }
  }

  const { zipPath, csvPath, sourceUrl } = await fetchCmsData(year, refresh);
  console.log(`\nZIP: ${zipPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Source: ${sourceUrl}\n`);

  console.log(`Starting streaming parse + import...`);

  // We need the hash before we can create the snapshot, but the streaming
  // parser computes it. So we do a two-pass: hash first (fast), then stream.
  // Actually the streaming parser returns hash at the end, so let's compute hash first.
  const { hashFile } = await import('../src/utils/hash.js');
  const rawHash = await hashFile(csvPath);
  console.log(`File hash: ${rawHash}`);

  const { snapshotId, insertBatch, finalize } = beginCmsImport(
    sourceUrl, year, rawHash, basename(csvPath)
  );

  const BATCH_SIZE = 5000;
  let totalParsed = 0;

  const { totalParsed: parsed } = await parseCmsCsvStreaming(
    csvPath,
    year,
    BATCH_SIZE,
    (batch) => {
      insertBatch(batch);
      totalParsed += batch.length;
    }
  );

  finalize(parsed);

  console.log(`\n=== Done ===`);
  console.log(`Snapshot ID: ${snapshotId}`);
  console.log(`Rows: ${parsed}`);
  console.log(`Cached: false`);
} catch (err) {
  console.error(`\nFATAL: ${(err as Error).message}`);
  process.exit(1);
}
