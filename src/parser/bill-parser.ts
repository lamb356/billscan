import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { BillSchema } from '../schema/bill.js';
import type { Bill } from '../schema/bill.js';

export async function parseBill(filePath: string): Promise<Bill> {
  if (!existsSync(filePath)) {
    throw new Error(`Bill file not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case '.json':
      return parseJsonBill(filePath);
    case '.pdf':
      return parsePdfBill(filePath);
    default:
      throw new Error(`Unsupported file type: ${ext}. Supported: .json, .pdf`);
  }
}

function parseJsonBill(filePath: string): Bill {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  return BillSchema.parse(raw);
}

async function parsePdfBill(filePath: string): Promise<Bill> {
  const { extractPdfText } = await import('./pdf.js');
  const text = await extractPdfText(filePath);
  return parseTextBill(text);
}

function parseTextBill(text: string): Bill {
  // Basic text extraction — looks for common patterns in medical bills
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Try to find facility name
  const facilityName = lines[0] || 'Unknown Facility';

  // Look for CPT codes and amounts (pattern: 5-digit code followed by dollar amount)
  const lineItems: Bill['lineItems'] = [];
  const cptPattern = /\b([0-9]{5}|[A-Z][0-9]{4})\b.*?\$?([0-9]+\.?[0-9]*)$/;

  let lineNum = 1;
  for (const line of lines) {
    const match = line.match(cptPattern);
    if (match) {
      lineItems.push({
        lineNumber: lineNum++,
        cptCode: match[1],
        description: line.split(match[1])[0].trim() || undefined,
        billedAmount: parseFloat(match[2]),
      });
    }
  }

  if (lineItems.length === 0) {
    throw new Error('Could not extract any CPT codes from PDF. Try using JSON format.');
  }

  return BillSchema.parse({
    facilityName,
    facilityType: 'unknown',
    totalBilled: lineItems.reduce((sum, i) => sum + i.billedAmount, 0),
    lineItems,
  });
}
