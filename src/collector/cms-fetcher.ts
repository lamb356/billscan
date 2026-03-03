import { mkdirSync, existsSync, createWriteStream, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import AdmZip from 'adm-zip';

const CMS_URL_PATTERNS = [
  'https://www.cms.gov/files/zip/pfrev{YY}a-updated-12-29-{PREVYEAR}.zip',
  'https://www.cms.gov/files/zip/pfrev{YY}b.zip',
  'https://www.cms.gov/files/zip/pfrev{YY}a.zip',
  'https://www.cms.gov/files/zip/pfrev{YY}d.zip',
  'https://www.cms.gov/files/zip/pfrev{YY}c.zip',
  'https://www.cms.gov/files/zip/pfall{YY}a.zip',
];

interface FetchResult {
  zipPath: string;
  csvPath: string;
  sourceUrl: string;
}

export async function fetchCmsData(year: number, forceRefresh: boolean = false): Promise<FetchResult> {
  const yy = String(year).slice(-2);
  const prevYear = String(year - 1);
  const downloadDir = resolve(process.cwd(), 'data', 'cms-downloads');
  mkdirSync(downloadDir, { recursive: true });

  const zipPath = resolve(downloadDir, `PFREV${yy}.zip`);

  if (!forceRefresh && existsSync(zipPath)) {
    console.log(`[cms-fetcher] Using cached ZIP: ${zipPath}`);
    const csvPath = extractCsv(zipPath, downloadDir);
    return { zipPath, csvPath, sourceUrl: 'cached' };
  }

  const attemptedUrls: string[] = [];
  for (const pattern of CMS_URL_PATTERNS) {
    const url = pattern
      .replace('{YY}', yy)
      .replace('{yy}', yy)
      .replace('{PREVYEAR}', prevYear);
    attemptedUrls.push(url);
    console.log(`[cms-fetcher] Trying: ${url}`);

    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'BillScan/0.1.0 (medical-bill-auditor)' },
      });

      if (!response.ok) {
        console.log(`[cms-fetcher] ${response.status} from ${url}`);
        continue;
      }

      if (response.body) {
        const fileStream = createWriteStream(zipPath);
        await pipeline(Readable.fromWeb(response.body as any), fileStream);

        try {
          const zipCheck = new AdmZip(zipPath);
          const entries = zipCheck.getEntries();
          if (entries.length === 0) {
            console.log(`[cms-fetcher] Empty ZIP from ${url}`);
            continue;
          }
          console.log(`[cms-fetcher] Downloaded from ${url} (${entries.length} files in ZIP)`);
        } catch {
          console.log(`[cms-fetcher] Invalid ZIP from ${url}`);
          try { unlinkSync(zipPath); } catch {}
          continue;
        }

        const csvPath = extractCsv(zipPath, downloadDir);
        return { zipPath, csvPath, sourceUrl: url };
      }
    } catch (err) {
      console.log(`[cms-fetcher] Error with ${url}: ${(err as Error).message}`);
      continue;
    }
  }

  throw new Error(
    `[cms-fetcher] FAILED: Could not download CMS fee schedule from any URL.\n` +
    `Attempted:\n${attemptedUrls.map(u => `  - ${u}`).join('\n')}\n\n` +
    `Visit: https://www.cms.gov/medicare/payment/fee-schedules/physician`
  );
}

function extractCsv(zipPath: string, outputDir: string): string {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  let textFiles = entries.filter(e =>
    !e.isDirectory &&
    (e.entryName.toLowerCase().endsWith('.csv') ||
     e.entryName.toLowerCase().endsWith('.txt'))
  );

  if (textFiles.length > 0) {
    const target = textFiles.sort((a, b) => b.header.size - a.header.size)[0];
    const csvPath = resolve(outputDir, target.entryName.split('/').pop()!);
    zip.extractEntryTo(target, outputDir, false, true);
    console.log(`[cms-fetcher] Extracted: ${target.entryName} (${(target.header.size / 1024 / 1024).toFixed(1)}MB)`);
    return csvPath;
  }

  const nestedZips = entries.filter(e =>
    !e.isDirectory && e.entryName.toLowerCase().endsWith('.zip')
  );

  if (nestedZips.length > 0) {
    const nonQP = nestedZips.find(e => e.entryName.toLowerCase().includes('nonqp')) || nestedZips[0];
    const nestedName = nonQP.entryName.split('/').pop()!;
    const nestedZipPath = resolve(outputDir, nestedName);
    zip.extractEntryTo(nonQP, outputDir, false, true);
    console.log(`[cms-fetcher] Found nested ZIP: ${nonQP.entryName}`);

    const innerZip = new AdmZip(nestedZipPath);
    const innerEntries = innerZip.getEntries();

    textFiles = innerEntries.filter(e =>
      !e.isDirectory &&
      (e.entryName.toLowerCase().endsWith('.csv') ||
       e.entryName.toLowerCase().endsWith('.txt'))
    );

    if (textFiles.length > 0) {
      const target = textFiles.sort((a, b) => b.header.size - a.header.size)[0];
      const csvPath = resolve(outputDir, target.entryName.split('/').pop()!);
      innerZip.extractEntryTo(target, outputDir, false, true);
      console.log(`[cms-fetcher] Extracted: ${target.entryName} (${(target.header.size / 1024 / 1024).toFixed(1)}MB)`);
      return csvPath;
    }
  }

  throw new Error(`No CSV or TXT files found in ZIP (or nested ZIPs): ${zipPath}`);
}
