// Tool registry: one tool per DataEF API (NFR-6: a new dataset = one wrapper + one entry here).
// Tools read only through the cached data layer, never the raw API.
import type { ToolSpec } from './client';
import {
  assessRisk,
  convert,
  convertCurrency,
  CURRENCIES,
  currencyName,
  getFxTable,
  MAIN_CURRENCIES,
  findCropPrice,
  getAqi,
  getCsxIndex,
  getCsxSummary,
  getCurrentWeather,
  getForecast,
  getFxRate,
  getUv,
} from '@sour/dataef';
import { findPlace, getVillage } from '@sour/db';
import { ADVICE_RULES, selectRules } from './advice';

export type ToolContext = { villageCode: string | null };

const CURRENCY_CODES = Object.keys(CURRENCIES);

type ToolDef = {
  spec: ToolSpec;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

const meta = (c: { fetchedAt: Date; stale: boolean }) => ({
  fetched_at: c.fetchedAt.toISOString(),
  stale: c.stale,
});

export const TOOLS: ToolDef[] = [
  {
    spec: {
      name: 'get_weather_forecast',
      description:
        "Weather forecast (rain in mm, max temperature, condition) for a village, plus the approved farming advice that matches it. Defaults to the user's own village.",
      input_schema: {
        type: 'object',
        properties: {
          village_code: { type: 'string', description: "8-digit village code; omit for the user's village" },
          days: { type: 'integer', minimum: 1, maximum: 3, description: 'Number of days (1-3)' },
        },
      },
    },
    async run(input, ctx) {
      const code = (input.village_code as string) || ctx.villageCode;
      if (!code) return { error: 'no village selected' };
      const v = await getVillage(code);
      if (!v) return { error: `unknown village ${code}` };
      const fc = await getForecast(v.village.forecastLocation ?? code);
      if (!fc) return { error: 'forecast not available right now' };
      const days = Math.min(3, Math.max(1, Number(input.days) || 3));
      return {
        village: { code, name_km: v.village.nameKm, name_en: v.village.nameEn, province: v.province.nameEn },
        forecast: fc.data.slice(0, days),
        risk_next_24h: assessRisk(fc.data, 1),
        approved_advice: selectRules(fc.data).map((r) => ({ ...r.rule, hour: r.hour })),
        ...meta(fc),
      };
    },
  },
  {
    spec: {
      name: 'get_current_weather',
      description:
        "Official current weather right now (temperature, condition, rain) for the province of a village, from the DataEF weather API. Defaults to the user's village.",
      input_schema: {
        type: 'object',
        properties: {
          village_code: { type: 'string', description: "8-digit village code; omit for the user's village" },
        },
      },
    },
    async run(input, ctx) {
      const code = (input.village_code as string) || ctx.villageCode;
      if (!code) return { error: 'no village selected' };
      const now = await getCurrentWeather(code.slice(0, 2));
      return now ? { ...now.data, ...meta(now) } : { error: 'current weather not available right now' };
    },
  },
  {
    spec: {
      name: 'get_exchange_rate',
      description:
        "Today's official National Bank of Cambodia exchange rates against the riel (KHR). Optionally pass currency codes (e.g. ['USD','THB','VND']); default is the main ones. 'unit' says how many units the riel price is for (e.g. 1000 VND).",
      input_schema: {
        type: 'object',
        properties: {
          currencies: { type: 'array', items: { type: 'string', enum: CURRENCY_CODES }, description: 'ISO codes' },
        },
      },
    },
    async run(input) {
      const table = await getFxTable();
      if (!table) {
        const fx = await getFxRate();
        return fx ? { ...fx.data, ...meta(fx) } : { error: 'exchange rate not available right now' };
      }
      const want = Array.isArray(input.currencies) && input.currencies.length ? (input.currencies as string[]) : MAIN_CURRENCIES;
      return { date: table.data.date, rates: table.data.rates.filter((r) => want.includes(r.code)), ...meta(table) };
    },
  },
  {
    spec: {
      name: 'convert_currency',
      description:
        'Convert an amount between any two currencies (riel KHR, USD, THB, VND, CNY, EUR, JPY, KRW, …) at the official NBC rate. The result is exact; use it as-is.',
      input_schema: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          from: { type: 'string', enum: CURRENCY_CODES },
          to: { type: 'string', enum: CURRENCY_CODES },
        },
        required: ['amount', 'from', 'to'],
      },
    },
    async run(input) {
      const amount = Number(input.amount);
      const from = String(input.from).toUpperCase();
      const to = String(input.to).toUpperCase();
      const table = await getFxTable();
      const result = table ? convertCurrency(amount, from, to, table.data) : null;
      if (table && result !== null)
        return { amount, from, to, result, from_name: currencyName(from, 'en'), to_name: currencyName(to, 'en'), ...meta(table) };
      // Fallback: USD ↔ KHR from the single-rate cache.
      const fx = await getFxRate();
      if (fx && ['USD', 'KHR'].includes(from) && ['USD', 'KHR'].includes(to))
        return { amount, from, to, result: convert(amount, from as 'USD', to as 'KHR', fx.data), ...meta(fx) };
      return { error: `no NBC rate for ${from} or ${to} right now` };
    },
  },
  {
    spec: {
      name: 'get_csx_index',
      description: 'Cambodia Securities Exchange (CSX) index value and % change today.',
      input_schema: { type: 'object', properties: {} },
    },
    async run() {
      const idx = await getCsxIndex();
      return idx ? { ...idx.data, ...meta(idx) } : { error: 'CSX index not available right now' };
    },
  },
  {
    spec: {
      name: 'get_csx_summary',
      description: 'CSX market summary: per-company closing price and % change, when available.',
      input_schema: { type: 'object', properties: {} },
    },
    async run() {
      const s = await getCsxSummary();
      return s ? { ...s.data, ...meta(s) } : { error: 'CSX summary not available right now' };
    },
  },
  {
    spec: {
      name: 'find_village',
      description:
        'Find a place by name (Khmer or English): village, commune, district or province. Returns village codes to use with the weather tools (for a commune/district/province, use its villageCode).',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    async run(input) {
      return { matches: await findPlace(String(input.name ?? '')) };
    },
  },
  {
    spec: {
      name: 'lookup_crop_price',
      description:
        'Look up current indicative market and farmgate prices for Cambodian agricultural crops (paddy rice, fragrant rice, fresh/dry cassava, cashew nuts, red maize/corn, rubber, black pepper, morning glory, etc.).',
      input_schema: {
        type: 'object',
        properties: {
          crop_name: {
            type: 'string',
            description:
              'Name of the crop or commodity in Khmer or English (e.g. "cassava", "ដំឡូងមី", "paddy", "ស្រូវ", "cashew", "ស្វាយចន្ទី")',
          },
        },
        required: ['crop_name'],
      },
    },
    async run(input) {
      const q = String(input.crop_name ?? '');
      const item = findCropPrice(q);
      if (!item) {
        return {
          error: `No price data found for "${q}". Available items: paddy rice (ស្រូវផ្ការំដួល, សែនក្រអូប, IR504), milled rice, cassava (ដំឡូងមី), cashew (ស្វាយចន្ទី), red corn (ពោតក្រហម), rubber (កៅស៊ូ), pepper (ម្រេច).`,
        };
      }
      return {
        crop: item.nameEn,
        crop_km: item.nameKm,
        price_min_khr: item.priceMin,
        price_max_khr: item.priceMax,
        price_avg_khr: item.priceAvg,
        unit: item.unit,
        market: item.market,
        note_km: item.noteKm,
        note_en: item.noteEn,
      };
    },
  },
  {
    spec: {
      name: 'get_air_quality',
      description:
        'Current Air Quality Index (AQI, PM2.5) and Ultraviolet (UV) radiation index for a province from DataEF.',
      input_schema: {
        type: 'object',
        properties: {
          village_code: {
            type: 'string',
            description: "8-digit village code or 2-digit province code; omit for user's village",
          },
        },
      },
    },
    async run(input, ctx) {
      const code = (input.village_code as string) || ctx.villageCode;
      if (!code) return { error: 'no village selected' };
      const provinceCode = code.slice(0, 2);
      const [aqi, uv] = await Promise.all([getAqi(provinceCode), getUv(provinceCode)]);
      return {
        province_code: provinceCode,
        aqi: aqi ? { ...aqi.data, ...meta(aqi) } : null,
        uv: uv ? { ...uv.data, ...meta(uv) } : null,
      };
    },
  },
];

export const TOOL_SPECS = TOOLS.map((t) => t.spec);

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
  const tool = TOOLS.find((t) => t.spec.name === name);
  if (!tool) return JSON.stringify({ error: `unknown tool ${name}` });
  try {
    return JSON.stringify(await tool.run((input ?? {}) as Record<string, unknown>, ctx));
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

export const ADVICE_LIST_TEXT = ADVICE_RULES.map((r) => `- ${r.condition}: ${r.en}`).join('\n');
