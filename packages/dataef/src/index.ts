// The only way the rest of the app reads DataEF data (bot, scheduler, AI tools, dashboard).
export * from './types';
export { cached, readCache, writeCache, type ReadMode } from './cache';
export { isMock, today } from './http';
export {
  getForecast,
  getForecasts,
  getCurrentWeather,
  refreshCurrentWeather,
  locationPoint,
  normaliseCondition,
  normaliseCurrent,
  wmoCondition,
} from './weather';
export { getFxRate, convert, normaliseFx } from './fx';
export * from './currency';
export { getCsxIndex, getCsxSummary, biggestMoves, normaliseCsxIndex, normaliseCsxSummary } from './csx';
export * from './prices';
export * from './aqi';
export * from './risk';

import { getCsxIndex, getCsxSummary } from './csx';
import { getFxRate } from './fx';
import { getFxTable } from './currency';
import { getForecasts, refreshCurrentWeather } from './weather';

/** Calls every source in refresh mode so user-facing reads never wait on an API. */
export async function refreshAll(forecastLocations: string[]) {
  const [fx, idx, sum, now, fc, fxAll] = await Promise.allSettled([
    getFxRate('refresh'),
    getCsxIndex('refresh'),
    getCsxSummary('refresh'),
    refreshCurrentWeather(),
    getForecasts(forecastLocations, 'refresh'),
    getFxTable('refresh'),
  ]);
  const ok = (r: PromiseSettledResult<{ stale: boolean } | null>) => r.status === 'fulfilled' && !!r.value && !r.value.stale;
  const forecasts = fc.status === 'fulfilled' ? [...fc.value.values()].filter((c) => !c.stale).length : 0;
  return {
    fx: ok(fx),
    fxAllCurrencies: fxAll.status === 'fulfilled' && fxAll.value ? fxAll.value.data.rates.length : 0,
    csxIndex: ok(idx),
    csxSummary: ok(sum),
    currentWeatherProvinces: now.status === 'fulfilled' ? now.value : 0,
    forecasts: `${forecasts}/${forecastLocations.length}`,
  };
}
