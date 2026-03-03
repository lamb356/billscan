import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { ParsedBillSchema, type ParsedBill } from '../schema/bill.js';
import { runOcrPipeline } from './ocr-pipeline.js';
import { billFromText } from './bill-from-text.js';

export async function parseBill(filePath: string): Promise<ParsedBill> {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case '.json':
      return parseJsonBill(filePath);
    case '.pdf':
      return parsePdfBill(filePath);
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.tiff':
    case '.tif':
    case '.bmp':
      return parseImageBill(filePath);
    default:
      throw new Error(
        `Unsupported file type: "${ext}". ` +
        `Supported formats: .json, .pdf, .jpg, .jpeg, .png, .tiff, .tif, .bmp`
      );
  }
}

function parseJsonBill(filePath: string): ParsedBill {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    return ParsedBillSchema.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON bill "${filePath}": ${(err as Error).message}`);
  }
}

async function parsePdfBill(filePath: string): Promise<ParsedBill> {
  const result = await runOcrPipeline(filePath);
  return billFromText(result.extractedData, 'pdf');
}

async function parseImageBill(filePath: string): Promise<ParsedBill> {
  const result = await runOcrPipeline(filePath);
  return billFromText(result.extractedData, 'image');
}
