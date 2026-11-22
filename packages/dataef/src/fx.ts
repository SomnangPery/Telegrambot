import { cached, type ReadMode } from './cache';
import { field, findObject, getJson, isMock, numField, today } from './http';
import { mockFx } from './mock';
import type { Cached, FxRate } from './types';

const TTL = 6 * 60 * 60 * 1000; // 6 h

export function normaliseFx(raw: unknown): FxRate {
  // NBC publishes many currencies; try to find the USD row first.
  const o = findObject(raw);
  const rows = Object.values(o).find(Array.isArray) as Record<string, unknown>[] | undefined;
  const usd =
    rows?.find((r) => /usd/i.test(String(field(r, ['currency', 'symbol', 'code', 'currencyid']) ?? ''))) ?? o;
  const buy = numField(usd, ['usdkhrbuy', 'buy', 'bid', 'buying', 'average', 'rate']);
  const sell = numField(usd, ['usdkhrsell', 'sell', 'ask', 'selling', 'average', 'rate'], buy);
  if (!Number.isFinite(buy)) throw new Error('no USD/KHR rate in reply');
  return {
    date: String(field(usd, ['validdate', 'date', 'ratedate']) ?? field(o, ['validdate', 'date']) ?? today()).slice(0, 10),
    usdKhrBuy: buy,
    usdKhrSell: sell,
    fetchedAt: new Date().toISOString(),
  };
}

/** Today's official NBC USD/KHR rate (cached 6 h). */
export function getFxRate(mode: ReadMode = 'cache'): Promise<Cached<FxRate> | null> {
  return cached(
    'fx:usdkhr',
    TTL,
    async () => (isMock() ? mockFx(today()) : normaliseFx(await getJson('DATAEF_FX_PATH'))),
    mode,
  );
}

/** Exact currency conversion in code (the AI never does the maths). Uses the mid rate. */
export function convert(amount: number, from: 'USD' | 'KHR', to: 'USD' | 'KHR', rate: FxRate) {
  if (from === to) return amount;
  const mid = (rate.usdKhrBuy + rate.usdKhrSell) / 2;
  return from === 'USD' ? Math.round(amount * mid) : Math.round((amount / mid) * 100) / 100;
}
