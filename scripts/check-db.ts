import { getDb, closeDb } from '../src/db/connection.js';

const db = getDb();
console.log('Tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());
const count = db.prepare('SELECT COUNT(*) as c FROM cms_rates').get();
console.log('CMS rates:', count);
closeDb();
