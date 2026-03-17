import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { hashFile } from '../utils/hash.js';

/**
 * OPPS Addendum B CSV format (CY 2026):
 * Header row: HCPCS Code,Short Descriptor,SI,APC,Relative Weight,Payment Rate,...
 * Data rows start after 6 preamble lines
 */

export interface OPPSRate {
  hcpcsCode: string;
  shortDesc: string | null;
  statusIndicator: string | null;
  apc: string | null;
  relativeWeight: number | null;
  paymentRate: number | null;
  nationalCopay: number | null;
  minCopay: number | null;
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
      const cols = parseCsvLine(line);
      // The actual header row starts with "HCPCS Code" as the first column
      const firstCol = cols[0]?.trim().toUpperCase();
      if (firstCol === 'HCPCS CODE' && cols.length >= 6) {
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
    if (fields.length < 3) continue;

    const hcpcsCode = getCol(fields, headerMap, 'HCPCS CODE')?.trim();
    if (!hcpcsCode || hcpcsCode.length < 4 || hcpcsCode.length > 7) continue;
    if (!/^[A-Z0-9]/i.test(hcpcsCode)) continue;

    const paymentRate = parseRate(getCol(fields, headerMap, 'PAYMENT RATE'));
    const relativeWeight = parseRate(getCol(fields, headerMap, 'RELATIVE WEIGHT'));

    // OPPS has many codes with no payment rate (status indicator E1, N, etc.)
    // We keep them all so the matcher knows the code exists even without a rate.
    rates.push({
      hcpcsCode: hcpcsCode.toUpperCase(),
      shortDesc: getCol(fields, headerMap, 'SHORT DESCRIPTOR')?.trim() || null,
      statusIndicator: getCol(fields, headerMap, 'SI')?.trim() || null,
      apc: getCol(fields, headerMap, 'APC')?.trim() || null,
      relativeWeight,
      paymentRate,
      nationalCopay: parseRate(getCol(fields, headerMap, 'NATIONAL UNADJUSTED COPAYMENT')),
      minCopay: parseRate(getCol(fields, headerMap, 'MINIMUM UNADJUSTED COPAYMENT')),
      effectiveYear,
    });
  }

  console.log(`[opps-parser] Done: ${rates.length} rates parsed (skipped ${totalSkipped})`);
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
