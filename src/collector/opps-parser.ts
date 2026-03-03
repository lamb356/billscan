import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { hashFile } from '../utils/hash.js';

/**
 * OPPS Addendum B CSV format (CY 2026):
 * Header row: HCPCS Code,Short Descriptor,APC,SI,Relative Weight,Payment Rate,...
 */

export interface OPPSRate {
  hcpcsCode: string;
  shortDesc: string | null;
  apc: string | null;
  si: string | null;
  relativeWeight: number | null;
  paymentRate: number;
  minUnadjusted: number | null;
  notes: string | null;
  effectiveYear: number;
}

interface OPPSParseResult {
  rates: OPPSRate[];
  rawHash: string;
  totalParsed: number;
  totalSkipped: number;
}

export async function parseOppsCsv(csvPath: string, effectiveYear: number): Promise<OPPSParseResult> {
  const rawHash = await hashFile(csvPath);
  const rates: OPPSRate[] = [];
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

    if (!headerFound) {
      const upper = line.toUpperCase();
      if (upper.includes('HCPCS') && upper.includes('PAYMENT RATE')) {
        const cols = parseCsvLine(line);
        for (let i = 0; i < cols.length; i++) {
          headerMap[cols[i].trim().toUpperCase()] = i;
        }
        headerFound = true;
        console.log(`[opps-parser] Header found at line ${lineNum}: ${cols.length} columns`);
        continue;
      }
      continue;
    }

    const fields = parseCsvLine(line);
    if (fields.length < 4) continue;

    const hcpcsCode = getCol(fields, headerMap, 'HCPCS CODE')?.trim();
    if (!hcpcsCode || !/^[A-Z0-9]{5}$/i.test(hcpcsCode)) continue;

    const paymentRate = parseRate(getCol(fields, headerMap, 'PAYMENT RATE'));
    if (paymentRate === null || paymentRate <= 0) {
      totalSkipped++;
      continue;
    }

    rates.push({
      hcpcsCode: hcpcsCode.toUpperCase(),
      shortDesc: getCol(fields, headerMap, 'SHORT DESCRIPTOR')?.trim() || null,
      apc: getCol(fields, headerMap, 'APC')?.trim() || null,
      si: getCol(fields, headerMap, 'SI')?.trim() || null,
      relativeWeight: parseRate(getCol(fields, headerMap, 'RELATIVE WEIGHT')),
      paymentRate,
      minUnadjusted: parseRate(getCol(fields, headerMap, 'MIN UNADJUSTED COPAYMENT')),
      notes: getCol(fields, headerMap, 'NOTES')?.trim() || null,
      effectiveYear,
    });
  }

  console.log(`[opps-parser] Done: ${rates.length} rates parsed (skipped ${totalSkipped} zero-rate rows)`);
  if (rates.length === 0) {
    throw new Error(`[opps-parser] No valid rates parsed from ${csvPath}`);
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
