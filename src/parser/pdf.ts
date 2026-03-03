import { readFileSync } from 'node:fs';

export async function extractPdfText(pdfPath: string): Promise<string> {
  const { default: pdfParse } = await import('pdf-parse');
  const buffer = readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return data.text;
}
