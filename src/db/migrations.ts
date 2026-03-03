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
  `);
}
