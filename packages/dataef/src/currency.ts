// All NBC exchange rates from DataEF (≈30 currencies), conversion between any two of them via
// riel, and recognising currency amounts in Khmer/English text. Maths is always done in code.
import { cached, type ReadMode } from './cache';
import { field, findArray, getJson, isMock, numField, today } from './http';
import type { Cached } from './types';

const TTL = 6 * 60 * 60 * 1000; // 6 h, same as the USD rate

export type CurrencyRate = {
  code: string;
  name: string;
  unit: number; // NBC quotes some currencies per 100 or per 1,000 units
  bid: number;
  ask: number;
  average: number; // riel per `unit` units
};
export type FxTable = { date: string; rates: CurrencyRate[]; fetchedAt: string };

/** Currencies people in Cambodia ask about, with Khmer names and the words used for them. */
export const CURRENCIES: Record<string, { km: string; en: string; symbol?: string; aliases: string[] }> = {
  KHR: { km: 'រៀល', en: 'riel', symbol: '៛', aliases: ['៛', 'khr', 'riel', 'riels', 'រៀល'] },
  USD: { km: 'ដុល្លារ', en: 'US dollar', symbol: '$', aliases: ['$', 'usd', 'us dollar', 'dollar', 'dollars', 'ដុល្លារអាមេរិក', 'ដុល្លារ'] },
  THB: { km: 'បាតថៃ', en: 'Thai baht', symbol: '฿', aliases: ['฿', 'thb', 'baht', 'បាតថៃ', 'បាត'] },
  VND: { km: 'ដុងវៀតណាម', en: 'Vietnamese dong', symbol: '₫', aliases: ['₫', 'vnd', 'dong', 'ដុងវៀតណាម', 'ដុង'] },
  CNY: { km: 'យ៉ន់ចិន', en: 'Chinese yuan', symbol: '¥', aliases: ['¥', 'cny', 'rmb', 'yuan', 'យ៉ន់ចិន', 'យ៉ន់', 'យន់', 'យួន'] },
  EUR: { km: 'អឺរ៉ូ', en: 'euro', symbol: '€', aliases: ['€', 'eur', 'euro', 'euros', 'អឺរ៉ូ'] },
  JPY: { km: 'យ៉េនជប៉ុន', en: 'Japanese yen', aliases: ['jpy', 'yen', 'យ៉េនជប៉ុន', 'យ៉េន'] },
  KRW: { km: 'វ៉ុនកូរ៉េ', en: 'Korean won', symbol: '₩', aliases: ['₩', 'krw', 'won', 'វ៉ុនកូរ៉េ', 'វ៉ុន'] },
  GBP: { km: 'ផោនអង់គ្លេស', en: 'British pound', symbol: '£', aliases: ['£', 'gbp', 'pound', 'pounds', 'ផោនអង់គ្លេស', 'ផោន'] },
  LAK: { km: 'គីបឡាវ', en: 'Lao kip', aliases: ['lak', 'kip', 'គីបឡាវ', 'គីប'] },
  MYR: { km: 'រីងហ្គីតម៉ាឡេស៊ី', en: 'Malaysian ringgit', aliases: ['myr', 'ringgit', 'រីងហ្គីត'] },
  SGD: { km: 'ដុល្លារសិង្ហបុរី', en: 'Singapore dollar', aliases: ['sgd', 'singapore dollar', 'ដុល្លារសិង្ហបុរី'] },
  AUD: { km: 'ដុល្លារអូស្ត្រាលី', en: 'Australian dollar', aliases: ['aud', 'australian dollar', 'ដុល្លារអូស្ត្រាលី'] },
  HKD: { km: 'ដុល្លារហុងកុង', en: 'Hong Kong dollar', aliases: ['hkd', 'hong kong dollar', 'ដុល្លារហុងកុង'] },
  CAD: { km: 'ដុល្លារកាណាដា', en: 'Canadian dollar', aliases: ['cad', 'canadian dollar', 'ដុល្លារកាណាដា'] },
  TWD: { km: 'ដុល្លារតៃវ៉ាន់', en: 'Taiwan dollar', aliases: ['twd', 'taiwan dollar', 'ដុល្លារតៃវ៉ាន់'] },
  INR: { km: 'រូពីឥណ្ឌា', en: 'Indian rupee', aliases: ['inr', 'rupee', 'rupees', 'រូពី'] },
  IDR: { km: 'រូពីយ៉ាឥណ្ឌូនេស៊ី', en: 'Indonesian rupiah', aliases: ['idr', 'rupiah', 'រូពីយ៉ា'] },
  PHP: { km: 'ប៉េសូហ្វីលីពីន', en: 'Philippine peso', aliases: ['php', 'peso', 'pesos', 'ប៉េសូ'] },
  MMK: { km: 'ចាតភូមា', en: 'Myanmar kyat', aliases: ['mmk', 'kyat', 'ចាត'] },
  CHF: { km: 'ហ្វ្រង់ស្វីស', en: 'Swiss franc', aliases: ['chf', 'swiss franc', 'franc'] },
  NZD: { km: 'ដុល្លារនូវែលសេឡង់', en: 'New Zealand dollar', aliases: ['nzd', 'new zealand dollar'] },
  SEK: { km: 'ក្រូណាស៊ុយអែត', en: 'Swedish krona', aliases: ['sek', 'krona'] },
};

/** Shown for "exchange rate today": the currencies that matter most for Cambodian trade. */
export const MAIN_CURRENCIES = ['USD', 'THB', 'VND', 'CNY', 'EUR'];

export function normaliseFxTable(raw: unknown): FxTable {
  const rates = findArray(raw)
    .map((r) => {
      const code = String(field(r, ['currencyid', 'currency_id', 'code']) ?? '').toUpperCase();
      const bid = numField(r, ['bid', 'buy']);
      const ask = numField(r, ['ask', 'sell'], bid);
      return {
        code,
        name: String(field(r, ['currency', 'name']) ?? code),
        unit: numField(r, ['unit'], 1) || 1,
        bid,
        ask,
        average: numField(r, ['average'], (bid + ask) / 2),
      };
    })
    .filter((r) => /^[A-Z]{3}$/.test(r.code) && Number.isFinite(r.average) && r.average > 0);
  if (!rates.length) throw new Error('exchange-rate reply had no rates');
  const first = findArray(raw)[0] ?? {};
  return { date: String(field(first, ['validdate', 'date']) ?? today()).slice(0, 10), rates, fetchedAt: new Date().toISOString() };
}

function mockTable(): FxTable {
  const base: [string, number, number][] = [
    ['USD', 1, 4063], ['THB', 1, 120.5], ['VND', 1000, 158.5], ['CNY', 1, 613], ['EUR', 1, 4485.5],
    ['JPY', 100, 2555.5], ['KRW', 100, 306.5], ['GBP', 1, 5370.5], ['LAK', 1000, 182], ['SGD', 1, 3167],
  ];
  return {
    date: today(),
    rates: base.map(([code, unit, average]) => ({ code, name: CURRENCIES[code]?.en ?? code, unit, bid: average, ask: average, average })),
    fetchedAt: new Date().toISOString(),
  };
}

/** Every NBC rate for today (one DataEF call, cached 6 h). */
export function getFxTable(mode: ReadMode = 'cache'): Promise<Cached<FxTable> | null> {
  return cached(
    'fx:all',
    TTL,
    async () => (isMock() ? mockTable() : normaliseFxTable(await getJson('DATAEF_FX_ALL_PATH'))),
    mode,
  );
}

/** Riel for one single unit of a currency (KHR → 1). */
export function rielPerUnit(table: FxTable, code: string): number | null {
  if (code === 'KHR') return 1;
  const r = table.rates.find((x) => x.code === code);
  return r ? r.average / r.unit : null;
}

/** Converts between any two currencies via riel, at the NBC average rate. */
export function convertCurrency(amount: number, from: string, to: string, table: FxTable) {
  const a = rielPerUnit(table, from);
  const b = rielPerUnit(table, to);
  if (a === null || b === null) return null;
  const result = (amount * a) / b;
  // Riel and small-value currencies as whole numbers; others to 2 decimals.
  const whole = ['KHR', 'VND', 'IDR', 'LAK', 'KRW', 'JPY', 'MMK'].includes(to);
  return whole ? Math.round(result) : Math.round(result * 100) / 100;
}

// ---------------------------------------------------------------- recognising amounts in text

type Hit = { code: string; start: number; end: number };

/** Every currency mentioned in the text, longest names first ("ដុល្លារសិង្ហបុរី" before "ដុល្លារ"). */
export function findCurrencies(text: string): Hit[] {
  const lower = text.toLowerCase();
  const all = Object.entries(CURRENCIES)
    .flatMap(([code, c]) => c.aliases.map((a) => ({ code, alias: a })))
    .sort((x, y) => y.alias.length - x.alias.length);
  const taken = new Array(lower.length).fill(false);
  const hits: Hit[] = [];
  for (const { code, alias } of all) {
    const latin = /^[a-z ]+$/.test(alias);
    let from = 0;
    for (;;) {
      const i = lower.indexOf(alias, from);
      if (i < 0) break;
      from = i + alias.length;
      // Latin words must stand alone ("won" not in "wonder"); Khmer/symbols can touch digits.
      if (latin && (/[a-z]/.test(lower[i - 1] ?? '') || /[a-z]/.test(lower[i + alias.length] ?? ''))) continue;
      // Khmer: a following vowel/sign means it's part of another word ("បាត" in "បាត់ដំបង").
      if (/[ក-៿]/.test(alias) && /[ា-៓៝]/.test(lower[i + alias.length] ?? '')) continue;
      if (taken.slice(i, i + alias.length).some(Boolean)) continue;
      for (let k = i; k < i + alias.length; k++) taken[k] = true;
      hits.push({ code, start: i, end: i + alias.length });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/**
 * "$25 ស្មើនឹងប៉ុន្មានរៀល?" → { amount: 25, from: 'USD', to: 'KHR' }
 * "1000 បាត ប៉ុន្មានដុល្លារ" → THB → USD;  "100,000 រៀល" → KHR → USD.
 */
export function parseConversion(text: string): { amount: number; from: string; to: string } | null {
  const num = /(\d[\d,]*(?:\.\d+)?)/.exec(text.replace(/[០-៩]/g, (d) => String('០១២៣៤៥៦៧៨៩'.indexOf(d))));
  if (!num) return null;
  const amount = Number(num[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const hits = findCurrencies(text);
  if (!hits.length) return null;
  const at = num.index, end = num.index + num[0].length;
  // The currency written right next to the number is what the amount is in.
  const near = [...hits].sort(
    (a, b) => Math.min(Math.abs(a.end - at), Math.abs(a.start - end)) - Math.min(Math.abs(b.end - at), Math.abs(b.start - end)),
  )[0];
  const other = hits.find((h) => h.code !== near.code);
  const from = near.code;
  const to = other?.code ?? (from === 'KHR' ? 'USD' : 'KHR');
  return { amount, from, to };
}

// ---------------------------------------------------------------- formatting

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const currencyName = (code: string, lang: string) =>
  (lang === 'en' ? CURRENCIES[code]?.en : CURRENCIES[code]?.km) ?? code;

/** "💱 1,000 បាតថៃ = 120,500 រៀល" etc. */
export function formatConversion(amount: number, from: string, to: string, result: number, lang: string) {
  const src = lang === 'en' ? 'NBC official rate' : 'អត្រាផ្លូវការ NBC';
  const fromTxt = from === 'USD' ? `$${fmt(amount, 2)}` : `${fmt(amount, 2)} ${currencyName(from, lang)}`;
  const toTxt = to === 'USD' ? `$${fmt(result, 2)}` : `${fmt(result, 2)} ${currencyName(to, lang)}`;
  return `💱 ${fromTxt} = ${toTxt} (${src})`;
}

/** One line per currency: "🇹🇭 1 បាតថៃ = 120.5 រៀល". */
export function formatRateLine(r: CurrencyRate, lang: string) {
  const flag: Record<string, string> = { USD: '🇺🇸', THB: '🇹🇭', VND: '🇻🇳', CNY: '🇨🇳', EUR: '🇪🇺', JPY: '🇯🇵', KRW: '🇰🇷', GBP: '🇬🇧', LAK: '🇱🇦', SGD: '🇸🇬', MYR: '🇲🇾', AUD: '🇦🇺' };
  const riel = lang === 'en' ? 'riel' : 'រៀល';
  return `${flag[r.code] ?? '💱'} ${fmt(r.unit)} ${currencyName(r.code, lang)} = ${fmt(r.average, 1)} ${riel}`;
}

/** Rate table for "exchange rate today" (main currencies, or the ones asked about). */
export function formatRateTable(table: FxTable, lang: string, codes: string[] = MAIN_CURRENCIES) {
  const rows = codes.map((c) => table.rates.find((r) => r.code === c)).filter((r): r is CurrencyRate => !!r);
  const title = lang === 'en' ? `💱 NBC exchange rates (${table.date})` : `💱 អត្រាប្តូរប្រាក់ផ្លូវការ NBC (${table.date})`;
  return [title, ...rows.map((r) => formatRateLine(r, lang))].join('\n');
}
