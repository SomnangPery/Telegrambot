import { db, provinces } from '@sour/db';
import { eq } from 'drizzle-orm';
import { cached, type ReadMode } from './cache';
import { field, findObject, getJson, isMock, numField } from './http';
import type { AqiReading, Cached, UvReading } from './types';

const AQI_TTL = 60 * 60 * 1000; // 60 min

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

function classifyAqi(aqi: number): AqiReading['category'] {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthy_sensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very_unhealthy';
  return 'hazardous';
}

function classifyUv(uv: number): UvReading['level'] {
  if (uv <= 2) return 'low';
  if (uv <= 5) return 'moderate';
  if (uv <= 7) return 'high';
  if (uv <= 10) return 'very_high';
  return 'extreme';
}

export function mockAqi(provinceCode: string): AqiReading {
  const r = hash(`aqi:${provinceCode}:${new Date().toISOString().slice(0, 10)}`);
  const aqi = Math.round(25 + r * 65);
  return {
    provinceCode,
    provinceName: provinceCode,
    aqi,
    category: classifyAqi(aqi),
    pm25: Math.round(aqi * 0.45),
    pm10: Math.round(aqi * 0.75),
    fetchedAt: new Date().toISOString(),
  };
}

export function mockUv(provinceCode: string): UvReading {
  const r = hash(`uv:${provinceCode}:${new Date().getHours()}`);
  const uvIndex = Math.round(3 + r * 7);
  return {
    provinceCode,
    provinceName: provinceCode,
    uvIndex,
    level: classifyUv(uvIndex),
    fetchedAt: new Date().toISOString(),
  };
}

/** DataEF expects the province name (e.g. "Battambang"), not its code. */
async function provinceParam(provinceCode: string) {
  const [p] = await db.select().from(provinces).where(eq(provinces.code, provinceCode)).limit(1);
  if (!p?.weatherName) throw new Error(`no DataEF name for province ${provinceCode}`);
  return p.weatherName;
}

/** US-EPA AQI from a PM2.5 reading (µg/m³), 2024 breakpoints. */
export function aqiFromPm25(pm: number): number {
  const bp: [number, number, number, number][] = [
    [0, 9.0, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 500],
  ];
  const c = Math.floor(pm * 10) / 10;
  const row = bp.find(([lo, hi]) => c >= lo && c <= hi) ?? bp[bp.length - 1];
  const [lo, hi, ilo, ihi] = row;
  return Math.round(((ihi - ilo) / (hi - lo)) * (Math.min(c, hi) - lo) + ilo);
}

/** DataEF's us_epa_index (1–6) → our category. */
const EPA_CATEGORY: AqiReading['category'][] = [
  'good',
  'moderate',
  'unhealthy_sensitive',
  'unhealthy',
  'very_unhealthy',
  'hazardous',
];

/** Air quality for a province from the DataEF AQI API (cached 60 min). Never invents values. */
export async function getAqi(
  provinceCode: string,
  mode: ReadMode = 'cache',
): Promise<Cached<AqiReading> | null> {
  return cached(
    `aqi:${provinceCode}`,
    AQI_TTL,
    async () => {
      if (isMock()) return mockAqi(provinceCode);
      const o = findObject(await getJson('DATAEF_AQI_PATH', { province: await provinceParam(provinceCode) }));
      const pm25 = numField(o, ['pm25', 'pm2_5']);
      const pm10 = numField(o, ['pm10']);
      const epa = numField(o, ['usepaindex']);
      if (!Number.isFinite(pm25) && !Number.isFinite(epa)) throw new Error('AQI reply has no PM2.5 or EPA index');
      const aqi = Number.isFinite(pm25) ? aqiFromPm25(pm25) : NaN;
      return {
        provinceCode,
        provinceName: String(field(o, ['name', 'province']) ?? provinceCode),
        aqi,
        category: Number.isFinite(epa) && EPA_CATEGORY[epa - 1] ? EPA_CATEGORY[epa - 1] : classifyAqi(aqi),
        pm25: Number.isFinite(pm25) ? pm25 : undefined,
        pm10: Number.isFinite(pm10) ? pm10 : undefined,
        fetchedAt: new Date().toISOString(),
      };
    },
    mode,
  );
}

export async function getUv(
  provinceCode: string,
  mode: ReadMode = 'cache',
): Promise<Cached<UvReading> | null> {
  return cached(
    `uv:${provinceCode}`,
    AQI_TTL,
    async () => {
      if (isMock()) return mockUv(provinceCode);
      const o = findObject(await getJson('DATAEF_UV_PATH', { province: await provinceParam(provinceCode) }));
      const uvVal = numField(o, ['uv', 'uvindex']);
      if (!Number.isFinite(uvVal)) throw new Error('UV reply has no value');
      return {
        provinceCode,
        provinceName: String(field(o, ['name', 'province']) ?? provinceCode),
        uvIndex: uvVal,
        level: classifyUv(uvVal),
        fetchedAt: new Date().toISOString(),
      };
    },
    mode,
  );
}

const AQI_LABEL: Record<string, { km: string; en: string }> = {
  good: { km: 'ល្អ (ខ្យល់បរិសុទ្ធ)', en: 'Good (clean air)' },
  moderate: { km: 'មធ្យម', en: 'Moderate' },
  unhealthy_sensitive: { km: 'មិនល្អចំពោះក្រុមងាយរងគ្រោះ', en: 'Unhealthy for sensitive groups' },
  unhealthy: { km: 'មិនល្អចំពោះសុខភាព', en: 'Unhealthy' },
  very_unhealthy: { km: 'មិនល្អខ្លាំង', en: 'Very unhealthy' },
  hazardous: { km: 'គ្រោះថ្នាក់ខ្លាំង', en: 'Hazardous' },
};

const UV_LABEL: Record<string, { km: string; en: string }> = {
  low: { km: 'ទាប', en: 'Low' },
  moderate: { km: 'មធ្យម', en: 'Moderate' },
  high: { km: 'ខ្ពស់ (គួរពាក់មួក/ការពារ)', en: 'High (wear a hat/protection)' },
  very_high: { km: 'ខ្ពស់ខ្លាំង', en: 'Very high' },
  extreme: { km: 'គ្រោះថ្នាក់ខ្លាំង (ចៀសវាងត្រូវថ្ងៃយូរ)', en: 'Extreme (avoid prolonged sun exposure)' },
};

export function formatAqi(reading: AqiReading, lang: string): string {
  const isEn = lang === 'en';
  const label = AQI_LABEL[reading.category] ?? { km: reading.category, en: reading.category };
  const desc = isEn ? label.en : label.km;
  const pm25 = reading.pm25 != null ? ` · PM2.5: ${reading.pm25} µg/m³` : '';
  const value = Number.isFinite(reading.aqi) ? `${reading.aqi} – ` : '';
  return isEn
    ? `💨 Air Quality (AQI): ${value}${desc}${pm25}`
    : `💨 គុណភាពខ្យល់ (AQI)៖ ${value}${desc}${pm25}`;
}

export function formatUv(reading: UvReading, lang: string): string {
  const isEn = lang === 'en';
  const label = UV_LABEL[reading.level] ?? { km: reading.level, en: reading.level };
  const desc = isEn ? label.en : label.km;
  return isEn
    ? `☀️ UV Index: ${reading.uvIndex} – ${desc}`
    : `☀️ កម្រិតកាំរស្មី UV៖ ${reading.uvIndex} – ${desc}`;
}
