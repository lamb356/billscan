import { readFileSync } from 'node:fs';

interface PdfResult {
  text: string;
  pageCount: number;
}

export async function parsePdf(pdfPath: string): Promise<PdfResult> {
  let pdfParse: (buf: Buffer, opts?: Record<string, unknown>) => Promise<{ text: string; numpages: number }>;

  try {
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    pdfParse = mod.default ?? mod;
  } catch {
    const mod = await import('pdf-parse');
    pdfParse = mod.default ?? (mod as any);
  }

  const buffer = readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return { text: data.text ?? '', pageCount: data.numpages ?? 0 };
}
