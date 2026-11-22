/**
 * Imports the Ministry of Planning 2023 village and commune lists.
 *
 * Usage:
 *   pnpm db:import                         # reads data/communes_2023.csv and data/villages_2023.csv
 *   pnpm db:import -- --province 02        # only one province (demo: Battambang)
 *
 * The real column names are not known yet, so columns are matched by common aliases.
 * Override with env vars if needed, e.g. CSV_CODE_COL=VillGis CSV_NAME_KM_COL=VName_KH.
 * Provinces and districts are derived from the 8-digit village codes (PP DD CC VV) when no
 * separate list exists; their names fall back to the code until a names file is provided
 * (data/provinces.csv / data/districts.csv with code,name_km,name_en).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { ROOT_DIR, communes, db, districts, provinces, sql, villages } from '../src/index';

type Row = Record<string, string>;

const args = process.argv.slice(2);
const provinceFilter = args.includes('--province') ? args[args.indexOf('--province') + 1] : undefined;

function readCsv(name: string): Row[] | null {
  const path = join(ROOT_DIR, 'data', name);
  if (!existsSync(path)) return null;
  return parse(readFileSync(path), { columns: true, skip_empty_lines: true, bom: true, trim: true });
}

function pick(row: Row, envName: string, aliases: string[]): string | undefined {
  const forced = process.env[envName];
  if (forced && row[forced] !== undefined) return row[forced];
  const keys = Object.keys(row);
  for (const a of aliases) {
    const k = keys.find((key) => key.toLowerCase().replace(/[\s_-]/g, '') === a);
    if (k && row[k] !== '') return row[k];
  }
  return undefined;
}

const num = (v?: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : null);
const pad = (code: string, len: number) => code.replace(/\D/g, '').padStart(len, '0');

function parseRow(row: Row, codeLen: number) {
  const code = pick(row, 'CSV_CODE_COL', ['code', 'villgis', 'villagecode', 'vcode', 'communecode', 'comgis', 'ccode', 'gis']);
  if (!code) return null;
  return {
    code: pad(code, codeLen),
    nameKm: pick(row, 'CSV_NAME_KM_COL', ['namekm', 'namekh', 'khmername', 'vnamekh', 'cnamekh', 'khmer']) ?? '',
    nameEn: pick(row, 'CSV_NAME_EN_COL', ['nameen', 'name', 'englishname', 'vnameen', 'cnameen', 'latin', 'english']) ?? '',
    lat: num(pick(row, 'CSV_LAT_COL', ['lat', 'latitude', 'y'])),
    lng: num(pick(row, 'CSV_LNG_COL', ['lng', 'lon', 'long', 'longitude', 'x'])),
  };
}

async function main() {
  const communeRows = readCsv('communes_2023.csv');
  const villageRows = readCsv('villages_2023.csv');
  if (!communeRows && !villageRows) {
    console.error('Put communes_2023.csv and/or villages_2023.csv in data/ first.');
    process.exit(1);
  }

  const provinceNames = new Map((readCsv('provinces.csv') ?? []).map((r) => [pad(r.code, 2), r]));
  const districtNames = new Map((readCsv('districts.csv') ?? []).map((r) => [pad(r.code, 4), r]));

  const comms = (communeRows ?? []).map((r) => parseRow(r, 6)).filter((r) => r !== null);
  const vills = (villageRows ?? []).map((r) => parseRow(r, 8)).filter((r) => r !== null);
  const inScope = (code: string) => !provinceFilter || code.startsWith(pad(provinceFilter, 2));

  // Derive provinces/districts/communes from codes.
  const provCodes = new Set<string>();
  const distCodes = new Set<string>();
  const commCodes = new Map(comms.filter((c) => inScope(c.code)).map((c) => [c.code, c]));
  for (const v of vills.filter((v) => inScope(v.code))) {
    const cc = v.code.slice(0, 6);
    if (!commCodes.has(cc)) commCodes.set(cc, { code: cc, nameKm: cc, nameEn: cc, lat: null, lng: null });
  }
  for (const cc of commCodes.keys()) {
    provCodes.add(cc.slice(0, 2));
    distCodes.add(cc.slice(0, 4));
  }

  for (const code of provCodes) {
    const n = provinceNames.get(code);
    await db
      .insert(provinces)
      .values({ code, nameKm: n?.name_km ?? code, nameEn: n?.name_en ?? code })
      .onConflictDoNothing();
  }
  for (const code of distCodes) {
    const n = districtNames.get(code);
    await db
      .insert(districts)
      .values({ code, provinceCode: code.slice(0, 2), nameKm: n?.name_km ?? code, nameEn: n?.name_en ?? code })
      .onConflictDoNothing();
  }
  for (const c of commCodes.values()) {
    await db
      .insert(communes)
      .values({ ...c, districtCode: c.code.slice(0, 4) })
      .onConflictDoUpdate({ target: communes.code, set: { nameKm: c.nameKm, nameEn: c.nameEn, lat: c.lat, lng: c.lng } });
  }
  let count = 0;
  for (const v of vills.filter((v) => inScope(v.code))) {
    await db
      .insert(villages)
      .values({ ...v, communeCode: v.code.slice(0, 6), forecastLocation: v.code })
      .onConflictDoUpdate({ target: villages.code, set: { nameKm: v.nameKm, nameEn: v.nameEn, lat: v.lat, lng: v.lng } });
    count++;
  }
  console.log(`Imported ${provCodes.size} provinces, ${distCodes.size} districts, ${commCodes.size} communes, ${count} villages.`);
  console.log('Next: set villages.forecast_location to the weather API location codes (see README).');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
