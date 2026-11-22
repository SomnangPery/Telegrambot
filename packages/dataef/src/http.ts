import '@sour/db/env';

export const isMock = () => (process.env.DATAEF_MODE ?? 'live') === 'mock';

// Real DataEF endpoints (from https://data.mef.gov.kh/api/openapi.json). Overridable via env.
const DEFAULT_PATHS: Record<string, string> = {
  DATAEF_WEATHER_PATH: '/api/v1/realtime-api/weather?province={province}',
  DATAEF_WEATHER_ALL_PATH: '/api/v1/realtime-api/weather',
  DATAEF_FX_PATH: '/api/v1/realtime-api/exchange-rate?currency_id=USD',
  DATAEF_FX_ALL_PATH: '/api/v1/realtime-api/exchange-rate',
  DATAEF_CSX_INDEX_PATH: '/api/v1/realtime-api/csx-index',
  DATAEF_CSX_SUMMARY_PATH: '/api/v1/realtime-api/csx-summary',
  DATAEF_AQI_PATH: '/api/v1/realtime-api/aqi?province={province}',
  DATAEF_UV_PATH: '/api/v1/realtime-api/uv?province={province}',
};

/** GET a DataEF endpoint. */
export async function getJson(pathEnv: string, params: Record<string, string> = {}): Promise<unknown> {
  const base = process.env.DATAEF_BASE_URL || 'https://data.mef.gov.kh';
  let path = process.env[pathEnv] || DEFAULT_PATHS[pathEnv];
  if (!path) throw new Error(`${pathEnv} not configured`);
  for (const [k, v] of Object.entries(params)) path = path.replaceAll(`{${k}}`, encodeURIComponent(v));

  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = process.env.DATAEF_API_KEY;
  if (key) {
    headers.Authorization = `Bearer ${key}`;
    headers['x-api-key'] = key;
  }
  const res = await fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${pathEnv}`);
  return res.json();
}

// ---- Lenient field helpers: the exact response fields are not documented yet. ----

/** Finds the first array of objects inside a reply (handles {data:[...]}, {result:{items:[...]}}, [...]). */
export function findArray(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === 'object') {
    for (const v of Object.values(raw)) {
      const arr = findArray(v);
      if (arr.length) return arr;
    }
  }
  return [];
}

/** Returns the first object in the reply that is not an array wrapper. */
export function findObject(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) return (raw[raw.length - 1] ?? {}) as Record<string, unknown>;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const k of ['data', 'result', 'results']) if (o[k]) return findObject(o[k]);
    return o;
  }
  return {};
}

export function field(o: Record<string, unknown>, names: string[]): unknown {
  const keys = Object.keys(o);
  for (const n of names) {
    const k = keys.find((key) => key.toLowerCase().replace(/[\s_-]/g, '') === n);
    if (k !== undefined && o[k] !== null && o[k] !== '') return o[k];
  }
  return undefined;
}

export const numField = (o: Record<string, unknown>, names: string[], dflt = NaN) => {
  const v = field(o, names);
  if (v === undefined || v === null || v === '' || v === '-') return dflt;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,%]/g, ''));
  return Number.isFinite(n) ? n : dflt;
};

export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' });
