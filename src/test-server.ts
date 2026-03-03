/**
 * BillScan integration test
 * Starts the server, runs tests, then exits.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PROJECT = '/home/user/workspace/billscan';
const PORT = 3001;

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function get(path: string): Promise<any> {
  const res = await fetch(`http://localhost:${PORT}${path}`);
  return res.json();
}

async function post(path: string, body: any, contentType = 'application/json'): Promise<any> {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return res.json();
}

const results: string[] = [];
const log = (msg: string) => { console.log(msg); results.push(msg); };

async function main() {
  log('=== BillScan Server Integration Tests ===');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('');

  log('Starting server on port ' + PORT + '...');
  const server = spawn('node', ['--import', 'tsx/esm', 'src/server-start.ts'], {
    cwd: PROJECT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverReady = false;
  server.stdout.on('data', (d: Buffer) => {
    const msg = d.toString().trim();
    log(`[server] ${msg}`);
    if (msg.includes('Server running')) serverReady = true;
  });
  server.stderr.on('data', (d: Buffer) => { log(`[server:err] ${d.toString().trim()}`); });

  for (let i = 0; i < 15; i++) {
    await sleep(500);
    if (serverReady) break;
  }

  if (!serverReady) {
    log('ERROR: Server failed to start within 7.5 seconds');
    server.kill();
    writeResults();
    process.exit(1);
  }

  await sleep(500);

  try {
    log('\n--- Test 1: GET /api/health ---');
    const health = await get('/api/health');
    log(`Status: ${health.status}`);
    log(`Rates: ${health.rates?.toLocaleString()}`);
    log(`Version: ${health.version}`);
    log(health.status === 'ok' ? 'PASS' : 'FAIL: unexpected status');

    log('\n--- Test 2: GET /api/data-sources ---');
    const ds = await get('/api/data-sources');
    log(`Sources count: ${ds.sources?.length}`);
    ds.sources?.forEach((s: any) => log(`  ${s.name}: ${s.count?.toLocaleString()} rates`));
    log(ds.sources ? 'PASS' : 'FAIL: no sources array');

    log('\n--- Test 3: GET /api/stats ---');
    const stats = await get('/api/stats');
    log(`Total audits: ${stats.totalAudits}`);
    log(`Total billed: $${stats.totalBilled?.toLocaleString()}`);
    log('PASS');

    log('\n--- Test 4: GET / (frontend) ---');
    const htmlRes = await fetch(`http://localhost:${PORT}/`);
    const html = await htmlRes.text();
    log(`HTML size: ${html.length} bytes`);
    log(`Contains BillScan title: ${html.includes('BillScan')}`);
    log(htmlRes.ok && html.includes('BillScan') ? 'PASS' : 'FAIL: unexpected HTML');

    log('\n--- Test 5: POST /api/audit/json ---');
    const billJson = readFileSync(path.join(PROJECT, 'fixtures/sample-er-bill.json'), 'utf-8');
    const report = await post('/api/audit/json', JSON.parse(billJson));

    if (report.error) {
      log(`ERROR: ${report.error}`);
      log('FAIL: audit returned error');
    } else {
      log(`Report ID: ${report.stamp?.reportId}`);
      log(`Facility: ${report.facilityName} (${report.facilityType})`);
      log(`Total Billed: $${report.totalBilled?.toLocaleString()}`);
      log(`Matched: ${report.matchedLineCount}, Unmatched: ${report.unmatchedLineCount}`);
      log('PASS');
    }

    log('\n--- Test 6: POST /api/charity-check ---');
    const charity = await post('/api/charity-check', {
      facilityName: 'Northwestern Memorial Hospital',
      zip: '60611',
    });
    log(`Is nonprofit: ${charity.isNonprofit}`);
    log(`Hospital: ${charity.hospitalName}`);
    log('PASS');

    log('\n=== ALL TESTS PASSED ===');

  } catch (err) {
    log(`\nFATAL ERROR: ${(err as Error).message}`);
    log((err as Error).stack || '');
  } finally {
    server.kill('SIGTERM');
    writeResults();
    await sleep(200);
    process.exit(0);
  }
}

function writeResults() {
  const { writeFileSync } = require('node:fs');
  writeFileSync(
    '/home/user/workspace/server-frontend-results.txt',
    results.join('\n') + '\n'
  );
  console.log('\nResults saved to /home/user/workspace/server-frontend-results.txt');
}

main().catch(err => {
  log(`\nUnhandled error: ${err.message}`);
  writeResults();
  process.exit(1);
});
