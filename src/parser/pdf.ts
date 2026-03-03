import { readFileSync } from 'node:fs';

interface PdfResult {
  text: string;
  pageCount: number;
}

export async function parsePdf(pdfPath: string): Promise<PdfResult> {
  const { PDFParse } = await import('pdf-parse');
  const buffer = readFileSync(pdfPath);
  const pdf = new PDFParse({ data: new Uint8Array(buffer) });
  const textResult = await pdf.getText();
  return {
    text: textResult.pages.map((p: any) => p.text || '').join('\n'),
    pageCount: textResult.pages.length,
  };
}
