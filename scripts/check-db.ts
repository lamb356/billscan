import { getDb, closeDb } from '../src/db/connection.js';

const db = getDb();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', (tables as any[]).map(t => t.name).join(', '));
closeDb();
