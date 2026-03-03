import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { ParsedBillSchema, type ParsedBill, type LineItem } from '../schema/bill.js';
import { ocrImage } from './ocr.js';
import { parsePdf } from './pdf.js';

export async function parseBill(filePath: string): Promise<ParsedBill> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case '.json':
      return parseJsonBill(filePath);
    case '.pdf':
      return parsePdfBill(filePath);
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.tiff':
    case '.bmp':
      return parseImageBill(filePath);
    default:
      throw new Error(`Unsupported file type: ${ext}. Supported: .json, .pdf, .png, .jpg, .jpeg, .tiff, .bmp`);
  }
}

function parseJsonBill(filePath: string): ParsedBill {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  return ParsedBillSchema.parse(raw);
}

async function parsePdfBill(filePath: string): Promise<ParsedBill> {
  const { text } = await parsePdf(filePath);
  return extractBillFromText(text, 'pdf', 0.8);
}

async function parseImageBill(filePath: string): Promise<ParsedBill> {
  const { text, confidence } = await ocrImage(filePath);
  return extractBillFromText(text, 'image', confidence);
}

function extractBillFromText(
  text: string,
  sourceType: 'pdf' | 'image',
  confidence: number
): ParsedBill {
  const lines = text.split('\n').filter(l => l.trim());
  const lineItems: LineItem[] = [];
  let lineNumber = 0;

  // Regex: find CPT code (5 chars: digits or J/letter prefix) followed eventually by a dollar amount
  // CPT codes: 5 digits (99285) or letter+4 digits (J3490)
  const cptPattern = /\b([A-Z]?\d{4,5})\b/i;
  const amountPattern = /\$?([\d,]+\.?\d{0,2})/;

  for (const line of lines) {
    const cptMatch = line.match(cptPattern);
    const amountMatch = line.match(amountPattern);

    if (cptMatch && amountMatch) {
      const code = cptMatch[1].toUpperCase();
      // Validate it looks like a CPT/HCPCS code (not a random number)
      if (/^[A-Z]\d{4}$/.test(code) || /^\d{5}$/.test(code)) {
        lineNumber++;
        const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
        if (amount > 0) {
          lineItems.push({
            lineNumber,
            cptCode: code,
            description: line.replace(cptMatch[0], '').replace(amountMatch[0], '').trim().slice(0, 100) || code,
            billedAmount: amount,
            units: 1,
          });
        }
      }
    }
  }

  if (lineItems.length === 0) {
    throw new Error('Could not extract any line items from bill. No CPT codes with amounts found.');
  }

  // Detect facility type from text
  const lowerText = text.toLowerCase();
  let facilityType: ParsedBill['facilityType'] = 'unknown';
  if (lowerText.includes('emergency') || lowerText.includes(' er ') || lowerText.includes('e.r.')) {
    facilityType = 'er';
  } else if (lowerText.includes('hospital')) {
    facilityType = 'hospital';
  } else if (lowerText.includes('outpatient')) {
    facilityType = 'outpatient';
  } else if (lowerText.includes('clinic')) {
    facilityType = 'clinic';
  } else if (lowerText.includes('office')) {
    facilityType = 'office';
  }

  // Try to extract facility name (first line or line with common suffixes)
  let facilityName: string | undefined;
  for (const line of lines.slice(0, 5)) {
    if (/hospital|medical|health|clinic|center/i.test(line)) {
      facilityName = line.trim().slice(0, 100);
      break;
    }
  }

  const totalBilled = lineItems.reduce((sum, item) => sum + item.billedAmount, 0);

  return ParsedBillSchema.parse({
    facilityName,
    facilityType,
    lineItems,
    totalBilled,
    parseConfidence: confidence,
    sourceType,
  });
}
