import './env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
// On a host like Render there is no database on localhost: the local .env value was copied by mistake.
if ((process.env.RENDER || process.env.VERCEL) && /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) {
  throw new Error(
    'DATABASE_URL points to localhost, but this server runs on a host with no local database. ' +
      'Set DATABASE_URL to your Render PostgreSQL "Internal Database URL" (Render → your database → Connect).',
  );
}

export const sql = postgres(url, { max: 10, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export type DB = typeof db;
