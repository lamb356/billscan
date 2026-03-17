import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { hashFile } from '../utils/hash.js';

/**
 * CLFS CSV format (CY 2026):
 * Header row: YEAR,HCPCS,MOD,EFF_DATE,INDICATOR,RATE,SHORTDESC,LONGDESC,EXTENDEDLONGDESC,
 * Data rows start after 4 preamble lines + header
 */

export interface CLFSRate {
  hcpcsCode: string;
  modifier: string | null;
  rate: number;
  shortDesc: string | null;
  longDesc: string | null;
  indicator: string | null;
  effectiveDate: string | null;
  effectiveYear: number;
}

interface CLFSParseResult {
  rates: CLFSRate[];
  rawHash: string;
  totalParsed: number;
  totalSkipped: number;
}

export async function parseClfsCsv(csvPath: string, effectiveYear: number): Promise<CLFSParseResult> {
  const rawHash = await hashFile(csvPath);
  const rates: CLFSRate[] = [];
  let headerFound = false;
  let headerMap: Record<string, number> = {};
  let totalSkipped = 0;
  let lineNum = 0;

  const rl = createInterface({
    input: createReadStream(csvPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    // Find the header row
    if (!headerFound) {
      const upper = line.toUpperCase();
      if (upper.includes('YEAR') && upper.includes('HCPCS') && upper.includes('RATE')) {
        const cols = parseCsvLine(line);
        for (let i = 0; i < cols.length; i++) {
          headerMap[cols[i].trim().toUpperCase()] = i;
        }
        headerFound = true;
        console.log(`[clfs-parser] Header found at line ${lineNum}: ${cols.length} columns`);
        continue;
      }
      continue;
    }

    const fields = parseCsvLine(line);
    if (fields.length < 6) continue;

    const hcpcsCode = getCol(fields, headerMap, 'HCPCS')?.trim();
    if (!hcpcsCode) continue;

    const rateStr = getCol(fields, headerMap, 'RATE')?.trim();
    const rate = parseRate(rateStr);
    if (rate === null || rate === 0) {
      totalSkipped++;
      continue;
    }

    rates.push({
      hcpcsCode,
      modifier: getCol(fields, headerMap, 'MOD')?.trim() || null,
      rate,
      shortDesc: getCol(fields, headerMap, 'SHORTDESC')?.trim() || null,
      longDesc: getCol(fields, headerMap, 'LONGDESC')?.trim() || null,
      indicator: getCol(fields, headerMap, 'INDICATOR')?.trim() || null,
      effectiveDate: getCol(fields, headerMap, 'EFF_DATE')?.trim() || null,
      effectiveYear,
    });
  }

  console.log(`[clfs-parser] Done: ${rates.length} rates parsed (skipped ${totalSkipped} zero-rate rows)`);
  if (rates.length === 0) {
    throw new Error(`[clfs-parser] No valid rates parsed from ${csvPath}`);
  }

  return { rates, rawHash, totalParsed: rates.length, totalSkipped };
}

function getCol(fields: string[], headerMap: Record<string, number>, colName: string): string | null {
  const idx = headerMap[colName];
  if (idx === undefined || idx >= fields.length) return null;
  return fields[idx];
}

function parseRate(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, '').trim();
  if (cleaned === '' || cleaned === '.' || cleaned === 'NA') return null;
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
          if (end + 1 < len && line[end + 1] === '"') {
            end += 2;
            continue;
          }
          break;
        }
        end++;
      }
      fields.push(line.slice(pos + 1, end).replace(/""/g, '"'));
      pos = end + 2;
    } else {
      const comma = line.indexOf(',', pos);
      if (comma === -1) {
        fields.push(line.slice(pos));
        break;
      }
      fields.push(line.slice(pos, comma));
      pos = comma + 1;
    }
  }
  return fields;
}
