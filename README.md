# BillScan

AI Medical Bill Auditor — Compare your medical bills against real CMS Medicare rates.

## What It Does

BillScan extracts CPT codes and billed amounts from your medical bill, then matches each one against **4 federal CMS pricing databases**:

| Source | Description | Rates |
|--------|------------|-------|
| **PFS** | Physician Fee Schedule — facility & non-facility rates | 1,035,391 |
| **CLFS** | Clinical Lab Fee Schedule — CBC, metabolic panels, venipuncture | 2,130 |
| **ASP** | Average Sales Price — Part B injectable drugs (J-codes) | 876 |
| **OPPS** | Outpatient PPS / APC — hospital outpatient department rates | 18,986 |

**Total: 1,057,383 real CMS rates from the 2026 fee schedules.**

## Core Principles

- **NO FAKE DATA** — Every rate comes directly from official CMS sources
- **Transparency** — Every report includes a cryptographic hash of the CMS data used
- **BLAKE3 hashing** — Immutable audit trail for every bill and report

## Installation

```bash
npm install
```

## Quick Start

```bash
# 1. Download all CMS data sources (one-time setup)
npx tsx src/cli.ts fetch-all --year 2026

# 2. Audit a bill
npx tsx src/cli.ts audit ./fixtures/sample-er-bill.json

# 3. Full audit with all outputs
npx tsx src/cli.ts audit ./bill.json --save --letter --phone --cards --charity
```

## CLI Commands

### Data Fetching

```bash
# Fetch all CMS sources (recommended)
npx tsx src/cli.ts fetch-all --year 2026

# Or fetch individually
npx tsx src/cli.ts fetch-cms --year 2026    # Physician Fee Schedule
npx tsx src/cli.ts fetch-clfs --year 2026   # Clinical Lab Fee Schedule  
npx tsx src/cli.ts fetch-asp --year 2026    # Drug Average Sales Price
npx tsx src/cli.ts fetch-opps --year 2026   # Outpatient PPS
```

### Auditing

```bash
# Basic audit
npx tsx src/cli.ts audit ./bill.json

# Full audit with all features
npx tsx src/cli.ts audit ./bill.json \
  --save          # Save to database \
  --letter        # Generate dispute letter \
  --phone         # Generate phone script \
  --cards         # Show summary card \
  --charity       # Check nonprofit/charity care \
  --zip 90048     # Use ZIP for locality rates \
  --setting facility  # Force facility context

# Output as JSON
npx tsx src/cli.ts audit ./bill.json --json

# Show aggregate stats
npx tsx src/cli.ts stats
```

## Bill Format

JSON bills follow this schema:

```json
{
  "facilityName": "Memorial General Hospital",
  "facilityType": "er",
  "serviceDate": "2026-01-15",
  "totalBilled": 8947.50,
  "lineItems": [
    {
      "lineNumber": 1,
      "cptCode": "99285",
      "description": "Emergency department visit, high complexity",
      "billedAmount": 2850.00
    },
    {
      "lineNumber": 2, 
      "cptCode": "85025",
      "description": "CBC with differential",
      "billedAmount": 285.00
    }
  ]
}
```

## CMS Data Sources

| Source | URL | Coverage |
|--------|-----|----------|
| PFS | cms.gov/medicare/payment/fee-schedules/physician | All physician services |
| CLFS | cms.gov/medicare/payment/fee-schedules/clinical-lab | Lab tests |
| ASP | cms.gov/medicare/payment/fee-schedules/drugs | Part B drugs |
| OPPS | cms.gov/medicare/payment/prospective-payment-system/hospital-outpatient | Hospital outpatient |

## Output Example

```
═══════════════════════════════════════════════════════
  BILLSCAN AUDIT REPORT
═══════════════════════════════════════════════════════
  Facility: Memorial General Hospital
  Total Billed:        $8,947.50
  CMS Baseline:        $1,203.42
  Potential Savings:   $7,744.08
  Lines Matched:       12
  Lines Unmatched:     0
  Avg Overcharge:      4.2x Medicare Rate

  Data Sources: PFS, CLFS, ASP, OPPS
  CMS Year: 2026
```

## Architecture

```
src/
  analyzer/     # Audit engine + charity care checker
  collector/    # CMS fetchers + parsers for all 4 sources
  db/           # SQLite connection + migrations
  dispute/      # Letter + phone script generators
  matcher/      # Multi-source rate matcher + ZIP locality
  output/       # Report formatting + viral card renderer
  parser/       # Bill file parser (JSON/PDF)
  schema/       # Zod schemas for all types
scripts/        # Data import utilities
fixtures/       # Sample bills for testing
templates/      # Handlebars templates
web/            # Web frontend SPA
```

## Web Frontend

Open `web/index.html` in a browser for a visual bill auditor interface.

## License

MIT
