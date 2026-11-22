/**
 * Calls every live source and prints what our normalisers make of it. Raw replies are saved to
 * data/fixtures/ (useful as offline demo data).   Usage: pnpm probe [-- --village 02030101]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR, sql } from '@sour/db';
import { getJson } from '../src/http';
import { normaliseCsxIndex, normaliseCsxSummary } from '../src/csx';
import { normaliseFx } from '../src/fx';
import { getForecast, locationPoint } from '../src/weather';
import { findArray } from '../src/http';
import { normaliseCurrent } from '../src/weather';

const args = process.argv.slice(2);
const village = args.includes('--village') ? args[args.indexOf('--village') + 1] : '02030101';
const dir = join(ROOT_DIR, 'data', 'fixtures');
mkdirSync(dir, { recursive: true });

const checks: [string, string, Record<string, string>, (raw: unknown) => unknown][] = [
  ['weather-now', 'DATAEF_WEATHER_ALL_PATH', {}, (r) => findArray(r).slice(0, 2).map((x) => normaliseCurrent(x, '?'))],
  ['fx', 'DATAEF_FX_PATH', {}, normaliseFx],
  ['csx-index', 'DATAEF_CSX_INDEX_PATH', {}, normaliseCsxIndex],
  ['csx-summary', 'DATAEF_CSX_SUMMARY_PATH', {}, (r) => normaliseCsxSummary(r).stocks.slice(0, 3)],
];

for (const [name, env, params, normalise] of checks) {
  const t0 = Date.now();
  try {
    const raw = await getJson(env, params);
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(raw, null, 2));
    console.log(`✔ DataEF ${name}: ${Date.now() - t0} ms`);
    console.log('  ', JSON.stringify(normalise(raw)).slice(0, 400));
  } catch (e) {
    console.log(`✘ DataEF ${name}: ${(e as Error).message}`);
  }
}

console.log(`Forecast for village ${village} at`, await locationPoint(village));
const fc = await getForecast(village, 'refresh');
console.log(fc ? `✔ Open-Meteo: ${JSON.stringify(fc.data[0])}` : '✘ Open-Meteo forecast failed');
await sql.end();
