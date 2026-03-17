import * as fs from 'fs';
import * as readline from 'readline';

/**
 * CMS ZIP Code to Carrier Locality File parser.
 *
 * Parses the fixed-width ZIP5 file from CMS:
 * https://www.cms.gov/medicare/payment/fee-schedules
 *
 * ZIP5 Record Layout (positions are 1-indexed as per CMS documentation):
 *   Field              Pos   Len  Description
 *   State              1-2     2  Alpha State Code
 *   ZIP Code           3-7     5  Postal ZIP Code
 *   Carrier            8-12    5  CMS Carrier / MAC number
 *   Pricing Locality  13-14    2  CMS Locality number
 *   Rural Indicator   15       1  blank=urban, R=rural, B=super rural
 *   Bene Lab CB Loc   16-17    2  Lab competitive bid locality (Z9=not a demo)
 *   Rural Indicator2  18       1  Legacy rural indicator (pre-2015)
 *   Plus Four Flag    21       1  0=no +4 extension, 1=+4 extension required
 *   Part B Pay Ind    23       1  Part B payment indicator
 *   Year/Quarter      76-80    5  YYYYQ format
 *
 * Source: ZIP5 Carrier Locality File – Revised 02/18/2026
 */

export interface ZipLocalityRecord {
  state: string;
  zip_code: string;
  carrier: string;
  locality: string;
  /** blank/empty = urban, 'R' = rural, 'B' = super rural (low density qualified area) */
  urban_rural_indicator: string;
  /** Lab competitive bid locality (Z9 = not a demonstration locality) */
  lab_cb_locality: string;
  /** Legacy rural indicator based on MSA (pre-2015) */
  rural_indicator2: string;
  /** Plus-four extension required flag: '0' = no, '1' = yes */
  plus_four_flag: string;
  /** Part B payment indicator */
  part_b_indicator: string;
  /** Year and quarter: YYYYQ */
  year_quarter: string;
}

/**
 * Parse the CMS ZIP5 fixed-width carrier locality file.
 *
 * @param filePath Absolute path to the ZIP5_APR2026.txt (or similar) file.
 * @returns Promise resolving to an array of ZipLocalityRecord objects.
 */
export async function parseZipLocalityFile(filePath: string): Promise<ZipLocalityRecord[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ZIP locality file not found: ${filePath}`);
  }

  const records: ZipLocalityRecord[] = [];

  const fileStream = fs.createReadStream(filePath, { encoding: 'ascii' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const rawLine of rl) {
    // Strip any trailing carriage returns / whitespace
    const line = rawLine.replace(/\r$/, '');

    // Skip blank lines
    if (line.trim().length === 0) continue;

    // Minimum usable length: at least 14 chars (state + zip + carrier + locality)
    if (line.length < 14) continue;

    // Fixed-width extraction (0-indexed):
    const state            = line.substring(0, 2).trim();
    const zip_code         = line.substring(2, 7).trim();
    const carrier          = line.substring(7, 12).trim();
    const locality         = line.substring(12, 14).trim();
    const rural            = line.length > 14 ? line.substring(14, 15) : '';
    const lab_cb_locality  = line.length > 16 ? line.substring(15, 17).trim() : '';
    const rural2           = line.length > 17 ? line.substring(17, 18).trim() : '';
    const plus_four_flag   = line.length > 20 ? line.substring(20, 21).trim() : '';
    const part_b_indicator = line.length > 22 ? line.substring(22, 23).trim() : '';
    const year_quarter     = line.length >= 80 ? line.substring(75, 80).trim() : '';

    // Validate required fields
    if (!zip_code || !carrier || !locality) continue;

    // Normalize urban_rural_indicator
    // blank = urban, 'R' = rural, 'B' = super rural (low density)
    const urban_rural_indicator = rural.trim() === '' ? 'U' : rural.trim();

    records.push({
      state,
      zip_code,
      carrier,
      locality,
      urban_rural_indicator,
      lab_cb_locality,
      rural_indicator2: rural2,
      plus_four_flag,
      part_b_indicator,
      year_quarter,
    });
  }

  return records;
}

/**
 * Parse synchronously by reading entire file into memory.
 * Useful for smaller files or when async is not convenient.
 */
export function parseZipLocalityFileSync(filePath: string): ZipLocalityRecord[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ZIP locality file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'ascii');
  const lines = content.split(/\r?\n/);
  const records: ZipLocalityRecord[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    if (line.trim().length === 0) continue;
    if (line.length < 14) continue;

    const state            = line.substring(0, 2).trim();
    const zip_code         = line.substring(2, 7).trim();
    const carrier          = line.substring(7, 12).trim();
    const locality         = line.substring(12, 14).trim();
    const rural            = line.length > 14 ? line.substring(14, 15) : '';
    const lab_cb_locality  = line.length > 16 ? line.substring(15, 17).trim() : '';
    const rural2           = line.length > 17 ? line.substring(17, 18).trim() : '';
    const plus_four_flag   = line.length > 20 ? line.substring(20, 21).trim() : '';
    const part_b_indicator = line.length > 22 ? line.substring(22, 23).trim() : '';
    const year_quarter     = line.length >= 80 ? line.substring(75, 80).trim() : '';

    if (!zip_code || !carrier || !locality) continue;

    const urban_rural_indicator = rural.trim() === '' ? 'U' : rural.trim();

    records.push({
      state,
      zip_code,
      carrier,
      locality,
      urban_rural_indicator,
      lab_cb_locality,
      rural_indicator2: rural2,
      plus_four_flag,
      part_b_indicator,
      year_quarter,
    });
  }

  return records;
}
