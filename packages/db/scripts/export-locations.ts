/**
 * Writes all locations from the database to data/locations.json.gz, the snapshot a fresh
 * production database is filled from (no 7-minute DataEF download on every new deploy).
 * Usage: pnpm db:import && pnpm --filter @sour/db export-locations
 */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { asc } from 'drizzle-orm';
import { communes, db, districts, provinces, sql, villages } from '../src/index';
import { SNAPSHOT_PATH } from '../src/bootstrap';

const round = (n: number | null) => (n === null ? null : Math.round(n * 1e6) / 1e6);

const p = await db.select().from(provinces).orderBy(asc(provinces.code));
const d = await db.select().from(districts).orderBy(asc(districts.code));
const c = await db.select().from(communes).orderBy(asc(communes.code));
const v = await db.select().from(villages).orderBy(asc(villages.code));

const snapshot = {
  source: 'DataEF (data.mef.gov.kh) Province/District/Commune/Villages List 2025 + Geographical coordinates',
  exportedAt: new Date().toISOString(),
  provinces: p.map((r) => [r.code, r.nameKm, r.nameEn, round(r.lat), round(r.lng), r.weatherName]),
  districts: d.map((r) => [r.code, r.provinceCode, r.nameKm, r.nameEn, round(r.lat), round(r.lng)]),
  communes: c.map((r) => [r.code, r.districtCode, r.nameKm, r.nameEn, round(r.lat), round(r.lng)]),
  villages: v.map((r) => [r.code, r.communeCode, r.nameKm, r.nameEn, round(r.lat), round(r.lng)]),
};
const gz = gzipSync(JSON.stringify(snapshot), { level: 9 });
writeFileSync(SNAPSHOT_PATH, gz);
console.log(`Wrote ${SNAPSHOT_PATH}: ${p.length} provinces, ${d.length} districts, ${c.length} communes, ${v.length} villages (${(gz.length / 1024).toFixed(0)} KB)`);
await sql.end();
