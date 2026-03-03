import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import Tesseract from 'tesseract.js';
import { extractCptData, type ExtractedBillData } from './cpt-extractor.js';

export interface OcrPipelineResult {
  text: string;
  confidence: number;
  method: 'pdf-text' | 'ocr';
  extractedData: ExtractedBillData;
}

async function extractPdfText(pdfPath: string): Promise<{ text: string; pageCount: number }> {
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

async function runTesseractOcr(imagePath: string): Promise<{ text: string; confidence: number }> {
  const worker = await Tesseract.createWorker('eng', 1, { logger: () => {} });

  try {
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
    const { data } = await worker.recognize(imagePath);
    return { text: data.text, confidence: (data.confidence ?? 0) / 100 };
  } finally {
    await worker.terminate();
  }
}

const CPT_QUICK_CHECK = /\b\d{5}\b|\b[A-Z]\d{4}\b/;

function textHasCptCodes(text: string): boolean {
  return CPT_QUICK_CHECK.test(text);
}

export async function runOcrPipeline(filePath: string): Promise<OcrPipelineResult> {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.pdf') return processPdf(filePath);

  if (['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'].includes(ext))
    return processImage(filePath);

  throw new Error(
    `Unsupported file type for OCR pipeline: ${ext}. ` +
    `Supported: .pdf, .jpg, .jpeg, .png, .tiff, .tif, .bmp`
  );
}

async function processPdf(pdfPath: string): Promise<OcrPipelineResult> {
  let text: string;
  let pageCount: number;

  try {
    ({ text, pageCount } = await extractPdfText(pdfPath));
  } catch (err) {
    throw new Error(`Failed to read PDF "${pdfPath}": ${(err as Error).message}.`);
  }

  if (!text || text.trim().length < 20)
    throw new Error(`PDF "${pdfPath}" appears to be a scanned (image-only) PDF - no text layer found.`);

  if (!textHasCptCodes(text))
    throw new Error(`PDF text extracted but no CPT/HCPCS codes were detected.`);

  const extractedData = extractCptData(text, 0.95);

  if (extractedData.lineItems.length === 0)
    throw new Error(`PDF text contains potential CPT codes but could not associate them with billed amounts.`);

  return { text, confidence: 0.95, method: 'pdf-text', extractedData };
}

async function processImage(imagePath: string): Promise<OcrPipelineResult> {
  let text: string;
  let confidence: number;

  try {
    ({ text, confidence } = await runTesseractOcr(imagePath));
  } catch (err) {
    throw new Error(`OCR failed for "${imagePath}": ${(err as Error).message}.`);
  }

  if (!text || text.trim().length < 10)
    throw new Error(`OCR produced no usable text from "${imagePath}" (confidence: ${(confidence * 100).toFixed(0)}%).`);

  if (!textHasCptCodes(text))
    throw new Error(`OCR completed but no CPT/HCPCS codes were detected.`);

  const extractedData = extractCptData(text, confidence);

  if (extractedData.lineItems.length === 0)
    throw new Error(`OCR detected potential CPT codes but could not associate them with dollar amounts.`);

  return { text, confidence, method: 'ocr', extractedData };
}
