import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import AdmZip from 'adm-zip';

interface FetchResult {
  csvPath: string;
  sourceUrl: string;
  fileName: string;
}

const CLFS_URL_PATTERNS = [
  'https://www.cms.gov/files/zip/26clabq1.zip',
  'https://www.cms.gov/files/zip/{YY}clabq1.zip',
];

const ASP_URL_PATTERNS = [
  'https://www.cms.gov/files/zip/january-{YEAR}-medicare-part-b-payment-limit-files.zip',
  'https://www.cms.gov/files/zip/april-{YEAR}-medicare-part-b-payment-limit-files.zip',
];

const OPPS_URL_PATTERNS = [
  'https://www.cms.gov/files/zip/january-{YEAR}-opps-addendum-b.zip',
  'https://www.cms.gov/files/zip/april-{YEAR}-opps-addendum-b.zip',
];

async function downloadAndExtract(
  urls: string[],
  label: string,
  downloadDir: string,
  localName: string,
  forceRefresh: boolean,
  csvPicker: (entries: string[]) => string | null,
): Promise<FetchResult> {
  mkdirSync(downloadDir, { recursive: true });
  const zipPath = resolve(downloadDir, `${localName}.zip`);

  if (!forceRefresh && existsSync(zipPath)) {
    console.log(`[${label}] Using cached ZIP: ${zipPath}`);
    const csvPath = extractBestCsv(zipPath, downloadDir, csvPicker);
    return { csvPath, sourceUrl: 'cached', fileName: csvPath.split('/').pop()! };
  }

  for (const url of urls) {
    console.log(`[${label}] Trying: ${url}`);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'BillScan/0.2.0 (medical-bill-auditor)' },
      });
      if (!response.ok) { console.log(`[${label}] ${response.status} from ${url}`); continue; }
      if (response.body) {
        const fileStream = createWriteStream(zipPath);
        await pipeline(Readable.fromWeb(response.body as any), fileStream);
        try { new AdmZip(zipPath); } catch { console.log(`[${label}] Invalid ZIP from ${url}`); continue; }
        const csvPath = extractBestCsv(zipPath, downloadDir, csvPicker);
        console.log(`[${label}] Downloaded from ${url}`);
        return { csvPath, sourceUrl: url, fileName: csvPath.split('/').pop()! };
      }
    } catch (err) {
      console.log(`[${label}] Error: ${(err as Error).message}`);
      continue;
    }
  }

  throw new Error(`[${label}] Could not download from any URL`);
}

function extractBestCsv(
  zipPath: string,
  outputDir: string,
  csvPicker: (entries: string[]) => string | null,
): string {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const names = entries.filter(e => !e.isDirectory).map(e => e.entryName);

  const chosen = csvPicker(names);
  if (!chosen) {
    const textFiles = entries
      .filter(e => !e.isDirectory && (/\.csv$/i.test(e.entryName) || /\.txt$/i.test(e.entryName)))
      .sort((a, b) => b.header.size - a.header.size);
    if (textFiles.length === 0) throw new Error(`No CSV/TXT in ${zipPath}`);
    const target = textFiles[0];
    const outPath = resolve(outputDir, target.entryName.split('/').pop()!);
    zip.extractEntryTo(target, outputDir, false, true);
    return outPath;
  }

  const entry = entries.find(e => e.entryName === chosen);
  if (!entry) throw new Error(`Entry ${chosen} not found in ${zipPath}`);
  const outName = chosen.split('/').pop()!;
  const outPath = resolve(outputDir, outName);
  zip.extractEntryTo(entry, outputDir, false, true);
  return outPath;
}

export async function fetchClfsData(year: number, forceRefresh = false): Promise<FetchResult> {
  const yy = String(year).slice(-2);
  const urls = CLFS_URL_PATTERNS.map(u => u.replace('{YY}', yy).replace('{YEAR}', String(year)));
  const downloadDir = resolve(process.cwd(), 'data', 'cms-downloads');
  return downloadAndExtract(urls, 'clfs-fetcher', downloadDir, `clfs-${year}`, forceRefresh, (entries) => {
    return entries.find(e => /\.csv$/i.test(e)) || null;
  });
}

export async function fetchAspData(year: number, forceRefresh = false): Promise<FetchResult> {
  const urls = ASP_URL_PATTERNS.map(u => u.replace('{YEAR}', String(year)));
  const downloadDir = resolve(process.cwd(), 'data', 'cms-downloads');
  return downloadAndExtract(urls, 'asp-fetcher', downloadDir, `asp-${year}`, forceRefresh, (entries) => {
    return entries.find(e => /508.*\.csv$/i.test(e) || /\.csv$/i.test(e)) || null;
  });
}

export async function fetchOppsData(year: number, forceRefresh = false): Promise<FetchResult> {
  const urls = OPPS_URL_PATTERNS.map(u => u.replace('{YEAR}', String(year)));
  const downloadDir = resolve(process.cwd(), 'data', 'cms-downloads');
  return downloadAndExtract(urls, 'opps-fetcher', downloadDir, `opps-${year}`, forceRefresh, (entries) => {
    return entries.find(e => /508.*\.csv$/i.test(e)) ||
           entries.find(e => /addendum.*b.*\.csv$/i.test(e)) ||
           entries.find(e => /\.csv$/i.test(e)) || null;
  });
}
