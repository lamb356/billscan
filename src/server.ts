/**
 * BillScan HTTP API Server
 * Uses Node.js built-in http module (no Express dependency required)
 * Exposes audit functionality via REST API
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { runAudit } from './analyzer/audit.js';
import { runEobAudit } from './analyzer/eob-audit.js';
import { buildInsuranceComparison, type InsuranceComparison } from './analyzer/insurance-comparison.js';
import { checkCharityCare } from './analyzer/charity-care.js';
import { detectBillingErrors } from './analyzer/billing-errors.js';
import { compareSiteOfService } from './analyzer/site-of-service.js';
import { detectBalanceBilling } from './analyzer/balance-billing.js';
import { buildSavingsSummary } from './analyzer/savings-summary.js';
import { getAggregateStats } from './output/stats.js';
import { generateAppealEvidence } from './dispute/appeal-generator.js';
import { generateDisputeLetter } from './dispute/letter-generator.js';
import { lookupHospitalPrices, getCashPrice, getNegotiatedRate, getPriceSummary } from './matcher/hospital-price-lookup.js';
import { getDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import type { ExtractedEobData } from './parser/eob-ocr-extractor.js';
import { findHospitalMRF, listHospitalMRFs } from './collector/hospital-mrf-finder.js';
import { parseHospitalPriceFile } from './collector/hospital-price-parser.js';
import { importHospitalPrices } from './collector/hospital-price-importer.js';

const PORT = Number(process.env.PORT) || 3000;
const WEB_DIR = path.resolve(process.cwd(), 'web');
const UPLOAD_LIMIT = 10 * 1024 * 1024; // 10MB

// ─── MIME types for static files ────────────────────────────────────────────
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.woff2': 'font/woff2',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body),
    // Privacy: prevent caching of any response containing user data
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'X-BillScan-Privacy': 'zero-storage',
  });
  res.end(body);
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJson(res, status, { error: message });
}

function parseQueryParams(url: string): Record<string, string> {
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return {};
  const params: Record<string, string> = {};
  const qs = url.slice(qIdx + 1);
  for (const part of qs.split('&')) {
    const [k, v] = part.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return params;
}

function getPath(url: string): string {
  return url.split('?')[0];
}

/** Read entire request body as a Buffer, enforcing size limit */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > UPLOAD_LIMIT) {
        reject(new Error('Request body exceeds 10MB limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Parse multipart/form-data body.
 * Returns: { fields: Record<string, string>, files: Array<{name, filename, data, contentType}> }
 */
function parseMultipart(
  body: Buffer,
  boundary: string
): {
  fields: Record<string, string>;
  files: Array<{ name: string; filename: string; data: Buffer; contentType: string }>;
} {
  const fields: Record<string, string> = {};
  const files: Array<{ name: string; filename: string; data: Buffer; contentType: string }> = [];

  const boundaryBuf = Buffer.from('--' + boundary);
  const CRLF = Buffer.from('\r\n');
  const CRLFCRLF = Buffer.from('\r\n\r\n');

  let pos = 0;

  // Find all boundary positions
  const parts: Buffer[] = [];
  while (pos < body.length) {
    const start = indexOf(body, boundaryBuf, pos);
    if (start === -1) break;
    pos = start + boundaryBuf.length;
    // Check for final boundary (--)
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break;
    // Skip CRLF after boundary
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
    // Find the next boundary
    const end = indexOf(body, boundaryBuf, pos);
    if (end === -1) break;
    // Part data is from pos to end-2 (strip trailing CRLF)
    parts.push(body.slice(pos, end - 2));
  }

  for (const part of parts) {
    const headerEnd = indexOf(part, CRLFCRLF, 0);
    if (headerEnd === -1) continue;

    const headerBlock = part.slice(0, headerEnd).toString('utf-8');
    const data = part.slice(headerEnd + 4);

    // Parse headers
    const headers: Record<string, string> = {};
    for (const line of headerBlock.split('\r\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      headers[line.slice(0, colonIdx).trim().toLowerCase()] = line.slice(colonIdx + 1).trim();
    }

    const disposition = headers['content-disposition'] ?? '';
    const nameMatch = disposition.match(/name="([^"]+)"/);
    const filenameMatch = disposition.match(/filename="([^"]*)"/);
    const fieldName = nameMatch ? nameMatch[1] : '';

    if (filenameMatch) {
      files.push({
        name: fieldName,
        filename: filenameMatch[1],
        data,
        contentType: headers['content-type'] ?? 'application/octet-stream',
      });
    } else {
      fields[fieldName] = data.toString('utf-8');
    }
  }

  return { fields, files };
}

function indexOf(haystack: Buffer, needle: Buffer, start: number): number {
  for (let i = start; i <= haystack.length - needle.length; i++) {
    let found = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}

/** Write a buffer to a temp file, return the path */
function writeTempFile(data: Buffer, ext: string): string {
  const tmpPath = path.join(os.tmpdir(), `billscan-${randomUUID()}${ext}`);
  fs.writeFileSync(tmpPath, data);
  return tmpPath;
}

/** Safely remove a temp file */
function cleanupTemp(p: string) {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}

// ─── Serve static files ───────────────────────────────────────────────────────

function serveStatic(reqPath: string, res: http.ServerResponse) {
  // Resolve to index.html for SPA routes
  let filePath = path.join(WEB_DIR, reqPath === '/' ? 'index.html' : reqPath);

  // Security: prevent path traversal
  if (!filePath.startsWith(WEB_DIR)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  if (!fs.existsSync(filePath)) {
    // Fallback to index.html for client-side routing
    const indexPath = path.join(WEB_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      filePath = indexPath;
    } else {
      sendError(res, 404, 'Not found');
      return;
    }
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': content.length,
    'Cache-Control': 'no-cache',
  });
  res.end(content);
}

// ─── API route handlers ───────────────────────────────────────────────────────

async function handleHealth(
  _req: http.IncomingMessage,
  res: http.ServerResponse
) {
  try {
    const db = getDb();
    const cmsRow = (await db.execute({ sql: 'SELECT COUNT(*) as c FROM cms_rates', args: [] })).rows[0];
    let total = (cmsRow as { c: number }).c;
    try {
      const clfsRow = (await db.execute({ sql: 'SELECT COUNT(*) as c FROM clfs_rates', args: [] })).rows[0];
      total += (clfsRow as { c: number }).c;
    } catch { /* table may not exist */ }
    try {
      const aspRow = (await db.execute({ sql: 'SELECT COUNT(*) as c FROM asp_rates', args: [] })).rows[0];
      total += (aspRow as { c: number }).c;
    } catch { /* table may not exist */ }
    try {
      const oppsRow = (await db.execute({ sql: 'SELECT COUNT(*) as c FROM opps_rates', args: [] })).rows[0];
      total += (oppsRow as { c: number }).c;
    } catch { /* table may not exist */ }

    sendJson(res, 200, { status: 'ok', rates: total, version: '0.3.0' });
  } catch (err) {
    sendJson(res, 200, { status: 'ok', rates: 0, version: '0.3.0', warning: (err as Error).message });
  }
}

async function handleDataSources(
  _req: http.IncomingMessage,
  res: http.ServerResponse
) {
  try {
    const db = getDb();
    const sources: Array<{ name: string; count: number; lastUpdated: string | null }> = [];

    const tableChecks: Array<{ name: string; table: string }> = [
      { name: 'PFS', table: 'cms_rates' },
      { name: 'CLFS', table: 'clfs_rates' },
      { name: 'ASP', table: 'asp_rates' },
      { name: 'OPPS', table: 'opps_rates' },
    ];

    for (const { name, table } of tableChecks) {
      try {
        const row = (await db.execute({ sql: `SELECT COUNT(*) as c FROM ${table}`, args: [] })).rows[0] as { c: number };
        // Try to get snapshot info
        let lastUpdated: string | null = null;
        try {
          const snap = (await db.execute({
            sql: `SELECT fetched_at FROM cms_snapshots ORDER BY fetched_at DESC LIMIT 1`,
            args: [],
          })).rows[0] as { fetched_at: string } | undefined;
          lastUpdated = snap?.fetched_at ?? null;
        } catch { /* ignore */ }
        sources.push({ name, count: row.c, lastUpdated });
      } catch {
        // table doesn't exist yet
      }
    }

    sendJson(res, 200, { sources });
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

async function handleStats(
  _req: http.IncomingMessage,
  res: http.ServerResponse
) {
  try {
    const stats = await getAggregateStats();
    sendJson(res, 200, stats);
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

async function handleAuditFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
) {
  const params = parseQueryParams(url);
  let tmpPath: string | null = null;

  try {
    const contentType = req.headers['content-type'] ?? '';
    let body: Buffer;

    try {
      body = await readBody(req);
    } catch (err) {
      return sendError(res, 413, (err as Error).message);
    }

    // Determine file extension and data
    let fileData: Buffer;
    let fileExt = '.json';
    let fileName = 'bill';

    if (contentType.includes('multipart/form-data')) {
      // Parse multipart
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) return sendError(res, 400, 'Missing multipart boundary');
      const { files } = parseMultipart(body, boundaryMatch[1]);
      if (files.length === 0) return sendError(res, 400, 'No file uploaded');
      const uploaded = files[0];
      fileData = uploaded.data;
      fileName = uploaded.filename || 'bill';
      fileExt = path.extname(fileName).toLowerCase() || '.json';
    } else if (contentType.includes('application/json')) {
      fileData = body;
      fileExt = '.json';
    } else if (contentType.includes('application/octet-stream') || body.length > 0) {
      fileData = body;
      // Try to detect from magic bytes
      if (body[0] === 0x25 && body[1] === 0x50) fileExt = '.pdf'; // %P
      else if (body[0] === 0xff && body[1] === 0xd8) fileExt = '.jpg'; // JPEG
      else if (body[0] === 0x89 && body[1] === 0x50) fileExt = '.png'; // PNG
      else fileExt = '.json';
    } else {
      return sendError(res, 400, 'No file data received');
    }

    // Write to temp file
    tmpPath = writeTempFile(fileData, fileExt);

    const auditOptions = {
      setting: (params.setting as 'facility' | 'office') || undefined,
      zip: params.zip || undefined,
      locality: params.locality || undefined,
      save: false, // Zero-storage: never persist user bill data
    };

    const { report, isEob, eob, eobRaw } = await runAudit(tmpPath, auditOptions);

    // Build response
    const response: Record<string, unknown> = { ...report };

    // Include EOB data if available
    if (isEob) {
      response.isEob = true;
      if (eobRaw) {
        response.eobData = {
          insurerName: eobRaw.insurerName,
          planType: eobRaw.planType,
          claimNumber: eobRaw.claimNumber,
          dateOfService: eobRaw.dateOfService,
          summary: eobRaw.summary,
        };
      }
    }

    // Build 3-way comparison
    // When EOB data came from OCR (inline), build comparisons directly from audit findings + EOB data
    // When plan param is specified, run the eob-audit module for estimation
    if (isEob && eobRaw) {
      // Build comparisons directly from already-parsed EOB data
      const comparisons = report.findings.map(finding => {
        // Try to find actual allowed from EOB line items
        const eobLine = eobRaw.lineItems.find(li =>
          li.cptCode === finding.cptCode ||
          (li.description && finding.description &&
           li.description.toLowerCase().includes(finding.description.toLowerCase().slice(0, 10)))
        );

        // For summary-only EOBs with 1 finding, use the summary's billed - discount as allowed
        let actualAllowed: number | null = eobLine?.allowedAmount ?? null;
        if (actualAllowed === null && eobRaw.summary && report.findings.length === 1) {
          // allowed = billed - network discount
          const billed = eobRaw.summary.amountBilled;
          const discount = eobRaw.summary.networkDiscount;
          if (billed !== null && discount !== null) {
            actualAllowed = +(billed - discount).toFixed(2);
          }
        }

        // Build the comparison, injecting actual allowed as a mock EOBLineItem
        const eobLineItem = actualAllowed !== null
          ? { allowedAmount: actualAllowed } as any
          : null;

        return buildInsuranceComparison(
          finding.cptCode,
          finding.description,
          finding.billedAmount,
          finding.cmsRateUsed,
          eobLineItem,
        );
      });

      // Calculate aggregate actual allowed
      const totalActualAllowed = comparisons.some(c => c.actualAllowed !== null)
        ? +comparisons.reduce((s, c) => s + (c.actualAllowed ?? 0), 0).toFixed(2)
        : null;

      response.insuranceComparison = {
        plan: eobRaw.planType || 'ppo',
        comparisons,
        totalActualAllowed,
        totalEstimatedAllowed: null,
        totalInsurancePaid: eobRaw.summary?.planPaid ?? null,
        totalPatientResponsibility: eobRaw.summary?.patientResponsibility ?? null,
        insights: generateEobInsights(comparisons, eobRaw),
        footnote: eobRaw.insurerName
          ? `EOB data from ${eobRaw.insurerName}${eobRaw.claimNumber ? `, claim ${eobRaw.claimNumber}` : ''}. Allowed amounts are actual insurer-negotiated rates.`
          : 'EOB data extracted from uploaded document.',
      };
    } else if (params.plan) {
      // No EOB data, but user specified a plan type — use estimation
      try {
        const eobOpts = {
          ...auditOptions,
          plan: params.plan as 'hmo' | 'ppo' | 'oon',
        };
        const eobAudit = await runEobAudit(tmpPath, eobOpts);
        response.insuranceComparison = {
          plan: eobAudit.plan,
          comparisons: eobAudit.comparisons,
          totalActualAllowed: eobAudit.totalActualAllowed,
          totalEstimatedAllowed: eobAudit.totalEstimatedAllowed,
          totalInsurancePaid: eobAudit.totalInsurancePaid,
          totalPatientResponsibility: eobAudit.totalPatientResponsibility,
          insights: eobAudit.insights,
          footnote: eobAudit.footnote,
        };
      } catch (err) {
        console.error('[server] EOB audit error:', err);
      }
    }

    // Optionally include charity care
    if (params.charity === 'true' && report.facilityName) {
      const charityResult = await checkCharityCare(report.facilityName, params.zip, params.state);
      response.charityCheck = charityResult;
    }

    // ── Hospital price enrichment ───────────────────────────────────────────
    try {
      response.findings = await enrichFindingsWithHospitalPrices(
        report.findings,
        report.facilityName,
      );
    } catch (err) {
      console.error('[server] Hospital price enrichment failed:', err);
    }

    // ── New analyzers ─────────────────────────────────────────────────────────

    // Determine rate context for billing error detection
    const rateContext: 'facility' | 'non_facility' = auditOptions.setting === 'office'
      ? 'non_facility'
      : (report.findings[0]?.rateContext ?? 'facility');

    // 1. Billing error detection
    try {
      const lineItemsForErrors = report.findings.map(f => ({
        cptCode: f.cptCode,
        description: f.description,
        billedAmount: f.billedAmount,
        lineNumber: f.lineNumber,
        modifier: undefined as string | undefined, // modifier not stored on finding
      }));
      const billingErrors = await detectBillingErrors(
        lineItemsForErrors,
        rateContext,
        auditOptions.locality || auditOptions.zip || undefined,
      );
      response.billingErrors = billingErrors;
    } catch (err) {
      console.error('[server] Billing error detection failed:', err);
      response.billingErrors = [];
    }

    // 2. Site-of-service comparison
    try {
      const lineItemsForSos = report.findings.map(f => ({
        cptCode: f.cptCode,
        description: f.description,
        billedAmount: f.billedAmount,
      }));
      const siteOfService = await compareSiteOfService(
        lineItemsForSos,
        auditOptions.locality || undefined,
      );
      response.siteOfService = siteOfService;
    } catch (err) {
      console.error('[server] Site-of-service comparison failed:', err);
      response.siteOfService = [];
    }

    // 3. Balance billing detection (only when EOB data is present)
    try {
      const findingsForBB = report.findings.map(f => ({
        cptCode: f.cptCode,
        description: f.description,
        billedAmount: f.billedAmount,
        cmsRateUsed: f.cmsRateUsed,
      }));

      // Build EOB data object if we have EOB info
      let eobDataForBB: {
        summary?: { amountBilled: number | null; patientResponsibility: number | null; planPaid: number | null; networkDiscount: number | null };
        lineItems?: Array<{ cptCode: string | null; billedAmount: number; allowedAmount: number | null; patientOwes: number | null }>;
      } | undefined;

      if (isEob && eobRaw) {
        eobDataForBB = {
          summary: eobRaw.summary ? {
            amountBilled: eobRaw.summary.amountBilled,
            patientResponsibility: eobRaw.summary.patientResponsibility,
            planPaid: eobRaw.summary.planPaid,
            networkDiscount: eobRaw.summary.networkDiscount,
          } : undefined,
          lineItems: eobRaw.lineItems?.map(li => ({
            cptCode: li.cptCode ?? null,
            billedAmount: li.billedAmount ?? 0,
            allowedAmount: li.allowedAmount ?? null,
            patientOwes: li.patientOwes ?? null,
          })),
        };
      }

      const balanceBilling = await detectBalanceBilling(findingsForBB, eobDataForBB);
      response.balanceBilling = balanceBilling;
    } catch (err) {
      console.error('[server] Balance billing detection failed:', err);
      response.balanceBilling = [];
    }

    // 4. Unified savings summary
    try {
      const savingsSummary = buildSavingsSummary(
        report.totalBilled,
        report.totalCmsBaseline,
        (response.billingErrors as any[]) || [],
        (response.siteOfService as any[]) || [],
        (response.balanceBilling as any[]) || [],
      );
      response.savingsSummary = savingsSummary;
    } catch (err) {
      console.error('[server] Savings summary failed:', err);
    }

    sendJson(res, 200, response);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('No CMS data')) {
      sendError(res, 503, 'CMS rate database not loaded. Run `billscan fetch-all` first.');
    } else {
      sendError(res, 422, msg);
    }
  } finally {
    if (tmpPath) cleanupTemp(tmpPath);
  }
}

async function handleAuditJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
) {
  const params = parseQueryParams(url);
  let tmpPath: string | null = null;

  try {
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendError(res, 413, (err as Error).message);
    }

    // Validate it's parseable JSON
    try {
      JSON.parse(body.toString('utf-8'));
    } catch {
      return sendError(res, 400, 'Invalid JSON body');
    }

    tmpPath = writeTempFile(body, '.json');

    const auditOptions = {
      setting: (params.setting as 'facility' | 'office') || undefined,
      zip: params.zip || undefined,
      locality: params.locality || undefined,
      save: false, // Zero-storage: never persist user bill data
    };

    const { report } = await runAudit(tmpPath, auditOptions);

    // Build response
    const response: Record<string, unknown> = { ...report };

    // Run 3-way comparison if plan specified
    if (params.plan) {
      try {
        const eobOpts = {
          ...auditOptions,
          plan: params.plan as 'hmo' | 'ppo' | 'oon',
        };
        const eobAudit = await runEobAudit(tmpPath, eobOpts);
        response.insuranceComparison = {
          plan: eobAudit.plan,
          comparisons: eobAudit.comparisons,
          totalEstimatedAllowed: eobAudit.totalEstimatedAllowed,
          insights: eobAudit.insights,
          footnote: eobAudit.footnote,
        };
      } catch (err) {
        console.error('[server] EOB audit error:', err);
      }
    }

    if (params.charity === 'true' && report.facilityName) {
      const charityResult = await checkCharityCare(report.facilityName, params.zip, params.state);
      response.charityCheck = charityResult;
    }

    // ── Hospital price enrichment (JSON endpoint) ─────────────────────────────
    try {
      response.findings = await enrichFindingsWithHospitalPrices(
        report.findings,
        report.facilityName,
      );
    } catch (err) {
      console.error('[server] Hospital price enrichment failed:', err);
    }

    // ── New analyzers (JSON endpoint) ───────────────────────────────────────

    const jsonRateContext: 'facility' | 'non_facility' = auditOptions.setting === 'office'
      ? 'non_facility'
      : (report.findings[0]?.rateContext ?? 'facility');

    // 1. Billing error detection
    try {
      const lineItemsForErrors = report.findings.map(f => ({
        cptCode: f.cptCode,
        description: f.description,
        billedAmount: f.billedAmount,
        lineNumber: f.lineNumber,
        modifier: undefined as string | undefined,
      }));
      response.billingErrors = await detectBillingErrors(
        lineItemsForErrors,
        jsonRateContext,
        auditOptions.locality || auditOptions.zip || undefined,
      );
    } catch (err) {
      console.error('[server] Billing error detection failed:', err);
      response.billingErrors = [];
    }

    // 2. Site-of-service comparison
    try {
      const lineItemsForSos = report.findings.map(f => ({
        cptCode: f.cptCode,
        description: f.description,
        billedAmount: f.billedAmount,
      }));
      response.siteOfService = await compareSiteOfService(
        lineItemsForSos,
        auditOptions.locality || undefined,
      );
    } catch (err) {
      console.error('[server] Site-of-service comparison failed:', err);
      response.siteOfService = [];
    }

    // 3. Balance billing detection (no EOB data in JSON endpoint, but still checks excessive markup)
    try {
      const findingsForBB = report.findings.map(f => ({
        cptCode: f.cptCode,
        description: f.description,
        billedAmount: f.billedAmount,
        cmsRateUsed: f.cmsRateUsed,
      }));
      response.balanceBilling = await detectBalanceBilling(findingsForBB);
    } catch (err) {
      console.error('[server] Balance billing detection failed:', err);
      response.balanceBilling = [];
    }

    // 4. Unified savings summary
    try {
      response.savingsSummary = buildSavingsSummary(
        report.totalBilled,
        report.totalCmsBaseline,
        (response.billingErrors as any[]) || [],
        (response.siteOfService as any[]) || [],
        (response.balanceBilling as any[]) || [],
      );
    } catch (err) {
      console.error('[server] Savings summary failed:', err);
    }

    sendJson(res, 200, response);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('No CMS data')) {
      sendError(res, 503, 'CMS rate database not loaded. Run `billscan fetch-all` first.');
    } else {
      sendError(res, 422, msg);
    }
  } finally {
    if (tmpPath) cleanupTemp(tmpPath);
  }
}

async function handleCharityCheck(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  try {
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendError(res, 413, (err as Error).message);
    }

    let parsed: { facilityName?: string; zip?: string; state?: string };
    try {
      parsed = JSON.parse(body.toString('utf-8'));
    } catch {
      return sendError(res, 400, 'Invalid JSON body');
    }

    if (!parsed.facilityName) {
      return sendError(res, 400, 'facilityName is required');
    }

    const result = await checkCharityCare(parsed.facilityName, parsed.zip, parsed.state);
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

// ─── Hospital Prices endpoint ─────────────────────────────────────────────────

async function handleHospitalPrices(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
) {
  try {
    const params = parseQueryParams(url);
    const code = params.code;
    if (!code) {
      return sendError(res, 400, 'Missing required query parameter: code');
    }

    const hospital = params.hospital || undefined;
    const payer = params.payer || undefined;

    const prices = await lookupHospitalPrices(code, hospital, payer);
    const summary = await getPriceSummary(code, hospital);

    sendJson(res, 200, {
      code,
      hospital: hospital ?? null,
      payer: payer ?? null,
      prices,
      summary,
    });
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

/**
 * Enrich audit findings with hospital price data if available.
 */
async function enrichFindingsWithHospitalPrices(
  findings: Array<any>,
  facilityName?: string
): Promise<Array<any>> {
  const enriched = [];
  for (const finding of findings) {
    try {
      const cashPrice = await getCashPrice(finding.cptCode, facilityName);
      const prices = await lookupHospitalPrices(finding.cptCode, facilityName);

      if (prices.length > 0 || cashPrice !== null) {
        const negotiatedRates = prices
          .filter(p => p.negotiatedRate !== null && p.payerName !== null)
          .map(p => ({
            payer: p.payerName!,
            plan: p.planName,
            rate: p.negotiatedRate!,
          }));

        const grossCharges = prices
          .filter(p => p.grossCharge !== null)
          .map(p => p.grossCharge!);

        finding.hospitalPrices = {
          cashPrice,
          negotiatedRates: negotiatedRates.length > 0 ? negotiatedRates : null,
          grossCharge: grossCharges.length > 0 ? grossCharges[0] : null,
        };
      }
    } catch {
      // Hospital price data not available — skip silently
    }
    enriched.push(finding);
  }
  return enriched;
}


async function handleAppeal(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  try {
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendError(res, 413, (err as Error).message);
    }

    let parsed: { findings?: any[]; eobData?: any; patientContext?: any };
    try {
      parsed = JSON.parse(body.toString('utf-8'));
    } catch {
      return sendError(res, 400, 'Invalid JSON body');
    }

    if (!parsed.findings || !Array.isArray(parsed.findings)) {
      return sendError(res, 400, 'findings array is required');
    }

    const appealEvidence = generateAppealEvidence(
      parsed.findings,
      parsed.eobData,
      parsed.patientContext,
    );
    sendJson(res, 200, appealEvidence);
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

// ─── Dispute Letter endpoint ──────────────────────────────────────────────────

async function handleDisputeLetter(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  let tmpPath: string | null = null;
  try {
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendError(res, 413, (err as Error).message);
    }

    let parsed: { report?: any };
    try {
      parsed = JSON.parse(body.toString('utf-8'));
    } catch {
      return sendError(res, 400, 'Invalid JSON body');
    }

    if (!parsed.report) {
      return sendError(res, 400, 'report object is required');
    }

    const letter = generateDisputeLetter(parsed.report);
    sendJson(res, 200, { letter });
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  } finally {
    if (tmpPath) cleanupTemp(tmpPath);
  }
}

// ─── Hospital MRF finder ─────────────────────────────────────────────────────

async function handleHospitalMrf(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
) {
  const params = parseQueryParams(url);
  const hospital = params.hospital;
  if (!hospital) {
    return sendError(res, 400, 'hospital query param is required');
  }

  const matches = findHospitalMRF(hospital, {
    state: params.state || undefined,
    threshold: params.threshold ? Number(params.threshold) : undefined,
    limit: params.limit ? Number(params.limit) : undefined,
  });

  sendJson(res, 200, { hospital, matches, total: matches.length });
}

async function handleHospitalMrfList(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const entries = listHospitalMRFs();
  sendJson(res, 200, { hospitals: entries, total: entries.length });
}

async function handleHospitalMrfImport(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
) {
  const params = parseQueryParams(url);
  const hospital = params.hospital;
  if (!hospital) {
    return sendError(res, 400, 'hospital query param is required');
  }

  try {
    // Find the MRF URL for this hospital
    const matches = findHospitalMRF(hospital, { limit: 1, threshold: 0.4 });
    if (matches.length === 0) {
      return sendError(res, 404, `No MRF URL found for hospital: ${hospital}`);
    }

    const match = matches[0];

    // Read body for optional overrides
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendError(res, 413, (err as Error).message);
    }

    let mrfUrl = match.mrfUrl;
    if (body.length > 0) {
      try {
        const parsed = JSON.parse(body.toString('utf-8'));
        if (parsed.mrfUrl) mrfUrl = parsed.mrfUrl;
      } catch {
        // Ignore parse errors — use the found URL
      }
    }

    // Parse and import
    const rows = await parseHospitalPriceFile(mrfUrl, mrfUrl);
    const result = await importHospitalPrices(rows, mrfUrl);

    sendJson(res, 200, {
      hospital: match.hospitalName,
      mrfUrl,
      imported: result.inserted,
      skipped: result.skipped,
    });
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

// ─── Audit history ───────────────────────────────────────────────────────────

async function handleListAudits(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
) {
  const params = parseQueryParams(url);
  const limit = Math.min(Number(params.limit) || 50, 200);
  const offset = Number(params.offset) || 0;

  try {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT id, report_id, total_billed, total_cms, total_savings,
                   finding_count, created_at, user_id
            FROM audits
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?`,
      args: [limit, offset],
    });

    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as cnt FROM audits`,
      args: [],
    });

    const total = (countResult.rows[0] as unknown as { cnt: number }).cnt;

    // Compute running totals
    const totalsResult = await db.execute({
      sql: `SELECT COALESCE(SUM(total_billed), 0) as total_billed,
                   COALESCE(SUM(total_cms), 0) as total_cms,
                   COALESCE(SUM(total_savings), 0) as total_savings,
                   COUNT(*) as audit_count
            FROM audits`,
      args: [],
    });

    const totals = totalsResult.rows[0] as unknown as {
      total_billed: number;
      total_cms: number;
      total_savings: number;
      audit_count: number;
    };

    sendJson(res, 200, {
      audits: result.rows,
      total,
      limit,
      offset,
      runningTotals: {
        totalBilled: totals.total_billed,
        totalCms: totals.total_cms,
        totalSavings: totals.total_savings,
        auditCount: totals.audit_count,
      },
    });
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

async function handleGetAudit(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  auditId: string
) {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT * FROM audits WHERE id = ? OR report_id = ?`,
      args: [auditId, auditId],
    });

    if (result.rows.length === 0) {
      return sendError(res, 404, 'Audit not found');
    }

    const row = result.rows[0] as unknown as {
      id: number;
      report_id: string;
      report_json: string;
      total_billed: number;
      total_cms: number;
      total_savings: number;
      finding_count: number;
      created_at: string;
      user_id: string | null;
    };

    let report;
    try {
      report = JSON.parse(row.report_json);
    } catch {
      report = null;
    }

    sendJson(res, 200, {
      id: row.id,
      reportId: row.report_id,
      totalBilled: row.total_billed,
      totalCms: row.total_cms,
      totalSavings: row.total_savings,
      findingCount: row.finding_count,
      createdAt: row.created_at,
      userId: row.user_id,
      report,
    });
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

async function handleDeleteAllUserData(
  _req: http.IncomingMessage,
  res: http.ServerResponse
) {
  try {
    const db = getDb();
    // Delete ALL user-generated data from every table
    await db.execute({ sql: 'DELETE FROM audits', args: [] });
    await db.execute({ sql: 'DELETE FROM community_prices', args: [] });
    await db.execute({ sql: 'DELETE FROM users', args: [] });
    // Clean up any temp files
    const tmpDir = os.tmpdir();
    const fs2 = await import('node:fs');
    const tmpFiles = fs2.readdirSync(tmpDir).filter(f => f.startsWith('billscan-'));
    for (const f of tmpFiles) {
      try { fs2.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
    }
    sendJson(res, 200, {
      deleted: true,
      message: 'All user data has been permanently deleted.',
      tablesCleared: ['audits', 'community_prices', 'users'],
      tempFilesCleaned: tmpFiles.length,
    });
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

async function handleDeleteAudit(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  auditId: string
) {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `DELETE FROM audits WHERE id = ? OR report_id = ?`,
      args: [auditId, auditId],
    });

    if (result.rowsAffected === 0) {
      return sendError(res, 404, 'Audit not found');
    }

    sendJson(res, 200, { deleted: true, id: auditId });
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

// ─── Community prices ────────────────────────────────────────────────────────

async function handleSubmitCommunityPrice(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  let body: Buffer;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendError(res, 413, (err as Error).message);
  }

  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf-8'));
  } catch {
    return sendError(res, 400, 'Invalid JSON body');
  }

  const { billingCode, description, amountPaid, payerName, planType, facilityName, facilityZip, dateOfService, isInsured } = parsed;

  if (!billingCode || amountPaid === undefined) {
    return sendError(res, 400, 'billingCode and amountPaid are required');
  }

  try {
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO community_prices
            (billing_code, description, amount_paid, payer_name, plan_type, facility_name, facility_zip, date_of_service, is_insured)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        billingCode,
        description || null,
        Number(amountPaid),
        payerName || null,
        planType || null,
        facilityName || null,
        facilityZip || null,
        dateOfService || null,
        isInsured !== undefined ? (isInsured ? 1 : 0) : 1,
      ],
    });

    sendJson(res, 201, { success: true, billingCode });
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

async function handleGetCommunityPrices(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
) {
  const params = parseQueryParams(url);
  const code = params.code;
  if (!code) {
    return sendError(res, 400, 'code query param is required');
  }

  try {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT * FROM community_prices WHERE billing_code = ? ORDER BY submitted_at DESC LIMIT 100`,
      args: [code],
    });

    // Compute stats
    const prices = result.rows as unknown as Array<{
      amount_paid: number;
      payer_name: string | null;
      plan_type: string | null;
      is_insured: number;
    }>;

    const amounts = prices.map(p => p.amount_paid);
    const avg = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
    const min = amounts.length > 0 ? Math.min(...amounts) : 0;
    const max = amounts.length > 0 ? Math.max(...amounts) : 0;
    const median = amounts.length > 0
      ? amounts.sort((a, b) => a - b)[Math.floor(amounts.length / 2)]
      : 0;

    sendJson(res, 200, {
      code,
      count: result.rows.length,
      stats: {
        avg: +avg.toFixed(2),
        min: +min.toFixed(2),
        max: +max.toFixed(2),
        median: +median.toFixed(2),
      },
      prices: result.rows,
    });
  } catch (err) {
    sendError(res, 500, (err as Error).message);
  }
}

// ─── Main request router ──────────────────────────────────────────────────────

async function requestHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  const pathname = getPath(url);

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // API routes
  if (pathname.startsWith('/api/')) {
    if (method === 'GET' && pathname === '/api/health') {
      return handleHealth(req, res);
    }
    if (method === 'GET' && pathname === '/api/stats') {
      return handleStats(req, res);
    }
    if (method === 'GET' && pathname === '/api/data-sources') {
      return handleDataSources(req, res);
    }
    if (method === 'POST' && pathname === '/api/audit') {
      return handleAuditFile(req, res, url);
    }
    if (method === 'POST' && pathname === '/api/audit/json') {
      return handleAuditJson(req, res, url);
    }
    if (method === 'POST' && pathname === '/api/charity-check') {
      return handleCharityCheck(req, res);
    }
    if (method === 'POST' && pathname === '/api/appeal') {
      return handleAppeal(req, res);
    }
    if (method === 'POST' && pathname === '/api/dispute-letter') {
      return handleDisputeLetter(req, res);
    }
    if (method === 'GET' && pathname === '/api/hospital-prices') {
      return handleHospitalPrices(req, res, url);
    }
    // Hospital MRF finder
    if (method === 'GET' && pathname === '/api/hospital-mrf') {
      return handleHospitalMrf(req, res, url);
    }
    if (method === 'GET' && pathname === '/api/hospital-mrf/list') {
      return handleHospitalMrfList(req, res);
    }
    if (method === 'POST' && pathname === '/api/hospital-mrf/import') {
      return handleHospitalMrfImport(req, res, url);
    }
    // Audit history
    if (method === 'GET' && pathname === '/api/audits') {
      return handleListAudits(req, res, url);
    }
    if (method === 'GET' && pathname.startsWith('/api/audits/')) {
      const auditId = pathname.split('/api/audits/')[1];
      return handleGetAudit(req, res, auditId);
    }
    if (method === 'DELETE' && pathname.startsWith('/api/audits/')) {
      const auditId = pathname.split('/api/audits/')[1];
      return handleDeleteAudit(req, res, auditId);
    }
    // Community prices
    if (method === 'POST' && pathname === '/api/community-price') {
      return handleSubmitCommunityPrice(req, res);
    }
    if (method === 'GET' && pathname === '/api/community-prices') {
      return handleGetCommunityPrices(req, res, url);
    }
    // Privacy: Delete all user data
    if (method === 'DELETE' && pathname === '/api/user-data') {
      return handleDeleteAllUserData(req, res);
    }
    if (method === 'GET' && pathname === '/api/privacy-info') {
      return sendJson(res, 200, {
        policy: 'zero-storage',
        description: 'BillScan does not store your medical bills, EOBs, or personal health information. All processing happens in memory and data is discarded immediately after your results are returned.',
        hashing: 'BLAKE3 only (@noble/hashes — audited, zero-dependency)',
        tempFiles: 'Deleted immediately after processing',
        auditHistory: 'Not stored on server — results are returned to your browser only',
        encryption: 'All uploads are hashed with BLAKE3 for integrity verification. Original files are never stored.',
        dataStored: ['CMS Medicare rates (public government data)', 'Hospital price transparency data (public government data)', 'Community-submitted anonymous price reports (no PII)'],
        dataNotStored: ['Your medical bills', 'Your EOBs', 'Your name or personal information', 'Your insurance details', 'Audit results or reports'],
      });
    }
    return sendError(res, 404, `API endpoint not found: ${method} ${pathname}`);
  }

  // Static files
  serveStatic(pathname, res);
}

// ─── Start server ─────────────────────────────────────────────────────────────

async function startServer() {
  await runMigrations();

  const server = http.createServer(requestHandler);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[billscan] Server running at http://localhost:${PORT}`);
    console.log(`[billscan] API: http://localhost:${PORT}/api/health`);
    console.log(`[billscan] UI:  http://localhost:${PORT}/`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[billscan] Port ${PORT} is already in use. Set PORT env var to use a different port.`);
    } else {
      console.error('[billscan] Server error:', err);
    }
    process.exit(1);
  });

  return server;
}

const server = startServer().catch((err) => {
  console.error('[billscan] Failed to start server:', err);
  process.exit(1);
});

export { server };

// ─── EOB insight generation (used when building comparisons in-server) ────────

function generateEobInsights(
  comparisons: InsuranceComparison[],
  eobRaw: ExtractedEobData,
): Array<{ type: string; cptCode: string; message: string }> {
  const insights: Array<{ type: string; cptCode: string; message: string }> = [];

  for (const c of comparisons) {
    if (c.cmsRate === null) continue;

    // Insight: Insurance allowed more than Medicare
    if (c.actualAllowed !== null && c.actualAllowed > c.cmsRate * 1.5) {
      const ratio = (c.actualAllowed / c.cmsRate).toFixed(1);
      insights.push({
        type: 'info',
        cptCode: c.cptCode,
        message: `Insurance allowed $${c.actualAllowed.toFixed(2)} (${ratio}x Medicare rate of $${c.cmsRate.toFixed(2)})`,
      });
    }

    // Insight: Billed amount much higher than allowed
    if (c.actualAllowed !== null && c.billedAmount > c.actualAllowed * 2) {
      const ratio = (c.billedAmount / c.actualAllowed).toFixed(1);
      insights.push({
        type: 'warning',
        cptCode: c.cptCode,
        message: `Provider billed $${c.billedAmount.toFixed(2)} but insurance only allowed $${c.actualAllowed.toFixed(2)} (${ratio}x difference)`,
      });
    }

    // Insight: Patient savings from having insurance
    if (c.actualAllowed !== null && eobRaw.summary?.patientResponsibility !== null) {
      const wouldOwe = c.billedAmount;
      const actuallyOwes = eobRaw.summary!.patientResponsibility!;
      if (wouldOwe > actuallyOwes * 3) {
        insights.push({
          type: 'info',
          cptCode: c.cptCode,
          message: `Without insurance, you would owe $${wouldOwe.toFixed(2)} instead of $${actuallyOwes.toFixed(2)} — insurance saved you $${(wouldOwe - actuallyOwes).toFixed(2)}`,
        });
      }
    }
  }

  return insights;
}
