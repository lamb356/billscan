/**
 * import-charity-hospitals.ts
 *
 * Imports nonprofit hospital data into the charity_hospitals table from two sources:
 *   1. Community Benefit Insight (CBI) API — ~3,500 hospitals with real EINs
 *   2. CMS Provider of Services (POS) Q4 2025 file — ~5,300 nonprofit hospitals
 *
 * Strategy:
 *   - Use CBI as the primary source (has EINs and is curated for nonprofit status)
 *   - Supplement with CMS POS hospitals that aren't already in CBI
 *   - For CMS-only hospitals, derive a synthetic EIN key from CMS provider number
 *
 * Sources:
 *   CBI API: https://www.communitybenefitinsight.org/api/get_hospitals.php
 *   CMS POS: https://data.cms.gov/sites/default/files/2026-01/c500f848-83b3-4f29-a677-562243a2f23b/Hospital_and_other.DATA.Q4_2025.csv
 */

import Database from 'better-sqlite3';
import { mkdirSync, createReadStream, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/billscan.db');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HospitalRecord {
  ein: string;
  name: string;
  city: string;
  state: string;
  zip_code: string;
  fap_url: string;
  source: 'cbi' | 'cms';
}

interface CbiHospital {
  hospital_id: string;
  ein: string;
  name: string;
  city: string;
  state: string;
  zip_code: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEin(raw: string): string {
  // CBI returns EINs without dashes, sometimes with leading zeros
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) {
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }
  return raw.trim();
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function cleanZip(zip: string): string {
  // Standardize to 5-digit ZIP
  const clean = zip.trim().replace(/\D/g, '');
  return clean.length >= 5 ? clean.slice(0, 5) : clean;
}

// ---------------------------------------------------------------------------
// Source 1: Community Benefit Insight API
// ---------------------------------------------------------------------------

async function fetchCbiHospitals(): Promise<HospitalRecord[]> {
  console.log('Fetching Community Benefit Insight hospital data...');
  const url = 'https://www.communitybenefitinsight.org/api/get_hospitals.php';
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CBI API error: ${response.status} ${response.statusText}`);
  }
  
  const data = (await response.json()) as CbiHospital[];
  console.log(`  CBI returned ${data.length} hospitals`);
  
  const records: HospitalRecord[] = [];
  for (const h of data) {
    const ein = h.ein ? normalizeEin(h.ein) : '';
    if (!ein || !h.name?.trim()) continue;
    
    records.push({
      ein,
      name: cleanName(h.name),
      city: (h.city || '').trim(),
      state: (h.state || '').trim().toUpperCase(),
      zip_code: cleanZip(h.zip_code || ''),
      fap_url: '',
      source: 'cbi',
    });
  }
  
  console.log(`  Parsed ${records.length} valid CBI records`);
  return records;
}

// ---------------------------------------------------------------------------
// Source 2: CMS Provider of Services (POS) Q4 2025 File
// ---------------------------------------------------------------------------

async function fetchCmsPosHospitals(): Promise<HospitalRecord[]> {
  const CMS_POS_URL =
    'https://data.cms.gov/sites/default/files/2026-01/c500f848-83b3-4f29-a677-562243a2f23b/Hospital_and_other.DATA.Q4_2025.csv';
  
  // Cache file path
  const cacheDir = resolve(__dirname, '../data');
  const cachePath = resolve(cacheDir, 'pos_q4_2025.csv');
  
  // Download if not cached
  if (!existsSync(cachePath)) {
    console.log('Downloading CMS POS Q4 2025 file (~50MB)...');
    mkdirSync(cacheDir, { recursive: true });
    
    const response = await fetch(CMS_POS_URL);
    if (!response.ok) {
      throw new Error(`CMS POS download error: ${response.status} ${response.statusText}`);
    }
    
    const { createWriteStream } = await import('node:fs');
    const writer = createWriteStream(cachePath);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    
    let downloaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
      downloaded += value.length;
      if (downloaded % (10 * 1024 * 1024) < value.length) {
        process.stdout.write(`  Downloaded ${Math.round(downloaded / 1024 / 1024)}MB...\r`);
      }
    }
    writer.end();
    console.log(`\n  Saved to ${cachePath}`);
  } else {
    console.log(`Using cached CMS POS file: ${cachePath}`);
  }
  
  return parseCmsPosFile(cachePath);
}

function parseCmsPosFile(filePath: string): Promise<HospitalRecord[]> {
  return new Promise((resolve_fn, reject) => {
    console.log('Parsing CMS POS file for nonprofit hospitals...');
    
    const records: HospitalRecord[] = [];
    let headerParsed = false;
    let colIdx: Record<string, number> = {};
    let lineCount = 0;
    
    // Nonprofit control type codes:
    //   01 = Church (nonprofit)
    //   02 = Private (not for profit) / voluntary nonprofit
    //   03 = Other (nonprofit)
    const NONPROFIT_CONTROL_CODES = new Set(['01', '02', '03']);
    const HOSPITAL_CATEGORY_CODE = '01';
    
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'latin1' }),
      crlfDelay: Infinity,
    });
    
    rl.on('line', (line) => {
      lineCount++;
      
      // Parse CSV line (simple split — CMS POS doesn't use quoted commas)
      const fields = line.split(',');
      
      if (!headerParsed) {
        fields.forEach((col, i) => {
          colIdx[col.trim()] = i;
        });
        headerParsed = true;
        return;
      }
      
      const prvdrCategory = (fields[colIdx['PRVDR_CTGRY_CD']] || '').trim();
      const controlType = (fields[colIdx['GNRL_CNTL_TYPE_CD']] || '').trim();
      
      // Filter: hospitals only, nonprofit control types only
      if (prvdrCategory !== HOSPITAL_CATEGORY_CODE) return;
      if (!NONPROFIT_CONTROL_CODES.has(controlType)) return;
      
      const facName = (fields[colIdx['FAC_NAME']] || '').trim();
      const city = (fields[colIdx['CITY_NAME']] || '').trim();
      const state = (fields[colIdx['STATE_CD']] || '').trim().toUpperCase();
      const zip = cleanZip(fields[colIdx['ZIP_CD']] || '');
      const prvdrNum = (fields[colIdx['PRVDR_NUM']] || '').trim();
      
      if (!facName) return;
      
      // Use CMS certification number as a synthetic EIN key for CMS-only hospitals
      // Format: CMS-XXXXXX to distinguish from real EINs
      const einKey = prvdrNum ? `CMS-${prvdrNum}` : '';
      if (!einKey) return;
      
      records.push({
        ein: einKey,
        name: cleanName(facName),
        city,
        state,
        zip_code: zip,
        fap_url: '',
        source: 'cms',
      });
    });
    
    rl.on('close', () => {
      console.log(`  Read ${lineCount} lines, found ${records.length} nonprofit hospitals`);
      resolve_fn(records);
    });
    
    rl.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Merge: CBI (with real EINs) + CMS (supplemental)
// ---------------------------------------------------------------------------

function mergeHospitals(
  cbiRecords: HospitalRecord[],
  cmsRecords: HospitalRecord[]
): HospitalRecord[] {
  console.log('\nMerging datasets...');
  
  // Index CBI records by normalized name+state for deduplication
  const cbiByNameState = new Map<string, HospitalRecord>();
  const cbiByEin = new Map<string, HospitalRecord>();
  
  for (const h of cbiRecords) {
    const key = `${h.name.toUpperCase()}|${h.state}`;
    cbiByNameState.set(key, h);
    if (h.ein) cbiByEin.set(h.ein, h);
  }
  
  // Add CMS records that don't appear in CBI (matched by name+state)
  let supplemented = 0;
  const cmsOnlyRecords: HospitalRecord[] = [];
  
  for (const h of cmsRecords) {
    const key = `${h.name.toUpperCase()}|${h.state}`;
    if (!cbiByNameState.has(key)) {
      cmsOnlyRecords.push(h);
      supplemented++;
    }
  }
  
  const merged = [...cbiRecords, ...cmsOnlyRecords];
  
  console.log(`  CBI records: ${cbiRecords.length}`);
  console.log(`  CMS-only additional records: ${supplemented}`);
  console.log(`  Total merged: ${merged.length}`);
  
  return merged;
}

// ---------------------------------------------------------------------------
// Database Import
// ---------------------------------------------------------------------------

function importToDatabase(hospitals: HospitalRecord[]): void {
  console.log('\nImporting to SQLite database...');
  
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  
  // Ensure table exists (matches schema in migrations.ts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS charity_hospitals (
      ein        TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      city       TEXT,
      state      TEXT,
      zip_code   TEXT,
      fap_url    TEXT,
      last_updated TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_charity_state ON charity_hospitals(state);
    CREATE INDEX IF NOT EXISTS idx_charity_zip ON charity_hospitals(zip_code);
  `);
  
  // Clear existing data (seed + any previous imports)
  const existingCount = (db.prepare('SELECT COUNT(*) as c FROM charity_hospitals').get() as { c: number }).c;
  console.log(`  Existing rows: ${existingCount} — clearing...`);
  db.prepare('DELETE FROM charity_hospitals').run();
  
  // Bulk insert with upsert
  const upsert = db.prepare(`
    INSERT INTO charity_hospitals (ein, name, city, state, zip_code, fap_url, last_updated)
    VALUES (@ein, @name, @city, @state, @zip_code, @fap_url, datetime('now'))
    ON CONFLICT(ein) DO UPDATE SET
      name         = excluded.name,
      city         = excluded.city,
      state        = excluded.state,
      zip_code     = excluded.zip_code,
      fap_url      = excluded.fap_url,
      last_updated = excluded.last_updated
  `);
  
  const insertMany = db.transaction((records: HospitalRecord[]) => {
    let inserted = 0;
    for (const r of records) {
      upsert.run({
        ein: r.ein,
        name: r.name,
        city: r.city,
        state: r.state,
        zip_code: r.zip_code,
        fap_url: r.fap_url,
      });
      inserted++;
    }
    return inserted;
  });
  
  const inserted = insertMany(hospitals);
  console.log(`  Inserted ${inserted} records`);
  
  db.close();
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function generateReport(hospitals: HospitalRecord[]): string {
  const byState = new Map<string, number>();
  const bySource = new Map<string, number>();
  
  for (const h of hospitals) {
    byState.set(h.state, (byState.get(h.state) || 0) + 1);
    bySource.set(h.source, (bySource.get(h.source) || 0) + 1);
  }
  
  const sortedStates = [...byState.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  
  let report = `\n${'='.repeat(60)}\n`;
  report += `CHARITY HOSPITAL IMPORT REPORT\n`;
  report += `Generated: ${new Date().toISOString()}\n`;
  report += `${'='.repeat(60)}\n\n`;
  report += `TOTAL IMPORTED: ${hospitals.length}\n\n`;
  report += `By Source:\n`;
  for (const [source, count] of bySource.entries()) {
    const label = source === 'cbi'
      ? 'Community Benefit Insight (real EINs)'
      : 'CMS POS Q4 2025 (CMS provider # as key)';
    report += `  ${label}: ${count}\n`;
  }
  report += `\nBy State:\n`;
  for (const [state, count] of sortedStates) {
    if (state) report += `  ${state}: ${count}\n`;
  }
  
  return report;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== BillScan Charity Hospital Importer ===\n');
  
  try {
    // Fetch from both sources in parallel
    const [cbiHospitals, cmsHospitals] = await Promise.all([
      fetchCbiHospitals(),
      fetchCmsPosHospitals(),
    ]);
    
    // Merge
    const merged = mergeHospitals(cbiHospitals, cmsHospitals);
    
    // Import
    importToDatabase(merged);
    
    // Report
    const report = generateReport(merged);
    console.log(report);
    
    // Save report file
    const { writeFileSync } = await import('node:fs');
    const reportPath = resolve(__dirname, '../../charity-hospital-results.txt');
    writeFileSync(reportPath, report, 'utf-8');
    console.log(`Report saved to: ${reportPath}`);
    
    // Final verification
    const db = new Database(DB_PATH);
    const finalCount = (db.prepare('SELECT COUNT(*) as c FROM charity_hospitals').get() as { c: number }).c;
    const realEinCount = (db.prepare("SELECT COUNT(*) as c FROM charity_hospitals WHERE ein NOT LIKE 'CMS-%'").get() as { c: number }).c;
    const cmsCount = (db.prepare("SELECT COUNT(*) as c FROM charity_hospitals WHERE ein LIKE 'CMS-%'").get() as { c: number }).c;
    const sampleRows = db.prepare('SELECT ein, name, city, state FROM charity_hospitals LIMIT 5').all();
    db.close();
    
    console.log(`\nVerification — Final DB row count: ${finalCount}`);
    console.log(`  With real EINs: ${realEinCount}`);
    console.log(`  With CMS provider # keys: ${cmsCount}`);
    console.log(`  (Note: CBI has ${cbiHospitals.length} hospitals; ${cbiHospitals.length - realEinCount} share EINs with other facilities in same system)`);
    console.log('Sample rows:');
    for (const row of sampleRows) {
      console.log(`  ${JSON.stringify(row)}`);
    }
    
    console.log('\n=== Import complete ===');
  } catch (err) {
    console.error('Import failed:', err);
    process.exit(1);
  }
}

await main();
