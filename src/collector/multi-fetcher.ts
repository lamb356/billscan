import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const DATA_DIR = join(process.cwd(), 'data');

// CLFS URLs (Clinical Lab Fee Schedule)
const CLFS_URLS: Record<number, string> = {
  2026: 'https://www.cms.gov/files/zip/cy-2026-clfs-payment-rate-information.zip',
  2025: 'https://www.cms.gov/files/zip/cy-2025-clfs-payment-rate-information.zip',
  2024: 'https://www.cms.gov/files/zip/cy-2024-clfs-payment-rate-information.zip',
};

// ASP URLs (Average Sales Price - Part B drug pricing)
const ASP_URLS: Record<number, string> = {
  2026: 'https://www.cms.gov/files/zip/2026-asp-drug-pricing-files.zip',
  2025: 'https://www.cms.gov/files/zip/2025-asp-drug-pricing-files.zip',
  2024: 'https://www.cms.gov/files/zip/2024-asp-drug-pricing-files.zip',
};

// OPPS URLs (Outpatient PPS / APC)
const OPPS_URLS: Record<number, string> = {
  2026: 'https://www.cms.gov/files/zip/2026-opps-addendum-b.zip',
  2025: 'https://www.cms.gov/files/zip/2025-opps-addendum-b.zip',
  2024: 'https://www.cms.gov/files/zip/2024-opps-addendum-b.zip',
};

export interface MultiFetchResult {
  csvPath: string;
  sourceUrl: string;
  fileName: string;
}

const FETCH_CONFIGS = {
  clfs: { urlMap: CLFS_URLS, prefix: 'cms-clfs' },
  asp: { urlMap: ASP_URLS, prefix: 'cms-asp' },
  opps: { urlMap: OPPS_URLS, prefix: 'cms-opps' },
};

async function fetchCmsSource(
  type: keyof typeof FETCH_CONFIGS,
  year: number,
  forceRefresh = false,
): Promise<MultiFetchResult> {
  const { urlMap, prefix } = FETCH_CONFIGS[type];
  const sourceUrl = urlMap[year];

  if (!sourceUrl) {
    throw new Error(`No ${type.toUpperCase()} URL configured for year ${year}`);
  }

  mkdirSync(DATA_DIR, { recursive: true });

  const fileName = `${prefix}-${year}.csv`;
  const csvPath = join(DATA_DIR, fileName);
  const zipPath = join(DATA_DIR, `${prefix}-${year}.zip`);

  // Return cached if available
  if (!forceRefresh && existsSync(csvPath)) {
    console.log(`[${type}-fetcher] Using cached CSV: ${csvPath}`);
    return { csvPath, sourceUrl, fileName };
  }

  // Download ZIP
  console.log(`[${type}-fetcher] Downloading ${sourceUrl}...`);
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${sourceUrl}`);
  }

  const writer = createWriteStream(zipPath);
  await pipeline(Readable.fromWeb(response.body as any), writer);
  console.log(`[${type}-fetcher] Downloaded to ${zipPath}`);

  // Extract CSV from ZIP
  await extractCsvFromZip(zipPath, csvPath, type);
  console.log(`[${type}-fetcher] Extracted CSV to ${csvPath}`);

  return { csvPath, sourceUrl, fileName };
}

export const fetchClfsData = (year: number, forceRefresh = false) =>
  fetchCmsSource('clfs', year, forceRefresh);

export const fetchAspData = (year: number, forceRefresh = false) =>
  fetchCmsSource('asp', year, forceRefresh);

export const fetchOppsData = (year: number, forceRefresh = false) =>
  fetchCmsSource('opps', year, forceRefresh);

async function extractCsvFromZip(zipPath: string, csvPath: string, type: string): Promise<void> {
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
    throw new Error(`[${type}-fetcher] No CSV found in ZIP. Files: ${files.join(', ')}`);
  }

  renameSync(pathJoin(tmpDir, csvFile), csvPath);

  try {
    execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' });
    unlinkSync(zipPath);
  } catch { /* cleanup is best-effort */ }
}
