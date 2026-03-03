import { Command } from 'commander';
import { fetchCmsData } from './collector/cms-fetcher.js';
import { parseCmsCsv } from './collector/cms-parser.js';
import { importCmsRates } from './collector/cms-importer.js';
import { fetchClfsData, fetchAspData, fetchOppsData } from './collector/multi-fetcher.js';
import { parseClfsCsv } from './collector/clfs-parser.js';
import { parseAspCsv } from './collector/asp-parser.js';
import { parseOppsCsv } from './collector/opps-parser.js';
import { importClfsRates, importAspRates, importOppsRates } from './collector/multi-importer.js';
import { runAudit } from './analyzer/audit.js';
import { checkCharityCare, seedCharityHospitals } from './analyzer/charity-care.js';
import { seedZipLocality } from './matcher/zip-locality.js';
import { formatReportConsole } from './output/report-builder.js';
import { renderViralCard } from './output/card-renderer.js';
import { getAggregateStats, formatStats } from './output/stats.js';
import { generateDisputeLetter } from './dispute/letter-generator.js';
import { generatePhoneScript } from './dispute/phone-script.js';
import { closeDb } from './db/connection.js';
import { basename } from 'node:path';

const program = new Command();

program
  .name('billscan')
  .description('AI Medical Bill Auditor — Compare bills against real CMS Medicare rates')
  .version('0.2.0');

program
  .command('fetch-cms')
  .description('Download and import CMS Physician Fee Schedule data')
  .option('--year <year>', 'Fee schedule year', String(new Date().getFullYear()))
  .option('--refresh', 'Force re-download even if cached', false)
  .action(async (opts) => {
    try {
      const year = parseInt(opts.year);
      console.log(`\n=== BillScan CMS PFS Fetcher ===`);
      console.log(`Year: ${year} | Refresh: ${opts.refresh}\n`);

      const { csvPath, sourceUrl } = await fetchCmsData(year, opts.refresh);
      const { rates, rawHash } = await parseCmsCsv(csvPath, year);
      const { snapshotId, rowCount, cached } = importCmsRates(
        rates, sourceUrl, year, rawHash, basename(csvPath), opts.refresh
      );

      console.log(`\n✅ PFS — ${rowCount} rates imported (snapshot #${snapshotId}, cached: ${cached})`);
    } catch (err) {
      console.error(`\n❌ ${(err as Error).message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('fetch-clfs')
  .description('Download and import CMS Clinical Lab Fee Schedule data')
  .option('--year <year>', 'Fee schedule year', String(new Date().getFullYear()))
  .option('--refresh', 'Force re-download even if cached', false)
  .action(async (opts) => {
    try {
      const year = parseInt(opts.year);
      console.log(`\n=== BillScan CMS CLFS Fetcher ===`);
      console.log(`Year: ${year} | Refresh: ${opts.refresh}\n`);

      const { csvPath, sourceUrl, fileName } = await fetchClfsData(year, opts.refresh);
      const { rates, rawHash } = await parseClfsCsv(csvPath, year);
      const { snapshotId, rowCount, cached } = importClfsRates(rates, sourceUrl, year, rawHash, fileName);

      console.log(`\n✅ CLFS — ${rowCount} lab rates imported (snapshot #${snapshotId}, cached: ${cached})`);
    } catch (err) {
      console.error(`\n❌ ${(err as Error).message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('fetch-asp')
  .description('Download and import CMS Drug ASP pricing data')
  .option('--year <year>', 'Fee schedule year', String(new Date().getFullYear()))
  .option('--refresh', 'Force re-download even if cached', false)
  .action(async (opts) => {
    try {
      const year = parseInt(opts.year);
      console.log(`\n=== BillScan CMS ASP Fetcher ===`);
      console.log(`Year: ${year} | Refresh: ${opts.refresh}\n`);

      const { csvPath, sourceUrl, fileName } = await fetchAspData(year, opts.refresh);
      const { rates, rawHash } = await parseAspCsv(csvPath, year);
      const { snapshotId, rowCount, cached } = importAspRates(rates, sourceUrl, year, rawHash, fileName);

      console.log(`\n✅ ASP — ${rowCount} drug rates imported (snapshot #${snapshotId}, cached: ${cached})`);
    } catch (err) {
      console.error(`\n❌ ${(err as Error).message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('fetch-opps')
  .description('Download and import CMS OPPS/APC outpatient rates')
  .option('--year <year>', 'Fee schedule year', String(new Date().getFullYear()))
  .option('--refresh', 'Force re-download even if cached', false)
  .action(async (opts) => {
    try {
      const year = parseInt(opts.year);
      console.log(`\n=== BillScan CMS OPPS Fetcher ===`);
      console.log(`Year: ${year} | Refresh: ${opts.refresh}\n`);

      const { csvPath, sourceUrl, fileName } = await fetchOppsData(year, opts.refresh);
      const { rates, rawHash } = await parseOppsCsv(csvPath, year);
      const { snapshotId, rowCount, cached } = importOppsRates(rates, sourceUrl, year, rawHash, fileName);

      console.log(`\n✅ OPPS — ${rowCount} APC rates imported (snapshot #${snapshotId}, cached: ${cached})`);
    } catch (err) {
      console.error(`\n❌ ${(err as Error).message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('fetch-all')
  .description('Download ALL CMS data sources (PFS + CLFS + ASP + OPPS + seed data)')
  .option('--year <year>', 'Fee schedule year', String(new Date().getFullYear()))
  .option('--refresh', 'Force re-download even if cached', false)
  .action(async (opts) => {
    try {
      const year = parseInt(opts.year);
      console.log(`\n════════════════════════════════════════════`);
      console.log(`  BillScan — Fetch ALL CMS Data Sources`);
      console.log(`  Year: ${year} | Refresh: ${opts.refresh}`);
      console.log(`════════════════════════════════════════════\n`);

      // 1. PFS
      console.log(`\n─── [1/6] Physician Fee Schedule (PFS) ───`);
      try {
        const { csvPath, sourceUrl } = await fetchCmsData(year, opts.refresh);
        const { rates, rawHash } = await parseCmsCsv(csvPath, year);
        const { rowCount, cached } = importCmsRates(rates, sourceUrl, year, rawHash, basename(csvPath), opts.refresh);
        console.log(`✅ PFS: ${rowCount} rates (cached: ${cached})`);
      } catch (err) {
        console.error(`⚠️  PFS failed: ${(err as Error).message}`);
      }

      // 2. CLFS
      console.log(`\n─── [2/6] Clinical Lab Fee Schedule (CLFS) ───`);
      try {
        const { csvPath, sourceUrl, fileName } = await fetchClfsData(year, opts.refresh);
        const { rates, rawHash } = await parseClfsCsv(csvPath, year);
        const { rowCount, cached } = importClfsRates(rates, sourceUrl, year, rawHash, fileName);
        console.log(`✅ CLFS: ${rowCount} lab rates (cached: ${cached})`);
      } catch (err) {
        console.error(`⚠️  CLFS failed: ${(err as Error).message}`);
      }

      // 3. ASP
      console.log(`\n─── [3/6] Drug Average Sales Price (ASP) ───`);
      try {
        const { csvPath, sourceUrl, fileName } = await fetchAspData(year, opts.refresh);
        const { rates, rawHash } = await parseAspCsv(csvPath, year);
        const { rowCount, cached } = importAspRates(rates, sourceUrl, year, rawHash, fileName);
        console.log(`✅ ASP: ${rowCount} drug rates (cached: ${cached})`);
      } catch (err) {
        console.error(`⚠️  ASP failed: ${(err as Error).message}`);
      }

      // 4. OPPS
      console.log(`\n─── [4/6] Outpatient PPS / APC (OPPS) ───`);
      try {
        const { csvPath, sourceUrl, fileName } = await fetchOppsData(year, opts.refresh);
        const { rates, rawHash } = await parseOppsCsv(csvPath, year);
        const { rowCount, cached } = importOppsRates(rates, sourceUrl, year, rawHash, fileName);
        console.log(`✅ OPPS: ${rowCount} APC rates (cached: ${cached})`);
      } catch (err) {
        console.error(`⚠️  OPPS failed: ${(err as Error).message}`);
      }

      // 5. ZIP locality
      console.log(`\n─── [5/6] ZIP-to-Locality Mapping ───`);
      seedZipLocality();
      console.log(`✅ ZIP locality data seeded`);

      // 6. Charity hospitals
      console.log(`\n─── [6/6] Charity Care Database ───`);
      seedCharityHospitals();
      console.log(`✅ Charity hospital data seeded`);

      console.log(`\n════════════════════════════════════════════`);
      console.log(`  ✅ All data sources loaded for ${year}`);
      console.log(`════════════════════════════════════════════\n`);
    } catch (err) {
      console.error(`\n❌ ${(err as Error).message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('audit <file>')
  .description('Audit a medical bill against CMS rates (multi-source)')
  .option('--save', 'Save audit to database', false)
  .option('--letter', 'Generate dispute letter', false)
  .option('--phone', 'Generate phone negotiation script', false)
  .option('--json', 'Output raw JSON report', false)
  .option('--cards', 'Output viral summary card', false)
  .option('--setting <type>', 'Force facility or office context', '')
  .option('--locality <code>', 'CMS locality code', '')
  .option('--zip <zip>', 'Resolve locality from ZIP code', '')
  .option('--charity', 'Check charity care / nonprofit status', false)
  .action(async (file, opts) => {
    try {
      const auditOpts: any = { save: opts.save };
      if (opts.setting === 'facility' || opts.setting === 'office') {
        auditOpts.setting = opts.setting;
      }
      if (opts.locality) {
        auditOpts.locality = opts.locality;
      }
      if (opts.zip) {
        auditOpts.zip = opts.zip;
      }

      const report = await runAudit(file, auditOpts);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log('\n' + formatReportConsole(report));
      }

      if (opts.cards) {
        console.log('\n' + renderViralCard(report));
      }

      if (opts.charity && report.facilityName) {
        console.log('\n=== CHARITY CARE CHECK ===\n');
        const charityResult = checkCharityCare(report.facilityName);
        for (const line of charityResult.advice) {
          console.log(`  ${line}`);
        }
      }

      if (opts.letter) {
        console.log('\n=== DISPUTE LETTER ===\n');
        console.log(generateDisputeLetter(report));
      }

      if (opts.phone) {
        console.log('\n=== PHONE SCRIPT ===\n');
        console.log(generatePhoneScript(report));
      }
    } catch (err) {
      console.error(`\n❌ ${(err as Error).message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('stats')
  .description('Show aggregate audit statistics')
  .action(() => {
    try {
      const stats = getAggregateStats();
      console.log('\n' + formatStats(stats));
    } catch (err) {
      console.error(`\n❌ ${(err as Error).message}`);
    } finally {
      closeDb();
    }
  });

program.parse();
