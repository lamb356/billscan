// Chunked import — processes N lines at a time from a given offset
// Usage: npx tsx scripts/import-chunk.ts <offset> <limit>
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let pos = 0;
  const len = line.length;
  while (pos <= len) {
    if (pos < len && line[pos] === '"') {
      const end = line.indexOf('"', pos + 1);
      if (end === -1) { fields.push(line.slice(pos + 1)); break; }
      fields.push(line.slice(pos + 1, end));
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

function parseRate(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, '').trim();
  if (cleaned === '' || cleaned === '.') return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0]; // 'init', 'chunk', or 'finalize'
  const csvPath = 'data/cms-downloads/PFALL26AR.txt';
  const dbPath = resolve('data', 'billscan.db');
  const year = 2026;

  mkdirSync(dirname(dbPath), { recursive: true });

  if (mode === 'init') {
    // Create DB, schema, snapshot
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS cms_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_url TEXT NOT NULL,
        effective_year INTEGER NOT NULL, fetched_at TEXT NOT NULL,
        data_hash TEXT NOT NULL, row_count INTEGER NOT NULL,
        file_name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS cms_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES cms_snapshots(id),
        cpt_code TEXT NOT NULL, modifier TEXT, description TEXT,
        facility_rate REAL, non_facility_rate REAL, locality TEXT,
        locality_name TEXT, status_indicator TEXT,
        effective_year INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cms_rates_cpt ON cms_rates(cpt_code);
      CREATE INDEX IF NOT EXISTS idx_cms_rates_cpt_mod ON cms_rates(cpt_code, modifier);
      CREATE INDEX IF NOT EXISTS idx_cms_rates_cpt_loc ON cms_rates(cpt_code, locality);
      CREATE TABLE IF NOT EXISTS audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT UNIQUE NOT NULL,
        input_hash TEXT NOT NULL, snapshot_id INTEGER REFERENCES cms_snapshots(id),
        total_billed REAL, total_cms REAL, total_savings REAL,
        finding_count INTEGER, report_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Compute hash
    const hashStream = createReadStream(csvPath);
    const sha = createHash('sha256');
    for await (const chunk of hashStream) { sha.update(chunk); }
    const rawHash = `sha256:${sha.digest('hex')}`;

    const r = db.prepare(`
      INSERT INTO cms_snapshots (source_url, effective_year, fetched_at, data_hash, row_count, file_name)
      VALUES (?, ?, datetime('now'), ?, 0, ?)
    `).run('https://www.cms.gov/files/zip/pfrev26a-updated-12-29-2025.zip', year, rawHash, 'PFALL26AR.txt');
    
    console.log(`SNAPSHOT_ID=${Number(r.lastInsertRowid)}`);
    db.close();
    return;
  }

  if (mode === 'chunk') {
    const offset = parseInt(args[1]) || 0;
    const limit = parseInt(args[2]) || 200000;
    const snapshotId = parseInt(args[3]);

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = OFF');
    db.pragma('cache_size = -32000');

    const insert = db.prepare(`
      INSERT INTO cms_rates (snapshot_id, cpt_code, modifier, description, facility_rate, non_facility_rate, locality, locality_name, status_indicator, effective_year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const BATCH_SIZE = 5000;
    let batch: any[][] = [];
    let parsed = 0;
    let skipped = 0;
    let lineNum = 0;
    const endLine = offset + limit;

    const flushBatch = () => {
      if (batch.length === 0) return;
      const txn = db.transaction(() => {
        for (const r of batch) {
          insert.run(snapshotId, r[0], r[1], null, r[2], r[3], r[4], null, r[5], year);
        }
      });
      txn();
      batch = [];
    };

    const rl = createInterface({
      input: createReadStream(csvPath, { encoding: 'utf-8', highWaterMark: 64 * 1024 }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      lineNum++;
      if (lineNum <= offset) continue;
      if (lineNum > endLine) break;
      if (!line.trim()) continue;

      const fields = parseCsvLine(line);
      if (fields.length < 10) continue;

      const cptCode = fields[3]?.trim();
      if (!cptCode) continue;

      const facRate = parseRate(fields[5]);
      const nfRate = parseRate(fields[6]);
      if ((facRate === null || facRate === 0) && (nfRate === null || nfRate === 0)) {
        skipped++;
        continue;
      }

      batch.push([cptCode, fields[4]?.trim() || null, facRate, nfRate, fields[2]?.trim() || null, fields[9]?.trim() || null]);
      parsed++;

      if (batch.length >= BATCH_SIZE) flushBatch();
    }

    flushBatch();
    db.close();
    console.log(`CHUNK offset=${offset} limit=${limit} parsed=${parsed} skipped=${skipped}`);
    return;
  }

  if (mode === 'finalize') {
    const snapshotId = parseInt(args[1]);
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    const count = (db.prepare(`SELECT COUNT(*) as c FROM cms_rates WHERE snapshot_id = ?`).get(snapshotId) as any).c;
    db.prepare(`UPDATE cms_snapshots SET row_count = ? WHERE id = ?`).run(count, snapshotId);
    
    // Get unique CPT code count
    const uniqueCPT = (db.prepare(`SELECT COUNT(DISTINCT cpt_code) as c FROM cms_rates WHERE snapshot_id = ?`).get(snapshotId) as any).c;
    
    // Sample some rates
    const samples = db.prepare(`SELECT cpt_code, facility_rate, non_facility_rate, locality FROM cms_rates WHERE snapshot_id = ? LIMIT 5`).all(snapshotId);
    
    db.close();
    console.log(`FINALIZE snapshot=${snapshotId} total_rows=${count} unique_cpt=${uniqueCPT}`);
    console.log(`SAMPLES: ${JSON.stringify(samples)}`);
    return;
  }

  console.log('Usage: import-chunk.ts [init|chunk <offset> <limit> <snapshotId>|finalize <snapshotId>]');
}

main().catch(e => { console.error(e.message); process.exit(1); });
