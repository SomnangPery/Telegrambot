import type { Forecast } from './types';

export type RiskLevel = 'urgent' | 'watch' | 'normal';
export type RiskReason = 'heavy_rain' | 'storm' | 'heat' | 'rain' | 'warm';

// Starting thresholds from the technical design (to confirm with MOWRAM's warning levels).
export const THRESHOLDS = {
  urgentRainMm: 50,
  watchRainMm: 20,
  urgentTempC: 38,
  watchTempC: 35,
};

export function dayRisk(f: Forecast): { level: RiskLevel; reasons: RiskReason[] } {
  const reasons: RiskReason[] = [];
  let level: RiskLevel = 'normal';
  const isStorm = f.condition === 'storm' || f.condition === 'thunderstorm';
  if (f.rainMm >= THRESHOLDS.urgentRainMm || f.condition === 'heavy_rain') reasons.push('heavy_rain');
  if (isStorm) reasons.push('storm');
  if (f.tempMaxC >= THRESHOLDS.urgentTempC) reasons.push('heat');
  if (reasons.length) level = 'urgent';
  else {
    if (f.rainMm >= THRESHOLDS.watchRainMm || f.condition === 'rain') reasons.push('rain');
    if (f.tempMaxC >= THRESHOLDS.watchTempC) reasons.push('warm');
    if (reasons.length) level = 'watch';
  }
  return { level, reasons };
}

const rank: Record<RiskLevel, number> = { normal: 0, watch: 1, urgent: 2 };

/** Worst level over the first `days` forecast days (1 = next 24 h, 3 = map view). */
export function assessRisk(forecast: Forecast[], days = 1) {
  const perDay = forecast.slice(0, days).map((f) => ({ date: f.date, ...dayRisk(f) }));
  let level: RiskLevel = 'normal';
  const reasons = new Set<RiskReason>();
  for (const d of perDay) {
    if (rank[d.level] > rank[level]) level = d.level;
    d.reasons.forEach((r) => reasons.add(r));
  }
  return { level, reasons: [...reasons], perDay };
}

export const RISK_COLOUR: Record<RiskLevel, string> = { urgent: 'red', watch: 'yellow', normal: 'green' };
