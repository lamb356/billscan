import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { getDb, closeDb } from '../src/db/connection.js';
import { hashFile } from '../src/utils/hash.js';
import { CMSRateSchema } from '../src/schema/cms.js';
import type { CMSRate } from '../src/schema/cms.js';

const YEAR = parseInt(process.argv[2] ?? '2026');
const FORCE = process.argv.includes('--force');
const DATA_DIR = join(process.cwd(), 'data');
const CSV_PATH = join(DATA_DIR, `cms-pfs-${YEAR}.csv`);
const SOURCE_URL = `https://www.cms.gov/files/zip/${YEAR}-npimdfs-anwrvu.zip`;

console.log(`\n=== BillScan CMS Direct Importer ===`);
console.log(`Year: ${YEAR} | Force: ${FORCE}`);
console.log(`CSV: ${CSV_PATH}\n`);

const EXPECTED_HEADERS = ['HCPCS', 'MOD', 'PAR FAC PE RVU'];

async function importAll() {
  const db = getDb();
  const rawHash = await hashFile(CSV_PATH);

  // Check if already imported
  if (!FORCE) {
    const existing = db.prepare('SELECT id FROM cms_snapshots WHERE data_hash = ?').get(rawHash) as any;
    if (existing) {
      const count = db.prepare('SELECT COUNT(*) as c FROM cms_rates WHERE snapshot_id = ?').get(existing.id) as any;
      if (count.c > 0) {
        console.log(`✅ Already imported (snapshot #${existing.id}, ${count.c} rates). Use --force to reimport.`);
        closeDb();
        return;
      }
    }
  }

  // Create snapshot
  const existingSnap = db.prepare('SELECT id FROM cms_snapshots WHERE data_hash = ?').get(rawHash) as any;
  let snapshotId: number;

  if (existingSnap && !FORCE) {
    snapshotId = existingSnap.id;
  } else {
    const result = db.prepare(
      'INSERT INTO cms_snapshots (source_url, file_name, effective_year, data_hash) VALUES (?, ?, ?, ?)'
    ).run(SOURCE_URL, `cms-pfs-${YEAR}.csv`, YEAR, rawHash);
    snapshotId = result.lastInsertRowid as number;
  }

  console.log(`Snapshot ID: ${snapshotId}`);

  let headerFound = false;
  let headerMap: Record<string, number> = {};
  let totalParsed = 0;
  let totalSkipped = 0;
  const BATCH_SIZE = 50000;
  let batch: CMSRate[] = [];

  const insertRate = db.prepare(`
    INSERT INTO cms_rates
      (snapshot_id, hcpcs_code, modifier, description, facility_rate, non_facility_rate, locality_code, status_code, effective_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const flushBatch = db.transaction((rates: CMSRate[]) => {
    for (const r of rates) {
      insertRate.run(
        snapshotId, r.hcpcsCode, r.modifier ?? null, r.description ?? null,
        r.facilityRate ?? null, r.nonFacilityRate ?? null,
        r.localityCode ?? null, r.statusCode ?? null, r.effectiveYear
      );
    }
  });

  const rl = createInterface({
    input: createReadStream(CSV_PATH, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    if (!headerFound) {
      const upper = line.toUpperCase();
      if (EXPECTED_HEADERS.every(h => upper.includes(h))) {
        const cols = parseCsvLine(line);
        for (let i = 0; i < cols.length; i++) {
          headerMap[cols[i].trim().toUpperCase()] = i;
        }
        headerFound = true;
        console.log(`Header at line ${lineNum}: ${cols.length} columns`);
        continue;
      }
      continue;
    }

    const fields = parseCsvLine(line);
    if (fields.length < 5) { totalSkipped++; continue; }

    const hcpcsCode = getCol(fields, headerMap, 'HCPCS')?.trim();
    if (!hcpcsCode || !/^[A-Z0-9]{5}$/i.test(hcpcsCode)) { totalSkipped++; continue; }

    const facilityRate = parseRate(getCol(fields, headerMap, 'PAR FAC PE RVU'));
    const nonFacilityRate = parseRate(getCol(fields, headerMap, 'PAR NFAC PE RVU'));
    if (facilityRate === null && nonFacilityRate === null) { totalSkipped++; continue; }

    try {
      const rate = CMSRateSchema.parse({
        hcpcsCode: hcpcsCode.toUpperCase(),
        modifier: getCol(fields, headerMap, 'MOD')?.trim() || undefined,
        description: getCol(fields, headerMap, 'DESCRIPTION')?.trim() || undefined,
        facilityRate: facilityRate ?? undefined,
        nonFacilityRate: nonFacilityRate ?? undefined,
        localityCode: getCol(fields, headerMap, 'LOCALITY NUMBER')?.trim() || undefined,
        statusCode: getCol(fields, headerMap, 'STATUS CODE')?.trim() || undefined,
        effectiveYear: YEAR,
      });
      batch.push(rate);
      totalParsed++;

      if (batch.length >= BATCH_SIZE) {
        flushBatch(batch);
        console.log(`  Flushed batch: ${totalParsed} total rows`);
        batch = [];
      }
    } catch { totalSkipped++; }
  }

  // Final flush
  if (batch.length > 0) {
    flushBatch(batch);
  }

  console.log(`\n✅ Import complete!`);
  console.log(`  Imported: ${totalParsed} rates`);
  console.log(`  Skipped:  ${totalSkipped} rows`);
  console.log(`  Snapshot: #${snapshotId}`);

  closeDb();
}

function getCol(fields: string[], headerMap: Record<string, number>, colName: string): string | null {
  const idx = headerMap[colName];
  if (idx === undefined || idx >= fields.length) return null;
  return fields[idx];
}

function parseRate(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, '').trim();
  if (cleaned === '' || cleaned === '.') return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let pos = 0;
  const len = line.length;
  while (pos <= len) {
    if (pos < len && line[pos] === '"') {
      let end = pos + 1;
      while (end < len) {
        if (line[end] === '"') {
          if (end + 1 < len && line[end + 1] === '"') { end += 2; continue; }
          break;
        }
        end++;
      }
      fields.push(line.slice(pos + 1, end).replace(/""/g, '"'));
      pos = end + 2;
    } else {
      const comma = line.indexOf(',', pos);
      if (comma === -1) { fields.push(line.slice(pos)); break; }
      fields.push(line.slice(pos, comma));
      pos = comma + 1;
    }
  }
  return fields;
}

await importAll();
