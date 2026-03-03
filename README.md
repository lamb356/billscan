# BillScan

AI Medical Bill Auditor — Compare your medical bills against real CMS Medicare rates.

## What It Does

BillScan extracts CPT codes and billed amounts from your medical bill (JSON, PDF, or image), then matches each one against **4 federal CMS pricing databases**:

| Source | Description | Rates |
|--------|------------|-------|
| **PFS** | Physician Fee Schedule — facility & non-facility rates | 1,035,391 |
| **CLFS** | Clinical Lab Fee Schedule — CBC, metabolic panels, venipuncture | 2,130 |
| **ASP** | Average Sales Price — Part B injectable drugs (J-codes) | 876 |
| **OPPS** | Outpatient PPS / APC — hospital outpatient department rates | 18,986 |

**Total: 1,057,383 real CMS rates from the 2026 fee schedules.**

Plus:
- **42,956 ZIP-to-locality mappings** for geographic rate adjustments
- **6,121 nonprofit hospitals** for charity care checks
- **Insurance rate estimation** (HMO/PPO/OON multipliers from KFF/RAND research)
- **OCR pipeline** for scanning PDF and image bills

## Core Principles

- **NO FAKE DATA.** Every rate comes from real CMS fee schedule files downloaded from CMS.gov.
- **NO DEMO MODE.** The audit runs end-to-end against the actual database.
- **NEVER FABRICATE A RATE.** If a CPT code has no match, it's marked "unmatched" — never guessed.
- **BOTH RATES ALWAYS SHOWN.** Every finding shows both facility and non-facility rates.
- **TRANSPARENT MATCHING.** Every finding shows the match method and data source.

## Quick Start

```bash
# Install dependencies
npm install

# Download ALL CMS data (PFS + CLFS + ASP + OPPS + reference data)
npx tsx src/cli.ts fetch-all

# Audit a medical bill (JSON)
npx tsx src/cli.ts audit fixtures/sample-er-bill.json

# Audit with all options
npx tsx src/cli.ts audit bill.json --save --letter --phone --charity --zip 10001

# Audit with insurance rate comparison
npx tsx src/cli.ts audit bill.json --plan ppo
npx tsx src/cli.ts audit bill.json --eob eob-file.json

# Start the web server
npx tsx src/server-start.ts
```

## Commands

| Command | Description |
|---------|-------------|
| `fetch-all` | Download all 4 CMS data sources + seed reference data |
| `fetch-cms` | Download Physician Fee Schedule (PFS) only |
| `fetch-clfs` | Download Clinical Lab Fee Schedule (CLFS) only |
| `fetch-asp` | Download Drug ASP Pricing only |
| `fetch-opps` | Download OPPS/APC outpatient rates only |
| `audit <file>` | Audit a medical bill against all available CMS data |
| `stats` | Show aggregate audit statistics |

## Audit Options

| Flag | Description |
|------|-------------|
| `--save` | Save audit to database |
| `--letter` | Generate dispute letter |
| `--phone` | Generate phone negotiation script |
| `--json` | Output raw JSON report |
| `--cards` | Output viral summary card |
| `--setting <type>` | Force `facility` or `office` context |
| `--locality <code>` | CMS locality code |
| `--zip <zip>` | Resolve locality from ZIP code (42,956 ZIPs mapped) |
| `--charity` | Check charity care / nonprofit status (6,121 hospitals) |
| `--eob <file>` | Compare with Explanation of Benefits |
| `--plan <type>` | Estimate insurance rates: `hmo`, `ppo`, or `oon` |

## Supported Input Formats

| Format | Method |
|--------|--------|
| `.json` | Direct JSON parsing |
| `.pdf` | Text extraction, OCR fallback via Tesseract.js |
| `.jpg` / `.png` / `.tiff` | OCR via Tesseract.js |
| `.txt` | Text-based CPT extraction |

## Web Server

BillScan includes a built-in HTTP server with API and frontend:

```bash
npx tsx src/server-start.ts
# Server starts at http://localhost:3000
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check + rate count |
| `/api/data-sources` | GET | Loaded CMS data info |
| `/api/stats` | GET | Aggregate audit statistics |
| `/api/audit` | POST | Upload bill file (multipart) |
| `/api/audit/json` | POST | Submit bill JSON directly |
| `/api/charity-check` | POST | Check nonprofit hospital status |

### Frontend

The web frontend at `web/index.html` provides:
- Mobile-responsive dark theme design
- Drag-and-drop bill upload
- Real-time audit results with severity badges
- Insurance rate comparison (HMO/PPO/OON estimates)
- Charity care checker
- Export to JSON and print-friendly view

## Sample Output

```
┌─────┬────────┬──────────────────────────┬──────────┬───────────┬───────────┬──────────┬────────┬────────────┐
│  #  │ CPT    │ Description              │  Billed  │ CMS Fac.  │ CMS NonF. │  Delta   │ Source │ Match      │
├─────┼────────┼──────────────────────────┼──────────┼───────────┼───────────┼──────────┼────────┼────────────┤
│   1 │ 99285  │ Emergency dept visit ... │   $2,847 │   $183.72 │   $183.72 │ $2,663.28│ PFS    │ exact      │
│   7 │ 36415  │ Coll venous bld venip... │     $189 │     $9.34 │     $9.34 │  $179.66 │ CLFS   │ exact      │
│   8 │ 85025  │ Complete cbc w/auto d... │     $287 │     $7.77 │     $7.77 │  $279.23 │ CLFS   │ exact      │
│  11 │ J1100  │ Dexamethasone sodium ... │      $87 │     $0.10 │     $0.10 │   $86.89 │ ASP    │ exact      │
└─────┴────────┴──────────────────────────┴──────────┴───────────┴───────────┴──────────┴────────┴────────────┘
```

## Testing

```bash
# Run all tests (143 tests)
npm test

# Watch mode
npm run test:watch
```

Test coverage includes:
- All 4 CMS parsers (CLFS, ASP, OPPS, PFS)
- Multi-source rate matcher
- Charity care checker
- ZIP locality resolution (42K records)
- Bill parser + CPT extractor
- Hash utility

## Data Sources

All data is downloaded directly from [CMS.gov](https://www.cms.gov/):

- **PFS**: [Physician Fee Schedule](https://www.cms.gov/medicare/payment/fee-schedules/physician)
- **CLFS**: [Clinical Lab Fee Schedule](https://www.cms.gov/medicare/payment/fee-schedules/clinical-laboratory-fee-schedule-clfs)
- **ASP**: [Average Sales Price](https://www.cms.gov/medicare/payment/fee-for-service-providers/part-b-drugs/average-drug-sales-price)
- **OPPS**: [Outpatient PPS](https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient)
- **ZIP Locality**: [CMS Carrier Locality Crosswalk](https://www.cms.gov/medicare/payment/prospective-payment-systems)
- **Charity Hospitals**: [Community Benefit Insight](https://www.communitybenefitinsight.org/) + [CMS Provider of Services](https://data.cms.gov/)

Insurance rate estimates use multipliers from:
- [Kaiser Family Foundation](https://www.kff.org/) research
- [RAND Hospital Price Transparency Study](https://www.rand.org/)

## CI/CD

GitHub Actions runs on every push/PR:
- Tests across Node 20 and 22
- Type checking
- CLI verification
- Monthly CMS data source URL check

## License

MIT
