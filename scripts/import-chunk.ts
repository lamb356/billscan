// Chunked import — processes N lines at a time from a given offset
// Usage: npx tsx scripts/import-chunk.ts --offset=0 --limit=100000 --year=2026

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { getDb, closeDb } from '../src/db/connection.js';
import { hashFile } from '../src/utils/hash.js';
import { CMSRateSchema } from '../src/schema/cms.js';
import type { CMSRate } from '../src/schema/cms.js';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => a.replace('--', '').split('='))
);

const OFFSET = parseInt(args.offset ?? '0');
const LIMIT = parseInt(args.limit ?? '100000');
const YEAR = parseInt(args.year ?? '2026');
const FORCE = args.force === 'true';
const DATA_DIR = join(process.cwd(), 'data');
const CSV_PATH = join(DATA_DIR, `cms-pfs-${YEAR}.csv`);
const SOURCE_URL = `https://www.cms.gov/files/zip/${YEAR}-npimdfs-anwrvu.zip`;

console.log(`\n=== BillScan Chunked Importer ===`);
console.log(`CSV: ${CSV_PATH}`);
console.log(`Offset: ${OFFSET} | Limit: ${LIMIT} | Year: ${YEAR}\n`);

const EXPECTED_HEADERS = ['HCPCS', 'MOD', 'PAR FAC PE RVU'];

async function importChunk() {
  const db = getDb();

  // Check if already imported (unless force)
  const rawHash = await hashFile(CSV_PATH);

  if (!FORCE) {
    const existing = db.prepare('SELECT id FROM cms_snapshots WHERE data_hash = ?').get(rawHash) as any;
    if (existing) {
      const count = db.prepare('SELECT COUNT(*) as c FROM cms_rates WHERE snapshot_id = ?').get(existing.id) as any;
      if (count.c > 0) {
        console.log(`Already imported (snapshot #${existing.id}, ${count.c} rates). Use --force=true to reimport.`);
        closeDb();
        return;
      }
    }
  }

  // Create snapshot if needed
  let snapshotId: number;
  const existing = db.prepare('SELECT id FROM cms_snapshots WHERE data_hash = ?').get(rawHash) as any;
  if (existing) {
    snapshotId = existing.id;
    console.log(`Using existing snapshot #${snapshotId}`);
  } else {
    const fileName = `cms-pfs-${YEAR}.csv`;
    const result = db.prepare(
      'INSERT INTO cms_snapshots (source_url, file_name, effective_year, data_hash) VALUES (?, ?, ?, ?)'
    ).run(SOURCE_URL, fileName, YEAR, rawHash);
    snapshotId = result.lastInsertRowid as number;
    console.log(`Created snapshot #${snapshotId}`);
  }

  // Parse CSV
  let headerFound = false;
  let headerMap: Record<string, number> = {};
  let dataLineNum = 0;
  let imported = 0;
  let skipped = 0;

  const rates: CMSRate[] = [];

  const rl = createInterface({
    input: createReadStream(CSV_PATH, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (!headerFound) {
      const upper = line.toUpperCase();
      if (EXPECTED_HEADERS.every(h => upper.includes(h))) {
        const cols = parseCsvLine(line);
        for (let i = 0; i < cols.length; i++) {
          headerMap[cols[i].trim().toUpperCase()] = i;
        }
        headerFound = true;
        console.log(`Header found: ${cols.length} columns`);
        continue;
      }
      continue;
    }

    dataLineNum++;
    if (dataLineNum <= OFFSET) continue;
    if (dataLineNum > OFFSET + LIMIT) break;

    const fields = parseCsvLine(line);
    if (fields.length < 5) { skipped++; continue; }

    const hcpcsCode = getCol(fields, headerMap, 'HCPCS')?.trim();
    if (!hcpcsCode || !/^[A-Z0-9]{5}$/i.test(hcpcsCode)) { skipped++; continue; }

    const facilityRate = parseRate(getCol(fields, headerMap, 'PAR FAC PE RVU'));
    const nonFacilityRate = parseRate(getCol(fields, headerMap, 'PAR NFAC PE RVU'));

    if (facilityRate === null && nonFacilityRate === null) { skipped++; continue; }

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
      rates.push(rate);
    } catch { skipped++; }
  }

  // Bulk insert
  const insertRate = db.prepare(`
    INSERT INTO cms_rates
      (snapshot_id, hcpcs_code, modifier, description, facility_rate, non_facility_rate, locality_code, status_code, effective_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rates: CMSRate[]) => {
    for (const r of rates) {
      insertRate.run(
        snapshotId, r.hcpcsCode, r.modifier ?? null, r.description ?? null,
        r.facilityRate ?? null, r.nonFacilityRate ?? null,
        r.localityCode ?? null, r.statusCode ?? null, r.effectiveYear
      );
      imported++;
    }
  });

  insertMany(rates);

  console.log(`\nChunk imported: ${imported} rates (skipped ${skipped})`);
  console.log(`Offset ${OFFSET} to ${OFFSET + LIMIT} processed.`);

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

await importChunk();
