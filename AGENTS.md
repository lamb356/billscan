# BillScan — Project Context for AI Agents

## What This Is
CLI tool that audits medical bills against real CMS Medicare fee schedules. Not a demo — uses real data.

## Architecture
- TypeScript strict mode, ESM, Node 20+
- SQLite via better-sqlite3 (data/billscan.db)
- BLAKE3 hashing (fallback SHA-256) via src/utils/hash.ts
- CMS pipeline: fetch ZIP → parse CSV → import to SQLite → query for matching
- Tiered matching: code+modifier+locality → code+modifier → code → unmatched
- NEVER fabricates rates

## CLI Commands
- `npx tsx src/cli.ts fetch-cms --year 2026` — download CMS data
- `npx tsx src/cli.ts audit ./bill.json --save --letter --phone --cards` — full audit
- `npx tsx src/cli.ts stats` — aggregate stats

## Rules
- All hashing through src/utils/hash.ts only
- All types validated with Zod (src/schema/)
- CMS data is single source of truth
- No PHI in database
- No hardcoded rates
