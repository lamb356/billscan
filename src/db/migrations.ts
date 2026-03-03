import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cms_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url      TEXT NOT NULL,
      file_name       TEXT NOT NULL,
      effective_year  INTEGER NOT NULL,
      data_hash       TEXT NOT NULL UNIQUE,
      fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cms_rates (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id      INTEGER NOT NULL REFERENCES cms_snapshots(id),
      hcpcs_code       TEXT NOT NULL,
      modifier         TEXT,
      description      TEXT,
      facility_rate    REAL,
      non_facility_rate REAL,
      locality_code    TEXT,
      status_code      TEXT,
      effective_year   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cms_rates_code ON cms_rates(hcpcs_code);
    CREATE INDEX IF NOT EXISTS idx_cms_rates_code_mod ON cms_rates(hcpcs_code, modifier);
    CREATE INDEX IF NOT EXISTS idx_cms_rates_locality ON cms_rates(hcpcs_code, locality_code);

    CREATE TABLE IF NOT EXISTS audits (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id       TEXT NOT NULL UNIQUE,
      input_hash      TEXT NOT NULL,
      snapshot_id     INTEGER NOT NULL REFERENCES cms_snapshots(id),
      total_billed    REAL NOT NULL,
      total_cms       REAL NOT NULL,
      total_savings   REAL NOT NULL,
      finding_count   INTEGER NOT NULL,
      report_json     TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Phase 2: CLFS (Clinical Lab Fee Schedule)
    CREATE TABLE IF NOT EXISTS clfs_rates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id     INTEGER NOT NULL REFERENCES cms_snapshots(id),
      hcpcs_code      TEXT NOT NULL,
      modifier        TEXT,
      eff_date        TEXT,
      indicator       TEXT,
      rate            REAL NOT NULL,
      short_desc      TEXT,
      long_desc       TEXT,
      effective_year  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clfs_code ON clfs_rates(hcpcs_code);

    -- Phase 2: ASP (Average Sales Price for Part B drugs)
    CREATE TABLE IF NOT EXISTS asp_rates (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id      INTEGER NOT NULL REFERENCES cms_snapshots(id),
      hcpcs_code       TEXT NOT NULL,
      short_desc       TEXT,
      dosage           TEXT,
      payment_limit    REAL NOT NULL,
      coinsurance_pct  REAL,
      vaccine_awp_pct  REAL,
      vaccine_limit    REAL,
      blood_awp_pct    REAL,
      blood_limit      REAL,
      clotting_factor  TEXT,
      notes            TEXT,
      effective_year   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_asp_code ON asp_rates(hcpcs_code);

    -- Phase 2: OPPS (Outpatient PPS / APC rates)
    CREATE TABLE IF NOT EXISTS opps_rates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id     INTEGER NOT NULL REFERENCES cms_snapshots(id),
      hcpcs_code      TEXT NOT NULL,
      short_desc      TEXT,
      apc             TEXT,
      si              TEXT,
      relative_weight REAL,
      payment_rate    REAL NOT NULL,
      min_unadjusted  REAL,
      notes           TEXT,
      effective_year  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_opps_code ON opps_rates(hcpcs_code);

    -- Phase 2: ZIP-to-locality mapping
    CREATE TABLE IF NOT EXISTS zip_locality (
      zip_code    TEXT PRIMARY KEY,
      locality    TEXT NOT NULL,
      state       TEXT,
      county      TEXT
    );

    -- Phase 2: Charity care / nonprofit hospital registry
    CREATE TABLE IF NOT EXISTS charity_hospitals (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ein     TEXT UNIQUE,
      name    TEXT NOT NULL,
      city    TEXT,
      state   TEXT,
      zip_code TEXT,
      fap_url TEXT
    );
  `);
}
