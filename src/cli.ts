import { Command } from 'commander';
import { fetchCmsData } from './collector/cms-fetcher.js';
import { parseCmsCsv } from './collector/cms-parser.js';
import { importCmsRates } from './collector/cms-importer.js';
import { runAudit } from './analyzer/audit.js';
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
  .version('0.1.0');

program
  .command('fetch-cms')
  .description('Download and import CMS fee schedule data')
  .option('--year <year>', 'Fee schedule year', String(new Date().getFullYear()))
  .option('--refresh', 'Force re-download even if cached', false)
  .action(async (opts) => {
    try {
      const year = parseInt(opts.year);
      console.log(`\n=== BillScan CMS Data Fetcher ===`);
      console.log(`Year: ${year} | Refresh: ${opts.refresh}\n`);

      const { csvPath, sourceUrl } = await fetchCmsData(year, opts.refresh);
      const { rates, rawHash } = await parseCmsCsv(csvPath, year);
      const { snapshotId, rowCount, cached } = importCmsRates(
        rates, sourceUrl, year, rawHash, basename(csvPath), opts.refresh
      );

      console.log(`\n✅ Done — ${rowCount} rates imported (snapshot #${snapshotId}, cached: ${cached})`);
    } catch (err) {
      console.error(`\n❌ ${(err as Error).message}`);
      process.exit(1);
    } finally {
      closeDb();
    }
  });

program
  .command('audit <file>')
  .description('Audit a medical bill against CMS rates')
  .option('--save', 'Save audit to database', false)
  .option('--letter', 'Generate dispute letter', false)
  .option('--phone', 'Generate phone negotiation script', false)
  .option('--json', 'Output raw JSON report', false)
  .option('--cards', 'Output viral summary card', false)
  .option('--setting <type>', 'Force facility or office context', '')
  .option('--locality <code>', 'CMS locality code', '')
  .action(async (file, opts) => {
    try {
      const auditOpts: any = { save: opts.save };
      if (opts.setting === 'facility' || opts.setting === 'office') {
        auditOpts.setting = opts.setting;
      }
      if (opts.locality) {
        auditOpts.locality = opts.locality;
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
