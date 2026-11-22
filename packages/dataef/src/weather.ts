// Weather has two real sources:
//  • DataEF /realtime-api/weather – official current conditions per province (no forecast).
//  • Open-Meteo – free 3-day forecast for each village's own coordinates (DataEF has no forecast).
import { communes, db, districts, provinces, villages } from '@sour/db';
import { eq } from 'drizzle-orm';
import { cached, readCache, withTimeout, writeCache, type ReadMode } from './cache';
import { field, findArray, getJson, isMock, numField, today } from './http';
import { mockCurrent, mockForecast } from './mock';
import type { Cached, CurrentWeather, Forecast } from './types';

const FORECAST_TTL = 60 * 60 * 1000; // 60 min
const CURRENT_TTL = 30 * 60 * 1000; // 30 min
const OPEN_METEO = process.env.FORECAST_URL || 'https://api.open-meteo.com/v1/forecast';
const BATCH = 50; // locations per Open-Meteo request

/** Maps free-text conditions (any language/format) to our categories. */
export function normaliseCondition(raw: string, rainMm: number): string {
  const s = raw.toLowerCase();
  if (/storm|typhoon|cyclone|ព្យុះ/.test(s) && !/thunder/.test(s)) return 'storm';
  if (/thunder|រន្ទះ/.test(s)) return 'thunderstorm';
  if (/heavy|torrential|ខ្លាំង/.test(s) || rainMm >= 50) return 'heavy_rain';
  if (/light|drizzle|shower|patchy/.test(s)) return 'light_rain';
  if (/rain|ភ្លៀង/.test(s) || rainMm >= 1) return rainMm >= 20 ? 'rain' : 'light_rain';
  if (/clear|sunny|ថ្ងៃ/.test(s)) return 'clear';
  return 'cloudy';
}

/** WMO weather code (Open-Meteo) → our categories. */
export function wmoCondition(code: number, rainMm: number): string {
  if (code >= 95) return 'thunderstorm';
  // A rain code with < 0.5 mm in the whole day is effectively a dry, cloudy day.
  if (code >= 51 && rainMm < 0.5) return 'cloudy';
  if ([65, 67, 82].includes(code) || rainMm >= 50) return 'heavy_rain';
  if ([63, 66, 81].includes(code) || rainMm >= 20) return 'rain';
  if ((code >= 51 && code <= 61) || code === 80 || rainMm >= 1) return 'light_rain';
  if (code <= 1) return 'clear';
  return 'cloudy';
}

// ---------------------------------------------------------------- location → point

type Point = { lat: number; lng: number };

/** Coordinates for a village (8 digits), commune (6), district (4) or province (2) code. */
export async function locationPoint(code: string): Promise<Point | null> {
  const pick = (r?: { lat: number | null; lng: number | null }) =>
    r && r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null;
  if (code.length === 8) {
    const [v] = await db.select().from(villages).where(eq(villages.code, code)).limit(1);
    if (pick(v)) return pick(v);
    code = code.slice(0, 6);
  }
  if (code.length === 6) {
    const [c] = await db.select().from(communes).where(eq(communes.code, code)).limit(1);
    if (pick(c)) return pick(c);
    code = code.slice(0, 4);
  }
  if (code.length === 4) {
    const [d] = await db.select().from(districts).where(eq(districts.code, code)).limit(1);
    if (pick(d)) return pick(d);
    code = code.slice(0, 2);
  }
  const [p] = await db.select().from(provinces).where(eq(provinces.code, code)).limit(1);
  return pick(p);
}

// ---------------------------------------------------------------- forecast (Open-Meteo)

type OpenMeteo = {
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: (number | null)[];
    wind_speed_10m_max: number[];
  };
  hourly: { time: string[]; precipitation: number[] };
};

function toForecast(locationCode: string, r: OpenMeteo): Forecast[] {
  const fetchedAt = new Date().toISOString();
  const nowHour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Phnom_Penh' }));
  return r.daily.time.map((date, i) => {
    const rainMm = Math.round((r.daily.precipitation_sum[i] ?? 0) * 10) / 10;
    // First hour that day with ≥ 0.5 mm of rain (for today: from now on).
    let rainStartHour: number | undefined;
    r.hourly.time.forEach((t, j) => {
      if (rainStartHour !== undefined || !t.startsWith(date)) return;
      const h = Number(t.slice(11, 13));
      if ((i > 0 || h >= nowHour) && r.hourly.precipitation[j] >= 0.5) rainStartHour = h;
    });
    return {
      locationCode,
      date,
      rainMm,
      tempMaxC: r.daily.temperature_2m_max[i],
      tempMinC: r.daily.temperature_2m_min[i],
      condition: wmoCondition(r.daily.weather_code[i], rainMm),
      rainChancePct: r.daily.precipitation_probability_max[i] ?? undefined,
      windKph: r.daily.wind_speed_10m_max[i],
      rainStartHour,
      fetchedAt,
    };
  });
}

async function fetchOpenMeteo(points: { code: string; pt: Point }[]): Promise<Map<string, Forecast[]>> {
  const url = new URL(OPEN_METEO);
  url.searchParams.set('latitude', points.map((p) => p.pt.lat.toFixed(4)).join(','));
  url.searchParams.set('longitude', points.map((p) => p.pt.lng.toFixed(4)).join(','));
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
  );
  url.searchParams.set('hourly', 'precipitation');
  url.searchParams.set('forecast_days', '3');
  url.searchParams.set('timezone', 'Asia/Phnom_Penh');
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const body = (await res.json()) as OpenMeteo | OpenMeteo[];
  const list = Array.isArray(body) ? body : [body];
  return new Map(points.map((p, i) => [p.code, toForecast(p.code, list[i])]));
}

/** 3-day forecast for one location (village code normally). Cached 60 min. */
export function getForecast(locationCode: string, mode: ReadMode = 'cache'): Promise<Cached<Forecast[]> | null> {
  return cached(
    `weather:${locationCode}`,
    FORECAST_TTL,
    async () => {
      if (isMock()) return mockForecast(locationCode, today(), 3);
      const pt = await locationPoint(locationCode);
      if (!pt) throw new Error(`no coordinates for ${locationCode}`);
      return (await fetchOpenMeteo([{ code: locationCode, pt }])).get(locationCode)!;
    },
    mode,
  );
}

/**
 * Forecasts for many locations with as few requests as possible (dashboard map, refresh job).
 * mode 'cache': only locations with nothing cached are fetched. mode 'refresh': all are fetched.
 */
export async function getForecasts(codes: string[], mode: ReadMode = 'cache') {
  const out = new Map<string, Cached<Forecast[]>>();
  const todo: string[] = [];
  for (const code of new Set(codes)) {
    const hit = await readCache<Forecast[]>(`weather:${code}`);
    if (hit) out.set(code, hit);
    if (mode === 'refresh' || !hit) todo.push(code);
  }
  if (!todo.length) return out;
  if (isMock()) {
    for (const code of todo) {
      const data = mockForecast(code, today(), 3);
      await writeCache(`weather:${code}`, data, FORECAST_TTL);
      out.set(code, { data, fetchedAt: new Date(), stale: false });
    }
    return out;
  }
  const points = (await Promise.all(todo.map(async (code) => ({ code, pt: await locationPoint(code) })))).filter(
    (p): p is { code: string; pt: Point } => p.pt !== null,
  );
  for (let i = 0; i < points.length; i += BATCH) {
    const chunk = points.slice(i, i + BATCH);
    try {
      const res = await withTimeout(fetchOpenMeteo(chunk), 15_000);
      for (const [code, data] of res) {
        await writeCache(`weather:${code}`, data, FORECAST_TTL);
        out.set(code, { data, fetchedAt: new Date(), stale: false });
      }
    } catch (err) {
      console.warn(`[weather] forecast batch failed: ${(err as Error).message}`);
      for (const p of chunk) {
        const old = out.get(p.code);
        if (old) out.set(p.code, { ...old, stale: true });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- current conditions (DataEF)

export function normaliseCurrent(raw: Record<string, unknown>, provinceCode: string): CurrentWeather {
  const cond = raw.condition as { text?: string } | string | undefined;
  const text = typeof cond === 'object' ? String(cond?.text ?? '') : String(cond ?? '');
  const precipMm = numField(raw, ['precipmm', 'precip', 'rain'], 0);
  return {
    provinceCode,
    province: String(field(raw, ['name', 'province']) ?? ''),
    observedAt: String(field(raw, ['lastupdated', 'createdat']) ?? new Date().toISOString()),
    tempC: numField(raw, ['tempc', 'temp', 'temperature']),
    feelsLikeC: numField(raw, ['feelslikec']),
    condition: normaliseCondition(text, precipMm),
    conditionText: text,
    precipMm,
    humidity: numField(raw, ['humidity']),
    windKph: numField(raw, ['windkph']),
    fetchedAt: new Date().toISOString(),
  };
}

async function provinceWeatherNames() {
  const rows = await db.select({ code: provinces.code, name: provinces.weatherName }).from(provinces);
  return new Map(rows.filter((r) => r.name).map((r) => [r.name!.toLowerCase(), r.code]));
}

/** Current conditions for a province from DataEF. Cached 30 min. */
export async function getCurrentWeather(provinceCode: string, mode: ReadMode = 'cache'): Promise<Cached<CurrentWeather> | null> {
  return cached(
    `weather-now:${provinceCode}`,
    CURRENT_TTL,
    async () => {
      if (isMock()) return mockCurrent(provinceCode);
      const [p] = await db.select().from(provinces).where(eq(provinces.code, provinceCode)).limit(1);
      if (!p?.weatherName) throw new Error(`no DataEF weather name for province ${provinceCode}`);
      const raw = await getJson('DATAEF_WEATHER_PATH', { province: p.weatherName });
      return normaliseCurrent(findArray(raw)[0] ?? ((raw as { data?: Record<string, unknown> }).data ?? {}), provinceCode);
    },
    mode,
  );
}

/** One DataEF call returns all 25 provinces; cache each. Used by the refresh job. */
export async function refreshCurrentWeather() {
  if (isMock()) return 0;
  const raw = await getJson('DATAEF_WEATHER_ALL_PATH');
  const names = await provinceWeatherNames();
  let n = 0;
  for (const row of findArray(raw)) {
    const code = names.get(String(row.name ?? '').toLowerCase());
    if (!code) continue;
    await writeCache(`weather-now:${code}`, normaliseCurrent(row, code), CURRENT_TTL);
    n++;
  }
  return n;
}
