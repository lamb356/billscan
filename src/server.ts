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
import { checkCharityCare } from './analyzer/charity-care.js';
import { getAggregateStats } from './output/stats.js';
import { getDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body),
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
      save: params.save === 'true',
    };

    const report = await runAudit(tmpPath, auditOptions);

    // Optionally include charity care
    if (params.charity === 'true' && report.facilityName) {
      const charityResult = await checkCharityCare(report.facilityName, params.zip, params.state);
      sendJson(res, 200, { ...report, charityCheck: charityResult });
    } else {
      sendJson(res, 200, report);
    }
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
      save: params.save === 'true',
    };

    const report = await runAudit(tmpPath, auditOptions);

    if (params.charity === 'true' && report.facilityName) {
      const charityResult = await checkCharityCare(report.facilityName, params.zip, params.state);
      sendJson(res, 200, { ...report, charityCheck: charityResult });
    } else {
      sendJson(res, 200, report);
    }
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    return sendError(res, 404, `API endpoint not found: ${method} ${pathname}`);
  }

  // Static files
  serveStatic(pathname, res);
}

// ─── Start server ─────────────────────────────────────────────────────────────

async function startServer() {
  await runMigrations();

  const server = http.createServer(requestHandler);

  server.listen(PORT, () => {
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
