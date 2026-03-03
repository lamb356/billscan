import * as fs from 'fs';
import * as readline from 'readline';

export interface ZipLocalityRecord {
  state: string;
  zip_code: string;
  carrier: string;
  locality: string;
  urban_rural_indicator: string;
  lab_cb_locality: string;
  rural_indicator2: string;
  plus_four_flag: string;
  part_b_indicator: string;
  year_quarter: string;
}

export async function parseZipLocalityFile(filePath: string): Promise<ZipLocalityRecord[]> {
  if (!fs.existsSync(filePath)) throw new Error(`ZIP locality file not found: ${filePath}`);

  const records: ZipLocalityRecord[] = [];
  const fileStream = fs.createReadStream(filePath, { encoding: 'ascii' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const rawLine of rl) {
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
      state, zip_code, carrier, locality,
      urban_rural_indicator, lab_cb_locality,
      rural_indicator2: rural2, plus_four_flag,
      part_b_indicator, year_quarter,
    });
  }

  return records;
}

export function parseZipLocalityFileSync(filePath: string): ZipLocalityRecord[] {
  if (!fs.existsSync(filePath)) throw new Error(`ZIP locality file not found: ${filePath}`);

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
      state, zip_code, carrier, locality,
      urban_rural_indicator, lab_cb_locality,
      rural_indicator2: rural2, plus_four_flag,
      part_b_indicator, year_quarter,
    });
  }

  return records;
}
