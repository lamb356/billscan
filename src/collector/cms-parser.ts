import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { hashFile } from '../utils/hash.js';
import type { CMSRate } from '../schema/cms.js';

const COLUMN_ALIASES: Record<string, string[]> = {
  cptCode:          ['HCPCS', 'HCPC', 'CPT', 'HCPCS CODE'],
  modifier:         ['MOD', 'MODIFIER', 'MOD1'],
  description:      ['DESCRIPTION', 'DESC', 'SHORT DESCRIPTION'],
  facilityRate:     ['PPAR_FAC_AMOUNT', 'PPAR_FAC_FEE', 'FACILITY FEE', 'FAC_FEE', 'FACILITY_AMOUNT', 'PAR_FAC_AMOUNT'],
  nonFacilityRate:  ['PPAR_NFAC_AMOUNT', 'PPAR_NFAC_FEE', 'NON-FACILITY FEE', 'NFAC_FEE', 'NONFACILITY_AMOUNT', 'NONFAC_AMOUNT', 'PAR_NFAC_AMOUNT'],
  locality:         ['LOCALITY', 'LOC', 'CARRIER'],
  localityName:     ['LOCALITY_NAME', 'LOC_NAME', 'CARRIER_NAME', 'LOCALITY NAME'],
  statusIndicator:  ['STATUS', 'STATUS_CODE', 'STATUS_INDICATOR', 'STATUS CODE'],
};

const POS = {
  year: 0,
  carrier: 1,
  locality: 2,
  hcpcs: 3,
  modifier: 4,
  parFacAmount: 5,
  parNonFacAmount: 6,
  statusIndicator: 9,
};

interface ParseResult {
  rates: CMSRate[];
  rawHash: string;
  headerRow: string[];
}

export async function parseCmsCsvStreaming(
  csvPath: string,
  effectiveYear: number,
  batchSize: number,
  onBatch: (batch: CMSRate[]) => void
): Promise<{ rawHash: string; totalParsed: number; totalSkipped: number }> {
  const rawHash = await hashFile(csvPath);

  let batch: CMSRate[] = [];
  let totalParsed = 0;
  let skipped = 0;
  let isPositional = false;
  let headerMap: Record<string, number> = {};
  let headerFound = false;
  let lineNum = 0;
  let formatDetected = false;

  const rl = createInterface({
    input: createReadStream(csvPath, { encoding: 'utf-8', highWaterMark: 256 * 1024 }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    if (!formatDetected) {
      const upper = line.toUpperCase();
      if (upper.includes('HCPCS') || upper.includes('HCPC')) {
        const headerRow = parseCsvLine(line);
        headerMap = buildHeaderMap(headerRow);
        headerFound = true;
        formatDetected = true;
        console.log(`[cms-parser] Header format detected: ${headerRow.length} columns`);
        continue;
      }
      const fields = parseCsvLine(line);
      if (fields.length >= 10 && /^\d{4}$/.test(fields[0].trim())) {
        isPositional = true;
        formatDetected = true;
        console.log(`[cms-parser] Positional format detected (${fields.length} columns)`);
      }
    }

    if (!formatDetected) continue;

    const fields = parseCsvLine(line);
    let rate: CMSRate | null = null;

    if (isPositional) {
      if (fields.length < 10) continue;
      const cptCode = fields[POS.hcpcs]?.trim();
      if (!cptCode) continue;
      const facilityRate = parseRate(fields[POS.parFacAmount]);
      const nonFacilityRate = parseRate(fields[POS.parNonFacAmount]);
      if ((facilityRate === null || facilityRate === 0) && (nonFacilityRate === null || nonFacilityRate === 0)) { skipped++; continue; }
      rate = {
        cptCode,
        modifier: fields[POS.modifier]?.trim() || null,
        description: null,
        facilityRate,
        nonFacilityRate,
        locality: fields[POS.locality]?.trim() || null,
        localityName: null,
        statusIndicator: fields[POS.statusIndicator]?.trim() || null,
        effectiveYear,
      };
    } else if (headerFound) {
      if (fields.length < 3) continue;
      const cptCode = getField(fields, headerMap, 'cptCode')?.trim();
      if (!cptCode) continue;
      const facilityRate = parseRate(getField(fields, headerMap, 'facilityRate'));
      const nonFacilityRate = parseRate(getField(fields, headerMap, 'nonFacilityRate'));
      if ((facilityRate === null || facilityRate === 0) && (nonFacilityRate === null || nonFacilityRate === 0)) { skipped++; continue; }
      rate = {
        cptCode,
        modifier: getField(fields, headerMap, 'modifier')?.trim() || null,
        description: getField(fields, headerMap, 'description')?.trim() || null,
        facilityRate,
        nonFacilityRate,
        locality: getField(fields, headerMap, 'locality')?.trim() || null,
        localityName: getField(fields, headerMap, 'localityName')?.trim() || null,
        statusIndicator: getField(fields, headerMap, 'statusIndicator')?.trim() || null,
        effectiveYear,
      };
    }

    if (rate) {
      batch.push(rate);
      totalParsed++;
      if (batch.length >= batchSize) { onBatch(batch); batch = []; }
    }

    if (lineNum % 200000 === 0) console.log(`[cms-parser] ${lineNum} lines processed, ${totalParsed} rates parsed...`);
  }

  if (batch.length > 0) onBatch(batch);
  console.log(`[cms-parser] Done: ${totalParsed} rates parsed (skipped ${skipped} zero-rate rows) from ${lineNum} lines`);

  if (totalParsed === 0) throw new Error(`[cms-parser] No valid rates parsed from ${csvPath}.`);

  return { rawHash, totalParsed, totalSkipped: skipped };
}

export async function parseCmsCsv(csvPath: string, effectiveYear: number): Promise<ParseResult> {
  const rates: CMSRate[] = [];
  const result = await parseCmsCsvStreaming(csvPath, effectiveYear, 50000, (batch) => { rates.push(...batch); });
  return { rates, rawHash: result.rawHash, headerRow: [] };
}

function buildHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const upperHeaders = headers.map(h => h.toUpperCase().trim());
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = aliases.findIndex(alias => upperHeaders.includes(alias));
    if (idx >= 0) { map[field] = upperHeaders.indexOf(aliases[idx]); } else { map[field] = -1; }
  }
  return map;
}

function getField(fields: string[], headerMap: Record<string, number>, fieldName: string): string | null {
  const idx = headerMap[fieldName];
  if (idx === undefined || idx < 0 || idx >= fields.length) return null;
  return fields[idx];
}

function parseRate(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, '').trim();
  if (cleaned === '' || cleaned === '.' || cleaned === 'NA' || cleaned === 'N/A') return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseCsvLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');
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
