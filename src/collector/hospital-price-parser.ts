/**
 * Hospital Price Transparency CSV Parser
 *
 * Parses CMS v3.0 hospital machine-readable files (MRFs).
 * These CSV files contain negotiated rates, gross charges,
 * cash discount prices, and de-identified min/max charges.
 *
 * Handles column name variations across hospitals.
 */

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import https from 'node:https';
import http from 'node:http';

export interface HospitalPriceRow {
  hospitalName: string;
  hospitalEin: string | null;
  payerName: string | null;
  planName: string | null;
  billingCodeType: string;
  billingCode: string;
  description: string | null;
  negotiatedRate: number | null;
  negotiatedType: string | null;
  grossCharge: number | null;
  cashDiscountPrice: number | null;
  minNegotiated: number | null;
  maxNegotiated: number | null;
  setting: string | null;
  modifier: string | null;
  sourceUrl: string;
}

// Column name aliases — hospitals use varying header names
const COLUMN_ALIASES: Record<string, string[]> = {
  hospitalName: [
    'hospital_name', 'name', 'hospital', 'facility_name', 'facility',
    'organization_name', 'org_name', 'provider_name',
  ],
  hospitalEin: [
    'ein', 'hospital_ein', 'employer_id', 'employer_identification_number',
    'tax_id', 'federal_tax_id',
  ],
  payerName: [
    'payer_name', 'payer', 'insurance_company', 'insurer', 'insurance',
    'payor_name', 'payor',
  ],
  planName: [
    'plan_name', 'plan', 'insurance_plan', 'benefit_plan',
    'product_name', 'plan_type',
  ],
  billingCodeType: [
    'billing_code_type', 'code_type', 'type', 'billing_code_type_code',
    'code_category',
  ],
  billingCode: [
    'billing_code', 'code', 'cpt_code', 'hcpcs_code', 'procedure_code',
    'cpt', 'hcpcs', 'service_code',
  ],
  description: [
    'description', 'service_description', 'item_description',
    'procedure_description', 'desc', 'charge_description',
    'standard_charge_description',
  ],
  setting: [
    'setting', 'patient_class', 'care_setting',
    'standard_charge|setting', 'inpatient_outpatient',
  ],
  grossCharge: [
    'gross_charge', 'standard_charge|gross', 'gross_charges',
    'chargemaster_amount', 'standard_charge_gross',
    'standard_charges|gross', 'charge_amount',
  ],
  cashDiscountPrice: [
    'discounted_cash_price', 'standard_charge|discounted_cash',
    'cash_discount_price', 'self_pay_price', 'cash_price',
    'standard_charge_discounted_cash', 'standard_charges|discounted_cash',
    'discounted_cash',
  ],
  negotiatedRate: [
    'payer_specific_negotiated_charge', 'standard_charge|negotiated_dollar',
    'negotiated_rate', 'negotiated_charge', 'negotiated_dollar',
    'standard_charge_negotiated_dollar', 'standard_charges|negotiated_dollar',
    'negotiated_dollar_amount',
  ],
  negotiatedType: [
    'additional_payer_specific_negotiated_charge-type',
    'standard_charge|negotiated_percentage', 'standard_charge|negotiated_algorithm',
    'negotiated_type', 'charge_type', 'rate_type',
    'methodology', 'standard_charge_methodology',
  ],
  minNegotiated: [
    'de_identified_min_negotiated_charge', 'standard_charge|min',
    'min_negotiated', 'min_charge', 'deidentified_min',
    'standard_charge_min', 'standard_charges|min',
  ],
  maxNegotiated: [
    'de_identified_max_negotiated_charge', 'standard_charge|max',
    'max_negotiated', 'max_charge', 'deidentified_max',
    'standard_charge_max', 'standard_charges|max',
  ],
  modifier: [
    'modifier', 'modifiers', 'billing_code_modifier',
    'cpt_modifier', 'mod',
  ],
};

/**
 * Download a URL to a temp file and return the local path.
 */
async function downloadToTemp(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmpPath = join(os.tmpdir(), `hospital-mrf-${randomUUID()}.csv`);
    const proto = url.startsWith('https') ? https : http;

    const doGet = (targetUrl: string, redirects = 0) => {
      if (redirects > 5) {
        return reject(new Error('Too many redirects'));
      }
      proto.get(targetUrl, (resp) => {
        // Handle redirects
        if (resp.statusCode && resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          return doGet(resp.headers.location, redirects + 1);
        }
        if (resp.statusCode !== 200) {
          return reject(new Error(`HTTP ${resp.statusCode} fetching ${targetUrl}`));
        }
        const chunks: Buffer[] = [];
        resp.on('data', (chunk: Buffer) => chunks.push(chunk));
        resp.on('end', () => {
          writeFileSync(tmpPath, Buffer.concat(chunks));
          resolve(tmpPath);
        });
        resp.on('error', reject);
      }).on('error', reject);
    };

    doGet(url);
  });
}

/**
 * Parse a hospital price transparency CSV file.
 *
 * @param filePath - Local file path or URL to the CSV
 * @param sourceUrl - URL to attribute as the data source
 * @param options - Optional overrides (e.g., hospital name)
 * @returns Parsed rows ready for database insertion
 */
export async function parseHospitalPriceFile(
  filePath: string,
  sourceUrl: string,
  options?: { hospitalName?: string }
): Promise<HospitalPriceRow[]> {
  let localPath = filePath;
  let isTemp = false;

  // If the path looks like a URL, download it first
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    console.log(`[hospital-price-parser] Downloading ${filePath}...`);
    localPath = await downloadToTemp(filePath);
    isTemp = true;
    console.log(`[hospital-price-parser] Downloaded to ${localPath}`);
  }

  if (!existsSync(localPath)) {
    throw new Error(`File not found: ${localPath}`);
  }

  const rows: HospitalPriceRow[] = [];
  let headerMap: Record<string, number> = {};
  let headerFound = false;
  let lineNum = 0;
  let skipped = 0;

  const rl = createInterface({
    input: createReadStream(localPath, { encoding: 'utf-8', highWaterMark: 256 * 1024 }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    // First line should be the header
    if (!headerFound) {
      const headerRow = parseCsvLine(line);
      headerMap = buildHeaderMap(headerRow);

      // Validate we found at least a billing_code column
      if (headerMap.billingCode < 0) {
        throw new Error(
          `[hospital-price-parser] Could not find billing_code column in header. ` +
          `Found columns: ${headerRow.join(', ')}`
        );
      }
      headerFound = true;
      console.log(
        `[hospital-price-parser] Header parsed: ${headerRow.length} columns. ` +
        `Mapped: billing_code=${headerMap.billingCode}, gross_charge=${headerMap.grossCharge}, ` +
        `negotiated_rate=${headerMap.negotiatedRate}, cash_price=${headerMap.cashDiscountPrice}`
      );
      continue;
    }

    const fields = parseCsvLine(line);
    if (fields.length < 2) continue;

    // Get billing code type — filter to CPT/HCPCS only
    const billingCodeType = (getField(fields, headerMap, 'billingCodeType') ?? '').trim().toUpperCase();
    if (billingCodeType && billingCodeType !== 'CPT' && billingCodeType !== 'HCPCS') {
      skipped++;
      continue;
    }

    const billingCode = (getField(fields, headerMap, 'billingCode') ?? '').trim();
    if (!billingCode) {
      skipped++;
      continue;
    }

    // If no billing_code_type column but the code looks like CPT/HCPCS, infer it
    const inferredType = billingCodeType || inferBillingCodeType(billingCode);
    if (!inferredType) {
      skipped++;
      continue;
    }

    const rawHospitalName = options?.hospitalName
      ?? (getField(fields, headerMap, 'hospitalName') ?? '').trim();
    const hospitalName = rawHospitalName || 'Unknown Hospital';

    const grossCharge = parseNumber(getField(fields, headerMap, 'grossCharge'));
    const negotiatedRate = parseNumber(getField(fields, headerMap, 'negotiatedRate'));
    const cashDiscountPrice = parseNumber(getField(fields, headerMap, 'cashDiscountPrice'));
    const minNegotiated = parseNumber(getField(fields, headerMap, 'minNegotiated'));
    const maxNegotiated = parseNumber(getField(fields, headerMap, 'maxNegotiated'));

    // Skip rows with no useful price data at all
    if (
      grossCharge === null &&
      negotiatedRate === null &&
      cashDiscountPrice === null &&
      minNegotiated === null &&
      maxNegotiated === null
    ) {
      skipped++;
      continue;
    }

    rows.push({
      hospitalName,
      hospitalEin: (getField(fields, headerMap, 'hospitalEin') ?? '').trim() || null,
      payerName: (getField(fields, headerMap, 'payerName') ?? '').trim() || null,
      planName: (getField(fields, headerMap, 'planName') ?? '').trim() || null,
      billingCodeType: inferredType,
      billingCode,
      description: (getField(fields, headerMap, 'description') ?? '').trim() || null,
      negotiatedRate,
      negotiatedType: (getField(fields, headerMap, 'negotiatedType') ?? '').trim() || null,
      grossCharge,
      cashDiscountPrice,
      minNegotiated,
      maxNegotiated,
      setting: normalizeSetting(getField(fields, headerMap, 'setting')),
      modifier: (getField(fields, headerMap, 'modifier') ?? '').trim() || null,
      sourceUrl,
    });

    if (lineNum % 100000 === 0) {
      console.log(`[hospital-price-parser] Processed ${lineNum} lines, ${rows.length} rows parsed...`);
    }
  }

  // Cleanup temp file if we downloaded it
  if (isTemp) {
    try {
      const fs = await import('node:fs');
      fs.unlinkSync(localPath);
    } catch { /* ignore */ }
  }

  console.log(
    `[hospital-price-parser] Done: ${rows.length} rows parsed, ${skipped} skipped ` +
    `(${lineNum} total lines)`
  );

  return rows;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  // Normalize headers: lowercase, trim, replace spaces/special chars with underscore
  const normalizedHeaders = headers.map(h =>
    h.toLowerCase().trim()
      .replace(/[^a-z0-9|_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
  );

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const normalizedAliases = aliases.map(a =>
      a.toLowerCase().trim()
        .replace(/[^a-z0-9|_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
    );

    let foundIdx = -1;
    for (const alias of normalizedAliases) {
      const idx = normalizedHeaders.indexOf(alias);
      if (idx >= 0) {
        foundIdx = idx;
        break;
      }
    }

    // Also try partial matching for pipe-separated headers
    if (foundIdx < 0) {
      for (let i = 0; i < normalizedHeaders.length; i++) {
        for (const alias of normalizedAliases) {
          if (normalizedHeaders[i].includes(alias) || alias.includes(normalizedHeaders[i])) {
            foundIdx = i;
            break;
          }
        }
        if (foundIdx >= 0) break;
      }
    }

    map[field] = foundIdx;
  }

  return map;
}

function getField(fields: string[], headerMap: Record<string, number>, fieldName: string): string | null {
  const idx = headerMap[fieldName];
  if (idx === undefined || idx < 0 || idx >= fields.length) return null;
  return fields[idx];
}

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s"]/g, '').trim();
  if (cleaned === '' || cleaned === '.' || cleaned === 'NA' || cleaned === 'N/A' || cleaned === '-') return null;
  const num = parseFloat(cleaned);
  return isNaN(num) || num < 0 ? null : num;
}

function normalizeSetting(value: string | null): string | null {
  if (!value) return null;
  const lower = value.toLowerCase().trim();
  if (lower.includes('inpatient') && lower.includes('outpatient')) return 'both';
  if (lower.includes('inpatient') || lower === 'ip') return 'inpatient';
  if (lower.includes('outpatient') || lower === 'op') return 'outpatient';
  if (lower === 'both') return 'both';
  return lower || null;
}

/**
 * Infer billing code type from the code format.
 * CPT codes are 5 digits, HCPCS Level II are letter + 4 digits.
 * Returns null if it doesn't match either pattern (e.g., DRG codes).
 */
function inferBillingCodeType(code: string): string | null {
  const trimmed = code.trim();
  if (/^\d{5}$/.test(trimmed)) return 'CPT';
  if (/^[A-Za-z]\d{4}$/.test(trimmed)) return 'HCPCS';
  return null;
}

/**
 * Parse a CSV line handling quoted fields with embedded commas.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let pos = 0;
  const len = line.length;

  while (pos <= len) {
    if (pos < len && line[pos] === '"') {
      // Quoted field — handle escaped quotes (doubled "")
      let end = pos + 1;
      while (end < len) {
        if (line[end] === '"') {
          if (end + 1 < len && line[end + 1] === '"') {
            // Escaped quote
            end += 2;
            continue;
          }
          break;
        }
        end++;
      }
      const content = line.slice(pos + 1, end).replace(/""/g, '"');
      fields.push(content);
      // Skip past closing quote and comma
      pos = end + 1;
      if (pos < len && line[pos] === ',') pos++;
    } else {
      // Unquoted field
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
