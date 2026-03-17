import { createClient, type Client } from '@libsql/client';

let client: Client | null = null;

export function getDb(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (url && authToken) {
    // Production: connect to Turso
    client = createClient({ url, authToken });
  } else {
    // Local development: use local SQLite file
    client = createClient({
      url: 'file:data/billscan.db',
    });
  }

  return client;
}

export function closeDb(): void {
  if (client) {
    client.close();
    client = null;
  }
}
