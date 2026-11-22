// Production start-up helpers (Render etc.):
//  runMigrations()  – creates/updates tables from packages/db/migrations
//  ensureLocations() – fills an empty database from data/locations.json.gz (all of Cambodia)
//  ensureAccounts()  – creates the demo officer and NGO partner accounts if missing
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import bcrypt from 'bcryptjs';
import { eq, sql as dsql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './client';
import { ROOT_DIR } from './env';
import { communes, districts, officers, provinces, villages } from './schema';

const here = dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  await migrate(db, { migrationsFolder: join(here, '..', 'migrations') });
  console.log('[db] migrations up to date');
}

type Row = (string | number | null)[];
export type LocationSnapshot = { provinces: Row[]; districts: Row[]; communes: Row[]; villages: Row[] };
export const SNAPSHOT_PATH = join(ROOT_DIR, 'data', 'locations.json.gz');

async function insertChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 1000) await write(rows.slice(i, i + 1000));
}

/** Loads all provinces → villages from the bundled DataEF snapshot when the database has none. */
export async function ensureLocations() {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(villages);
  if (n > 0) return;
  if (!existsSync(SNAPSHOT_PATH)) {
    console.warn('[db] no villages and no data/locations.json.gz – run `pnpm db:import`');
    return;
  }
  const s: LocationSnapshot = JSON.parse(gunzipSync(readFileSync(SNAPSHOT_PATH)).toString('utf8'));
  const num = (v: string | number | null) => (v === null ? null : Number(v));
  const str = (v: string | number | null) => String(v ?? '');
  await insertChunks(s.provinces, (c) =>
    db.insert(provinces).values(
      c.map(([code, km, en, lat, lng, weather]) => ({
        code: str(code), nameKm: str(km), nameEn: str(en), lat: num(lat), lng: num(lng), weatherName: weather === null ? null : str(weather),
      })),
    ).onConflictDoNothing(),
  );
  await insertChunks(s.districts, (c) =>
    db.insert(districts).values(
      c.map(([code, p, km, en, lat, lng]) => ({ code: str(code), provinceCode: str(p), nameKm: str(km), nameEn: str(en), lat: num(lat), lng: num(lng) })),
    ).onConflictDoNothing(),
  );
  await insertChunks(s.communes, (c) =>
    db.insert(communes).values(
      c.map(([code, d, km, en, lat, lng]) => ({ code: str(code), districtCode: str(d), nameKm: str(km), nameEn: str(en), lat: num(lat), lng: num(lng) })),
    ).onConflictDoNothing(),
  );
  await insertChunks(s.villages, (c) =>
    db.insert(villages).values(
      c.map(([code, cm, km, en, lat, lng]) => ({
        code: str(code), communeCode: str(cm), nameKm: str(km), nameEn: str(en), lat: num(lat), lng: num(lng), forecastLocation: str(code),
      })),
    ).onConflictDoNothing(),
  );
  console.log(`[db] loaded ${s.provinces.length} provinces, ${s.communes.length} communes, ${s.villages.length} villages`);
}

/** Creates the demo commune officer and the NGO partner account (password from SEED_OFFICER_PASSWORD). */
export async function ensureAccounts() {
  const password = process.env.SEED_OFFICER_PASSWORD || 'demo1234';
  const accounts = [
    {
      email: process.env.SEED_OFFICER_EMAIL || 'officer@demo.kh',
      name: 'Demo commune officer',
      role: 'officer' as const,
      orgName: null,
      orgNameKm: null,
      areaCodes: null,
    },
    {
      email: process.env.SEED_PARTNER_EMAIL || 'ngo@demo.kh',
      name: 'Demo NGO staff',
      role: 'partner' as const,
      orgName: process.env.SEED_PARTNER_ORG || 'Demo Farmers NGO',
      orgNameKm: process.env.SEED_PARTNER_ORG_KM || 'អង្គការជំនួយកសិករ (សាកល្បង)',
      areaCodes: null,
    },
  ];
  const [first] = await db
    .select({ code: communes.code })
    .from(communes)
    .where(dsql`${communes.code} like ${(process.env.SEED_OFFICER_COMMUNE || '0203') + '%'}`)
    .orderBy(communes.code)
    .limit(1);
  for (const a of accounts) {
    const [existing] = await db.select({ id: officers.id }).from(officers).where(eq(officers.email, a.email)).limit(1);
    if (existing) continue;
    await db.insert(officers).values({ ...a, passwordHash: await bcrypt.hash(password, 10), communeCode: first?.code ?? null });
    console.log(`[db] created ${a.role} account ${a.email}`);
  }
}
