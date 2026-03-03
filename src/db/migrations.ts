import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cms_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url      TEXT NOT NULL,
      effective_year  INTEGER NOT NULL,
      fetched_at      TEXT NOT NULL,
      data_hash       TEXT NOT NULL,
      row_count       INTEGER NOT NULL,
      file_name       TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cms_rates (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id       INTEGER NOT NULL REFERENCES cms_snapshots(id),
      cpt_code          TEXT NOT NULL,
      modifier          TEXT,
      description       TEXT,
      facility_rate     REAL,
      non_facility_rate REAL,
      locality          TEXT,
      locality_name     TEXT,
      status_indicator  TEXT,
      effective_year    INTEGER NOT NULL,
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cms_rates_cpt ON cms_rates(cpt_code);
    CREATE INDEX IF NOT EXISTS idx_cms_rates_cpt_mod ON cms_rates(cpt_code, modifier);
    CREATE INDEX IF NOT EXISTS idx_cms_rates_cpt_loc ON cms_rates(cpt_code, locality);

    CREATE TABLE IF NOT EXISTS audits (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id       TEXT UNIQUE NOT NULL,
      input_hash      TEXT NOT NULL,
      snapshot_id     INTEGER REFERENCES cms_snapshots(id),
      total_billed    REAL,
      total_cms       REAL,
      total_savings   REAL,
      finding_count   INTEGER,
      report_json     TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    -- Phase 2: Clinical Lab Fee Schedule
    CREATE TABLE IF NOT EXISTS clfs_rates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id     INTEGER NOT NULL,
      hcpcs_code      TEXT NOT NULL,
      modifier        TEXT,
      rate            REAL,
      short_desc      TEXT,
      long_desc       TEXT,
      indicator       TEXT,
      effective_date  TEXT,
      effective_year  INTEGER NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_clfs_hcpcs ON clfs_rates(hcpcs_code);
    CREATE INDEX IF NOT EXISTS idx_clfs_hcpcs_mod ON clfs_rates(hcpcs_code, modifier);

    -- Phase 2: Drug ASP Pricing
    CREATE TABLE IF NOT EXISTS asp_rates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id     INTEGER NOT NULL,
      hcpcs_code      TEXT NOT NULL,
      short_desc      TEXT,
      dosage          TEXT,
      payment_limit   REAL,
      coinsurance_pct REAL,
      vaccine_awp_pct REAL,
      vaccine_limit   REAL,
      blood_awp_pct   REAL,
      blood_limit     REAL,
      clotting_factor TEXT,
      notes           TEXT,
      effective_year  INTEGER NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_asp_hcpcs ON asp_rates(hcpcs_code);

    -- Phase 2: OPPS/APC rates
    CREATE TABLE IF NOT EXISTS opps_rates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id     INTEGER NOT NULL,
      hcpcs_code      TEXT NOT NULL,
      short_desc      TEXT,
      status_indicator TEXT,
      apc             TEXT,
      relative_weight REAL,
      payment_rate    REAL,
      national_copay  REAL,
      min_copay       REAL,
      effective_year  INTEGER NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_opps_hcpcs ON opps_rates(hcpcs_code);

    -- Phase 2: Data source snapshots (for CLFS/ASP/OPPS)
    CREATE TABLE IF NOT EXISTS data_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type     TEXT NOT NULL,
      source_url      TEXT NOT NULL,
      effective_year  INTEGER NOT NULL,
      effective_quarter TEXT,
      fetched_at      TEXT NOT NULL,
      data_hash       TEXT NOT NULL,
      row_count       INTEGER NOT NULL,
      file_name       TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    -- Phase 2: ZIP to CMS locality mapping
    CREATE TABLE IF NOT EXISTS zip_locality (
      zip_code        TEXT NOT NULL,
      carrier         TEXT,
      locality        TEXT NOT NULL,
      state           TEXT,
      county_name     TEXT,
      PRIMARY KEY (zip_code)
    );
    CREATE INDEX IF NOT EXISTS idx_zip_locality_zip ON zip_locality(zip_code);

    -- Phase 2: Charity care / nonprofit hospitals
    CREATE TABLE IF NOT EXISTS charity_hospitals (
      ein             TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      city            TEXT,
      state           TEXT,
      zip_code        TEXT,
      fap_url         TEXT,
      last_updated    TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_charity_state ON charity_hospitals(state);
    CREATE INDEX IF NOT EXISTS idx_charity_zip ON charity_hospitals(zip_code);
  `);
}
