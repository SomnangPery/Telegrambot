/**
 * Imports every province, district, commune and village (2025 lists) plus their coordinates
 * straight from the DataEF open data portal (data.mef.gov.kh). No files needed.
 *
 * Usage: pnpm db:import
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, inArray, isNotNull, notInArray, sql as dsql } from 'drizzle-orm';
import { ROOT_DIR, communes, db, districts, officers, provinces, sql, users, villages } from '../src/index';

const API = `${process.env.DATAEF_BASE_URL || 'https://data.mef.gov.kh'}/api/v1/public-datasets`;

const DATASETS = {
  provinces: 'pd_66a8603700604c000123e144', // Cambodia Province List 2025
  districts: 'pd_66a8603800604c000123e145', // Cambodia District List 2025
  communes: 'pd_66a8603900604c000123e146', // Cambodia Commune List 2025
  villages: 'pd_66a8603a00604c000123e147', // Cambodia Villages List 2025
};

// Province names as the DataEF weather API enum spells them, where they differ from the list.
const WEATHER_NAME: Record<string, string> = {
  '11': 'Mondulkiri',
  '16': 'Ratanakiri',
  '17': 'Siem Reap',
  '19': 'Strung Treng',
  '22': 'Oddar Meanchey',
};

type Row = Record<string, unknown>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON politely: one request at a time, pause between calls, back off on HTTP 429. */
async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    await sleep(350);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return await res.json();
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || attempt >= 6) throw new Error(`${url}: ${(e as Error).message}`);
      await sleep(2000 * 2 ** attempt); // 2 s, 4 s, 8 s, …
    }
  }
}

// Downloads are kept in data/dataef-cache/ for a week so re-running the import is fast.
const CACHE_DIR = join(ROOT_DIR, 'data', 'dataef-cache');
const fresh = process.argv.includes('--fresh');

async function fetchAll(id: string): Promise<Row[]> {
  const file = join(CACHE_DIR, `${id}.json`);
  if (!fresh && existsSync(file) && Date.now() - statSync(file).mtimeMs < 7 * 86_400_000)
    return JSON.parse(readFileSync(file, 'utf8'));
  const out: Row[] = [];
  for (let page = 1; ; page++) {
    const json: { items: Row[]; total_pages: number } = await getJson(`${API}/${id}/json?page=${page}&page_size=200`);
    out.push(...json.items);
    if (page >= json.total_pages) break;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  return out;
}

/** Some lists repeat a code; keep the last row for each code. */
function dedupe(rows: Row[], key: string): Row[] {
  return [...new Map(rows.map((r) => [String(r[key]), r])).values()];
}

/** "E103° 47' 46.956\"\"" → 103.79637 */
function dms(v: unknown): number | null {
  const m = String(v ?? '').match(/([NSEW])?\s*(\d+)\s*°\s*(\d+)\s*'\s*([\d.]+)/i);
  if (!m) return null;
  const deg = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
  return /[SW]/i.test(m[1] ?? '') ? -deg : deg;
}

const PAD: Record<string, number> = { province: 2, district: 4, commune: 6, village: 8 };

async function coordinates() {
  const res = await getJson(`${API}?keyword=Geographical%20coordinates&page_size=50`);
  const list: Row[] = Array.isArray(res) ? res : (res.data ?? res.items ?? []);
  const ids = list.filter((d) => /geographical coordinates of/i.test(String(d.name))).map((d) => String(d.id));
  const coords = new Map<string, { lat: number; lng: number }>();
  for (const id of ids) {
    for (const r of await fetchAll(id)) {
      const type = String(r['type of location'] ?? '').toLowerCase();
      const len = PAD[type];
      const lat = dms(r.latitude);
      const lng = dms(r.longtitude ?? r.longitude);
      if (!len || lat == null || lng == null || r['zip code'] == null) continue;
      const code = String(Math.round(Number(r['zip code']))).padStart(len, '0');
      // Sanity check: Cambodia is roughly 10–15°N, 102–108°E.
      if (lat > 9 && lat < 15.5 && lng > 102 && lng < 108) coords.set(code, { lat, lng });
    }
  }
  console.log(`  coordinates: ${coords.size} points from ${ids.length} province files`);
  return coords;
}

async function upsert<T extends Row>(label: string, rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 500) await write(rows.slice(i, i + 500));
  console.log(`  ${label}: ${rows.length}`);
}

const excluded = (table: any, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, dsql.raw(`excluded.${table[k].name}`)]));

async function main() {
  console.log('Downloading from DataEF (one request at a time, ~2 minutes)…');
  const p = dedupe(await fetchAll(DATASETS.provinces), 'province_code');
  const d = dedupe(await fetchAll(DATASETS.districts), 'district_code');
  const c = dedupe(await fetchAll(DATASETS.communes), 'commune_code');
  const v = dedupe(await fetchAll(DATASETS.villages), 'village_code');
  // The 2025 lists are not fully consistent (a few villages name a commune missing from the
  // commune list). Add a placeholder commune so those villages are still selectable.
  const known = new Set(c.map((r) => String(r.commune_code)));
  for (const r of v) {
    const code = String(r.commune_code);
    if (known.has(code)) continue;
    known.add(code);
    c.push({ commune_code: code, district_code: r.district_code, commune_kh: `ឃុំ/សង្កាត់ ${code}`, commune_en: `Commune ${code}` });
    console.log(`  ⚠ commune ${code} is missing from the commune list; added a placeholder`);
  }
  console.log(`  lists: ${p.length} provinces, ${d.length} districts, ${c.length} communes, ${v.length} villages`);
  const xy = await coordinates();

  // Commune centre = official point, else the average of its villages' points.
  const avg = new Map<string, { lat: number; lng: number; n: number }>();
  for (const r of v) {
    const pt = xy.get(String(r.village_code));
    if (!pt) continue;
    const key = String(r.commune_code);
    const a = avg.get(key) ?? { lat: 0, lng: 0, n: 0 };
    avg.set(key, { lat: a.lat + pt.lat, lng: a.lng + pt.lng, n: a.n + 1 });
  }
  const centre = (code: string) => {
    const a = avg.get(code);
    return xy.get(code) ?? (a ? { lat: a.lat / a.n, lng: a.lng / a.n } : undefined);
  };

  console.log('Writing to the database…');
  await upsert('provinces', p, (rows) =>
    db
      .insert(provinces)
      .values(
        rows.map((r) => {
          const code = String(r.province_code);
          return {
            code,
            nameKm: String(r.province_kh),
            nameEn: String(r.province_en),
            lat: xy.get(code)?.lat ?? null,
            lng: xy.get(code)?.lng ?? null,
            weatherName: WEATHER_NAME[code] ?? String(r.province_en),
          };
        }),
      )
      .onConflictDoUpdate({ target: provinces.code, set: excluded(provinces, ['nameKm', 'nameEn', 'lat', 'lng', 'weatherName']) }),
  );
  await upsert('districts', d, (rows) =>
    db
      .insert(districts)
      .values(
        rows.map((r) => {
          const code = String(r.district_code);
          return {
            code,
            provinceCode: String(r.province_code),
            nameKm: String(r.district_kh),
            nameEn: String(r.district_en),
            lat: xy.get(code)?.lat ?? null,
            lng: xy.get(code)?.lng ?? null,
          };
        }),
      )
      .onConflictDoUpdate({ target: districts.code, set: excluded(districts, ['provinceCode', 'nameKm', 'nameEn', 'lat', 'lng']) }),
  );
  await upsert('communes', c, (rows) =>
    db
      .insert(communes)
      .values(
        rows.map((r) => {
          const code = String(r.commune_code);
          return {
            code,
            districtCode: String(r.district_code),
            nameKm: String(r.commune_kh),
            nameEn: String(r.commune_en),
            lat: centre(code)?.lat ?? null,
            lng: centre(code)?.lng ?? null,
          };
        }),
      )
      .onConflictDoUpdate({ target: communes.code, set: excluded(communes, ['districtCode', 'nameKm', 'nameEn', 'lat', 'lng']) }),
  );
  await upsert('villages', v, (rows) =>
    db
      .insert(villages)
      .values(
        rows.map((r) => {
          const code = String(r.village_code);
          return {
            code,
            communeCode: String(r.commune_code),
            nameKm: String(r.village_kh),
            nameEn: String(r.village_en),
            lat: xy.get(code)?.lat ?? null,
            lng: xy.get(code)?.lng ?? null,
            // Forecasts are fetched for the village's own point (commune centre if it has none).
            forecastLocation: code,
          };
        }),
      )
      .onConflictDoUpdate({
        target: villages.code,
        set: excluded(villages, ['communeCode', 'nameKm', 'nameEn', 'lat', 'lng', 'forecastLocation']),
      }),
  );

  // Remove anything not in the official lists (e.g. the old sample data).
  const vCodes = v.map((r) => String(r.village_code));
  const stale = await db.select({ code: villages.code }).from(villages).where(notInArray(villages.code, vCodes));
  if (stale.length) {
    const codes = stale.map((s) => s.code);
    await db.update(users).set({ villageCode: null }).where(inArray(users.villageCode, codes));
    await db.delete(villages).where(inArray(villages.code, codes));
  }
  const cCodes = c.map((r) => String(r.commune_code));
  await db
    .update(officers)
    .set({ communeCode: null })
    .where(and(isNotNull(officers.communeCode), notInArray(officers.communeCode, cCodes)));
  await db.delete(communes).where(notInArray(communes.code, cCodes));
  await db.delete(districts).where(notInArray(districts.code, d.map((r) => String(r.district_code))));
  await db.delete(provinces).where(notInArray(provinces.code, p.map((r) => String(r.province_code))));
  if (stale.length) console.log(`  removed ${stale.length} villages not in the official list`);

  const withXy = v.filter((r) => xy.has(String(r.village_code))).length;
  console.log(`Done. ${withXy}/${v.length} villages have their own coordinates; the rest use the commune centre.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
