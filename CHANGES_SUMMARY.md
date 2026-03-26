# BillScan UI Changes Summary

## Task 1: New Results Sections (web/index.html)

### Added HTML Containers (inside #auditResults, after charity section)
- `#savingsSummarySection` — Two-column savings overview (uninsured vs insured)
- `#billingErrorsSection` — Alert cards with severity color coding
- `#siteOfServiceSection` — Rate comparison cards for facility vs office
- `#balanceBillingSection` — Balance billing alert cards with legal basis
- `#actionButtonsSection` — Appeal letter + phone script download buttons

### Added CSS (~350 lines before `</style>`)
- `.savings-summary-grid`, `.savings-col`, `.savings-big-num`, `.savings-breakdown`
- `.billing-error-card`, `.billing-error-type` with severity color variants
- `.sos-card`, `.sos-rates`, `.sos-savings-row`, `.sos-shoppable` badge
- `.bb-card`, `.bb-amounts`, `.bb-legal`, `.bb-action`
- `.action-buttons-row`, `.btn-appeal`, `.btn-phone`
- `.new-section`, `.new-section-header`
- All mobile responsive via @media queries (columns stack on small screens)

### Added JS Functions (before export JSON handler)
- `renderSavingsSummary(report)` — Renders savings summary with dual columns
- `renderBillingErrors(report)` — Renders billing error cards with severity icons
- `renderSiteOfService(report)` — Renders site-of-service comparison cards
- `renderBalanceBilling(report)` — Renders balance billing alert cards
- `renderActionButtons(report)` — Renders appeal/phone script download buttons

### Modified `renderResults(report)`
- Added calls to all 5 new render functions after transparency stamp, before insurance comparison

## Task 2: Appeal/Dispute Letter Download

### Server (src/server.ts)
- Added import: `generateAppealEvidence` from `./dispute/appeal-generator.js`
- Added handler: `handleAppeal()` — POST /api/appeal endpoint
- Added route: `POST /api/appeal` → `handleAppeal(req, res)`

### Client (web/index.html)
- "Download Appeal Letter" button: POSTs to /api/appeal, downloads appealLetterDraft as .txt
- "Download Phone Script" button: Generates negotiation script from report data, downloads as .txt
- Phone script includes: opening, talking points, CPT codes with CMS rates, negotiation strategies

## Task 3: Get Records Page

### Router
- Added `'/get-records': 'get-records'` to pages object

### Navigation
- Added "Get Records" link to desktop nav (#navLinks)
- Added "Get Records" link to mobile nav drawer (#navDrawer)

### Page Structure (page-get-records)
- Hero section with title and subtitle
- Section 1: HIPAA rights (5 key rights with checkmark list)
- Section 2: Insurer portal cards (10 major insurers with links)
- Section 3: HIPAA request letter template with copy-to-clipboard
- Section 4: Dispute guidance (unpaid, paid, collections, warnings, NSA)
- Section 5: Statute of limitations table (10 states)
- CTA: "Ready to check your bills?" → Audit page

### Added CSS for Get Records page
- `.gr-hero`, `.gr-section`, `.gr-rights-list`, `.gr-right-item`
- `.gr-insurer-grid`, `.gr-insurer-card` with colored icons
- `.gr-letter-box`, `.gr-letter-text`, `.gr-copy-btn`
- `.gr-dispute-cards`, `.gr-dispute-card`, `.gr-warning-card`
- `.gr-sol-table`, `.gr-note`, `.gr-cta`

### Added JS
- `copyHipaaLetter()` — Copies HIPAA letter template to clipboard
