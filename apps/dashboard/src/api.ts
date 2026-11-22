// Thin typed client for the backend API (tech design §6.5).
const BASE = import.meta.env.VITE_API_URL ?? '';

export type RiskLevel = 'urgent' | 'watch' | 'normal';
export type RiskReason = 'heavy_rain' | 'storm' | 'heat' | 'rain' | 'warm';
export type Forecast = {
  date: string;
  rainMm: number;
  tempMaxC: number;
  tempMinC?: number;
  condition: string;
  rainChancePct?: number;
  windKph?: number;
  rainStartHour?: number;
};
export type Risk = {
  level: RiskLevel;
  reasons: RiskReason[];
  perDay: { date: string; level: RiskLevel; reasons: RiskReason[] }[];
};
export type VillageRow = {
  code: string;
  nameKm: string;
  nameEn: string;
  lat: number | null;
  lng: number | null;
  approximateLocation: boolean;
  subscribers: number;
  risk: Risk | null;
  forecastUpdatedAt: string | null;
  forecastStale: boolean | null;
};
export type VillageForecast = {
  village: { code: string; nameKm: string; nameEn: string };
  forecast: Forecast[];
  risk: Risk;
  fetchedAt: string;
  stale: boolean;
  now: Now | null;
};
export type AlertRow = {
  id: number;
  type: string;
  textKm: string;
  villageCode: string | null;
  villageCodes: string[] | null;
  createdAt: string;
  sent: number;
  failed: number;
  blocked: number;
};
type Place = { code: string; nameKm: string; nameEn: string };
export type Officer = {
  id: number;
  email: string;
  name: string;
  communeCode: string | null;
  area: { commune: Place; district: Place; province: Place } | null;
  role: 'officer' | 'partner' | 'admin';
  orgName: string | null;
  orgNameKm: string | null;
};
export type Area = Place & { level: string };
export type NewsAreas = { everywhere: boolean; areas: Area[]; weeklyLimit: number | null; sentThisWeek: number };
export type NewsRow = {
  id: number;
  title: string | null;
  text: string;
  areas: Area[];
  createdAt: string;
  sender: string | null;
  sent: number;
  failed: number;
  blocked: number;
};
export type Now = {
  province: string;
  observedAt: string;
  tempC: number;
  condition: string;
  conditionText: string;
  precipMm: number;
  humidity?: number;
  stale: boolean;
};

let token: string | null = localStorageGet('sour_token');

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export const hasToken = () => !!token;
export function logout() {
  token = null;
  localStorageSet('sour_token', null);
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth/login') {
    logout();
    location.reload();
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  async login(email: string, password: string) {
    const r = await req<{ token: string; officer: Officer }>('POST', '/api/auth/login', { email, password });
    token = r.token;
    localStorageSet('sour_token', r.token);
    return r.officer;
  },
  /** Demo mode: is one-click sign-in available? */
  demoEnabled: () => req<{ enabled: boolean }>('GET', '/api/auth/demo').then((r) => r.enabled).catch(() => false),
  async demoLogin(role: 'officer' | 'partner') {
    const r = await req<{ token: string; officer: Officer }>('POST', '/api/auth/demo', { role });
    token = r.token;
    localStorageSet('sour_token', r.token);
    return r.officer;
  },
  me: () => req<Officer>('GET', '/api/me'),
  setArea: (communeCode: string) => req<Officer>('PUT', '/api/me', { communeCode }),
  provinces: () => req<Place[]>('GET', '/api/locations/provinces'),
  districts: (province: string) => req<Place[]>('GET', `/api/locations/districts?province=${province}`),
  communes: (district: string) => req<Place[]>('GET', `/api/locations/communes?district=${district}`),
  villages: () => req<VillageRow[]>('GET', '/api/villages'),
  forecast: (code: string) => req<VillageForecast>('GET', `/api/villages/${code}/forecast`),
  draft: (villageCodes: string[]) => req<{ text: string }>('POST', '/api/alerts/draft', { villageCodes }),
  preview: (villageCodes: string[], text: string) =>
    req<{ recipients: number }>('POST', '/api/alerts/send', { villageCodes, text, preview: true }),
  send: (villageCodes: string[], text: string) =>
    req<{ recipients: number; sent: number; failed: number; blocked: number }>('POST', '/api/alerts/send', {
      villageCodes,
      text,
    }),
  alerts: () => req<AlertRow[]>('GET', '/api/alerts'),
  runJob: (name: string) => req<unknown>('POST', `/api/jobs/${name}/run`),
  // News & announcements (partner / admin accounts)
  newsAreas: () => req<NewsAreas>('GET', '/api/news/areas'),
  newsPreview: (areas: string[]) => req<{ recipients: number; areas: Area[] }>('POST', '/api/news/preview', { areas }),
  newsSend: (areas: string[], title: string, text: string) =>
    req<{ recipients: number; sent: number; failed: number; blocked: number }>('POST', '/api/news/send', {
      areas,
      title,
      text,
    }),
  news: () => req<NewsRow[]>('GET', '/api/news'),
};
