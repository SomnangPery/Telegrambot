import { cached, type ReadMode } from './cache';
import { field, findArray, findObject, getJson, isMock, numField, today } from './http';
import { mockCsxIndex, mockCsxSummary } from './mock';
import type { Cached, CsxIndex, CsxSummary } from './types';

const TTL = 15 * 60 * 1000; // 15 min

/** DataEF gives unsigned changes plus change_up_down = "up" | "down" | "equal". */
const signed = (r: Record<string, unknown>, n: number) => {
  const dir = String(field(r, ['changeupdown', 'direction']) ?? '').toLowerCase();
  return dir === 'down' ? -Math.abs(n) : dir === 'equal' ? 0 : dir === 'up' ? Math.abs(n) : n;
};

export function normaliseCsxIndex(raw: unknown): CsxIndex {
  const o = findObject(raw);
  const value = numField(o, ['value', 'index', 'csxindex', 'close', 'closingindex', 'last']);
  if (!Number.isFinite(value)) throw new Error('no index value in reply');
  return {
    date: String(field(o, ['date', 'tradedate', 'tradingdate']) ?? today()).replaceAll('/', '-').slice(0, 10),
    value,
    changePct: signed(o, numField(o, ['changepct', 'changepercent', 'percentchange', 'pctchange'], 0)),
    fetchedAt: new Date().toISOString(),
  };
}

export function normaliseCsxSummary(raw: unknown): CsxSummary {
  const stocks = findArray(raw)
    .map((r) => {
      const close = numField(r, ['close', 'closingprice', 'closeprice', 'price', 'last']);
      const change = signed(r, numField(r, ['change', 'pricechange'], 0));
      const prev = close - change;
      const pct = numField(r, ['changepct', 'changepercent', 'percentchange', 'pctchange']);
      return {
        ticker: String(field(r, ['stock', 'ticker', 'symbol', 'stockcode', 'name']) ?? ''),
        close,
        open: numField(r, ['openprice', 'open', 'openingprice']),
        change,
        changePct: Number.isFinite(pct) ? signed(r, pct) : prev ? Math.round((change / prev) * 10000) / 100 : 0,
      };
    })
    .filter((s) => s.ticker && Number.isFinite(s.close));
  return { date: today(), stocks, fetchedAt: new Date().toISOString() };
}

export function getCsxIndex(mode: ReadMode = 'cache'): Promise<Cached<CsxIndex> | null> {
  return cached(
    'csx:index',
    TTL,
    async () => (isMock() ? mockCsxIndex(today()) : normaliseCsxIndex(await getJson('DATAEF_CSX_INDEX_PATH'))),
    mode,
  );
}

/** Market summary. `stocks` may be empty if the API only returns totals. */
export function getCsxSummary(mode: ReadMode = 'cache'): Promise<Cached<CsxSummary> | null> {
  return cached(
    'csx:summary',
    TTL,
    async () => (isMock() ? mockCsxSummary(today()) : normaliseCsxSummary(await getJson('DATAEF_CSX_SUMMARY_PATH'))),
    mode,
  );
}

export function biggestMoves(s: CsxSummary) {
  if (!s.stocks.length) return null;
  const sorted = [...s.stocks].sort((a, b) => b.changePct - a.changePct);
  return { up: sorted[0], down: sorted[sorted.length - 1] };
}
