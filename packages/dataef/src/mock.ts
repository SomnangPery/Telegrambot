// Deterministic demo data used when DATAEF_MODE=mock (default) — no network needed.
// Same location + same day always gives the same numbers, so the demo is repeatable.
import type { CsxIndex, CsxSummary, CurrentWeather, Forecast, FxRate } from './types';

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function mockForecast(locationCode: string, startDate: string, days = 3): Forecast[] {
  const red = (process.env.DEMO_RED_LOCATIONS ?? '').split(',').map((s) => s.trim());
  const fetchedAt = new Date().toISOString();
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(startDate, i);
    if (i === 0 && red.includes(locationCode)) {
      return {
        locationCode, date, rainMm: 68, tempMaxC: 31, tempMinC: 24, condition: 'thunderstorm',
        rainChancePct: 90, windKph: 45, rainStartHour: 15, fetchedAt,
      };
    }
    const r = hash(`${locationCode}:${date}`);
    const rainMm = r < 0.35 ? 0 : r < 0.7 ? Math.round(r * 15) : r < 0.9 ? Math.round(10 + r * 25) : Math.round(30 + r * 30);
    const tempMaxC = Math.round(30 + hash(`${date}:${locationCode}:t`) * 7);
    const condition =
      rainMm >= 50 ? 'heavy_rain' : rainMm >= 20 ? 'rain' : rainMm > 0 ? 'light_rain' : r < 0.15 ? 'clear' : 'cloudy';
    return {
      locationCode, date, rainMm, tempMaxC, tempMinC: tempMaxC - 8, condition,
      rainChancePct: rainMm > 0 ? Math.min(95, 40 + rainMm) : 10,
      windKph: Math.round(8 + r * 20),
      rainStartHour: rainMm > 0 ? 13 + Math.floor(r * 5) : undefined,
      fetchedAt,
    };
  });
}

export function mockCurrent(provinceCode: string): CurrentWeather {
  const r = hash(`now:${provinceCode}:${new Date().getHours()}`);
  return {
    provinceCode,
    province: provinceCode,
    observedAt: new Date().toISOString(),
    tempC: Math.round(26 + r * 8),
    condition: r > 0.7 ? 'light_rain' : 'cloudy',
    conditionText: r > 0.7 ? 'Patchy rain nearby' : 'Partly cloudy',
    precipMm: r > 0.7 ? 0.4 : 0,
    humidity: 70,
    windKph: 8,
    fetchedAt: new Date().toISOString(),
  };
}

export function mockFx(date: string): FxRate {
  const base = 4010 + Math.round(hash(`fx:${date}`) * 40);
  return { date, usdKhrBuy: base, usdKhrSell: base + 4, fetchedAt: new Date().toISOString() };
}

const TICKERS: [string, string, number][] = [
  ['PWSA', 'Phnom Penh Water Supply Authority', 6200],
  ['GTI', 'Grand Twins International', 3100],
  ['PPAP', 'Phnom Penh Autonomous Port', 13500],
  ['PPSP', 'Phnom Penh SEZ', 2300],
  ['PAS', 'Sihanoukville Autonomous Port', 12800],
  ['ABC', 'ACLEDA Bank', 7840],
  ['PEPC', 'PESTECH (Cambodia)', 2200],
  ['MJQE', 'Mengly J. Quach Education', 2050],
  ['PCG', 'Picasso City Garden Development', 2400],
  ['DBD', 'DBD Engineering', 2050],
  ['JSL', 'JS Land', 4200],
];

export function mockCsxSummary(date: string): CsxSummary {
  return {
    date,
    stocks: TICKERS.map(([ticker, name, base]) => {
      const changePct = Math.round((hash(`${ticker}:${date}`) * 6 - 3) * 10) / 10;
      const close = Math.round(base * (1 + changePct / 100));
      return { ticker, name, close, open: base, change: close - base, changePct };
    }),
    fetchedAt: new Date().toISOString(),
  };
}

export function mockCsxIndex(date: string): CsxIndex {
  const s = mockCsxSummary(date).stocks;
  const changePct = Math.round((s.reduce((a, b) => a + b.changePct, 0) / s.length) * 10) / 10;
  return { date, value: Math.round((650 * (1 + changePct / 100)) * 10) / 10, changePct, fetchedAt: new Date().toISOString() };
}
