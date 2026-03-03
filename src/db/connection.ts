import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { runMigrations } from './migrations.js';

const DB_PATH = join(process.cwd(), 'data', 'billscan.db');

let db: InstanceType<typeof Database> | null = null;

export function getDb(): InstanceType<typeof Database> {
  if (!db) {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    runMigrations(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
