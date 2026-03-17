/**
 * OCR pipeline for medical bill images and scanned PDFs.
 *
 * Handles:
 *  - JPEG / PNG / TIFF / BMP images → Tesseract.js OCR
 *  - PDFs → pdf-parse text extraction first; fall back to error if no CPT codes found
 *    (full image-based PDF OCR would require a PDF→image renderer not included here,
 *     so scanned PDFs emit a clear message to the caller)
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import Tesseract from 'tesseract.js';
import { extractCptData, type ExtractedBillData } from './cpt-extractor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OcrPipelineResult {
  text: string;
  confidence: number;       // 0–1
  method: 'pdf-text' | 'ocr';
  extractedData: ExtractedBillData;
}

// ---------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------

async function extractPdfText(pdfPath: string): Promise<{ text: string; pageCount: number }> {
  // Dynamic import avoids issues when pdf-parse is not present
  // pdf-parse default export varies by version — handle both
  let pdfParse: (buf: Buffer, opts?: Record<string, unknown>) => Promise<{ text: string; numpages: number }>;

  try {
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    pdfParse = mod.default ?? mod;
  } catch {
    // Fallback import path
    const mod = await import('pdf-parse');
    pdfParse = mod.default ?? (mod as any);
  }

  const buffer = readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return { text: data.text ?? '', pageCount: data.numpages ?? 0 };
}

// ---------------------------------------------------------------------------
// Tesseract OCR
// ---------------------------------------------------------------------------

async function runTesseractOcr(imagePath: string): Promise<{ text: string; confidence: number }> {
  const worker = await Tesseract.createWorker('eng', 1, {
    // Suppress tesseract.js verbose logging
    logger: () => {},
  });

  try {
    // PSM 6: Assume a single uniform block of text (good for documents)
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    });

    const { data } = await worker.recognize(imagePath);
    return {
      text: data.text,
      confidence: (data.confidence ?? 0) / 100,
    };
  } finally {
    await worker.terminate();
  }
}

// ---------------------------------------------------------------------------
// Helpers: does this text contain likely CPT codes or dollar amounts?
// ---------------------------------------------------------------------------

const CPT_QUICK_CHECK = /\b\d{5}\b|\b[A-Z]\d{4}\b/;
const DOLLAR_QUICK_CHECK = /\$\s*[\d,]+\.?\d{0,2}|\b[\d,]{1,9}\.\d{2}\b/;

function textHasCptCodes(text: string): boolean {
  return CPT_QUICK_CHECK.test(text);
}

/** Check if text has dollar amounts + descriptive words (might be a bill without CPT codes) */
function textLooksLikeBill(text: string): boolean {
  const hasMoney = DOLLAR_QUICK_CHECK.test(text);
  const hasMedicalWords = /x-?ray|visit|lab|blood|ekg|ecg|ct\s|mri|ultrasound|injection|infusion|therapy|surgery|hospital|emergency|radiology|anesthes|vaccine|immuniz|panel|metabolic|urinal|venipuncture|lumbar|chest|spine|abdomen|pelvi|knee|shoulder|ankle|head|brain|cardiac|pulmonary/i.test(text);
  return hasMoney && hasMedicalWords;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process a file through the appropriate extraction path:
 *  - .pdf  → pdf-parse text extraction; if no CPT codes found, emit diagnostic error
 *  - image → Tesseract.js OCR
 *
 * Returns structured OCR/extraction results.
 */
export async function runOcrPipeline(filePath: string): Promise<OcrPipelineResult> {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    return processPdf(filePath);
  }

  if (['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'].includes(ext)) {
    return processImage(filePath);
  }

  throw new Error(
    `Unsupported file type for OCR pipeline: ${ext}. ` +
    `Supported: .pdf, .jpg, .jpeg, .png, .tiff, .tif, .bmp`
  );
}

// ---------------------------------------------------------------------------
// PDF processing
// ---------------------------------------------------------------------------

async function processPdf(pdfPath: string): Promise<OcrPipelineResult> {
  let text: string;
  let pageCount: number;

  try {
    ({ text, pageCount } = await extractPdfText(pdfPath));
  } catch (err) {
    throw new Error(
      `Failed to read PDF "${pdfPath}": ${(err as Error).message}. ` +
      `Ensure the file is a valid PDF.`
    );
  }

  if (!text || text.trim().length < 20) {
    throw new Error(
      `PDF "${pdfPath}" appears to be a scanned (image-only) PDF — no text layer found. ` +
      `Convert the PDF to an image (e.g. png) and re-submit for OCR processing.`
    );
  }

  const hasCptCodes = textHasCptCodes(text);
  const looksLikeBill = textLooksLikeBill(text);

  if (!hasCptCodes && !looksLikeBill) {
    throw new Error(
      `PDF text extracted (${text.trim().length} chars, ${pageCount} page(s)) ` +
      `but no CPT/HCPCS codes or medical billing content was detected. ` +
      `If this is a scanned PDF, convert it to an image and re-submit.`
    );
  }

  // extractCptData now handles both CPT-code-based and description-based extraction
  const extractedData = await extractCptData(text, hasCptCodes ? 0.95 : 0.80);

  if (extractedData.lineItems.length === 0) {
    throw new Error(
      `PDF text was processed but no billable items could be extracted. ` +
      `Check that the PDF has a standard itemized bill format with procedure descriptions and amounts.`
    );
  }

  return {
    text,
    confidence: 0.95,
    method: 'pdf-text',
    extractedData,
  };
}

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

async function processImage(imagePath: string): Promise<OcrPipelineResult> {
  let text: string;
  let confidence: number;

  try {
    ({ text, confidence } = await runTesseractOcr(imagePath));
  } catch (err) {
    throw new Error(
      `OCR failed for "${imagePath}": ${(err as Error).message}. ` +
      `Ensure the file is a valid image in JPEG, PNG, TIFF, or BMP format.`
    );
  }

  if (!text || text.trim().length < 10) {
    throw new Error(
      `OCR produced no usable text from "${imagePath}" (confidence: ${(confidence * 100).toFixed(0)}%). ` +
      `Try a higher-resolution scan or a cleaner image.`
    );
  }

  const hasCptCodes = textHasCptCodes(text);
  const looksLikeBill = textLooksLikeBill(text);

  if (!hasCptCodes && !looksLikeBill) {
    throw new Error(
      `OCR completed (confidence: ${(confidence * 100).toFixed(0)}%) but no CPT/HCPCS codes ` +
      `or medical billing content was detected. Verify this is a medical itemized bill or EOB.`
    );
  }

  // extractCptData handles both CPT-code-based and description-based extraction
  const adjustedConfidence = hasCptCodes ? confidence : confidence * 0.85;
  const extractedData = await extractCptData(text, adjustedConfidence);

  if (extractedData.lineItems.length === 0) {
    throw new Error(
      `OCR processed the image (confidence: ${(confidence * 100).toFixed(0)}%) but could not ` +
      `extract billable line items. Try a clearer photo with procedure descriptions and amounts visible.`
    );
  }

  return {
    text,
    confidence,
    method: 'ocr',
    extractedData,
  };
}
