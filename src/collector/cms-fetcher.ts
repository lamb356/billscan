import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const CMS_BASE = 'https://www.cms.gov/medicare/payment/fee-schedules/physician';
const DATA_DIR = join(process.cwd(), 'data');

const CMS_URLS: Record<number, string> = {
  2026: 'https://www.cms.gov/files/zip/2026-npimdfs-anwrvu.zip',
  2025: 'https://www.cms.gov/files/zip/2025-npimdfs-anwrvu.zip',
  2024: 'https://www.cms.gov/files/zip/2024-npimdfs.zip',
};

export interface FetchResult {
  csvPath: string;
  sourceUrl: string;
  year: number;
}

export async function fetchCmsData(year: number, forceRefresh = false): Promise<FetchResult> {
  mkdirSync(DATA_DIR, { recursive: true });

  const sourceUrl = CMS_URLS[year];
  if (!sourceUrl) {
    throw new Error(`No CMS URL configured for year ${year}. Supported: ${Object.keys(CMS_URLS).join(', ')}`);
  }

  const zipPath = join(DATA_DIR, `cms-pfs-${year}.zip`);
  const csvPath = join(DATA_DIR, `cms-pfs-${year}.csv`);

  // Return cached if available
  if (!forceRefresh && existsSync(csvPath)) {
    console.log(`[cms-fetcher] Using cached CSV: ${csvPath}`);
    return { csvPath, sourceUrl, year };
  }

  // Download ZIP
  console.log(`[cms-fetcher] Downloading ${sourceUrl}...`);
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${sourceUrl}`);
  }

  const writer = createWriteStream(zipPath);
  await pipeline(Readable.fromWeb(response.body as any), writer);
  console.log(`[cms-fetcher] Downloaded to ${zipPath}`);

  // Extract CSV from ZIP
  await extractCsvFromZip(zipPath, csvPath);
  console.log(`[cms-fetcher] Extracted CSV to ${csvPath}`);

  return { csvPath, sourceUrl, year };
}

async function extractCsvFromZip(zipPath: string, csvPath: string): Promise<void> {
  // Use unzip via child_process
  const { execSync } = await import('node:child_process');
  const { readdirSync, renameSync, unlinkSync } = await import('node:fs');
  const { join: pathJoin, extname } = await import('node:path');

  const tmpDir = zipPath + '_extracted';
  mkdirSync(tmpDir, { recursive: true });

  execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe' });

  // Find CSV file
  const files = readdirSync(tmpDir);
  const csvFile = files.find(f => extname(f).toLowerCase() === '.csv');

  if (!csvFile) {
    throw new Error(`No CSV file found in ZIP. Files: ${files.join(', ')}`);
  }

  renameSync(pathJoin(tmpDir, csvFile), csvPath);

  // Cleanup
  try {
    execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' });
    unlinkSync(zipPath);
  } catch { /* cleanup is best-effort */ }
}
