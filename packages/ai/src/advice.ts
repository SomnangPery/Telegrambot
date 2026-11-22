// Job A: advice writer. Code picks the approved rules from the forecast; the AI only rewords them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from '@sour/db/env';
import type { Forecast } from '@sour/dataef';
import { THRESHOLDS } from '@sour/dataef';
import { fmtHour } from '@sour/messages';
import { complete } from './client';

export type AdviceRule = { id: string; condition: string; km: string; en: string };

export const ADVICE_RULES: AdviceRule[] = JSON.parse(
  readFileSync(join(ROOT_DIR, 'data', 'advice_rules.json'), 'utf8'),
).rules;

const rule = (id: string) => ADVICE_RULES.find((r) => r.id === id)!;

/** Picks the matching approved rules for the next 24 h (plus dry-spell over all days). */
export function selectRules(forecast: Forecast[]): { rule: AdviceRule; hour?: number }[] {
  const d = forecast[0];
  if (!d) return [];
  const out: { rule: AdviceRule; hour?: number }[] = [];
  const stormy = d.condition === 'storm' || d.condition === 'thunderstorm' || (d.windKph ?? 0) >= 40;
  if (d.rainMm >= THRESHOLDS.urgentRainMm || d.condition === 'heavy_rain' || d.condition === 'thunderstorm')
    out.push({ rule: rule('heavy_rain') });
  if (stormy) out.push({ rule: rule('storm') });
  if (!out.length && d.rainMm > 0 && d.rainStartHour !== undefined && d.rainStartHour >= 9)
    out.push({ rule: rule('rain_after_hour'), hour: d.rainStartHour - 1 });
  if (d.tempMaxC >= THRESHOLDS.watchTempC) out.push({ rule: rule('heat') });
  if (!out.length && forecast.length >= 3 && forecast.every((f) => f.rainMm < 1))
    out.push({ rule: rule('dry_spell') });
  if (!out.length) out.push({ rule: rule('normal') });
  return out.slice(0, 2);
}

function fill(text: string, lang: string, hour?: number) {
  return hour === undefined ? text : text.replaceAll('{hour}', fmtHour(lang, hour));
}

/** Template-only advice (used when the AI is unavailable). */
export function templateAdvice(forecast: Forecast[], lang = 'km') {
  return selectRules(forecast)
    .map(({ rule, hour }) => fill(lang === 'en' ? rule.en : rule.km, lang, hour))
    .join(' ');
}

const ADVICE_SYSTEM = `You write farming advice for Cambodian rice farmers.
Write ONE or TWO short, plain sentences in the requested language.
Only reword the approved advice you are given; do not add new advice, numbers, products or dates.
Output only the advice text, no greeting, no emoji, no quotes.`;

/** One or two sentences of practical advice. Run once per village per run, reused for every user. */
export async function writeAdvice(forecast: Forecast[], lang = 'km'): Promise<string> {
  const picked = selectRules(forecast);
  if (!picked.length) return '';
  const fallback = templateAdvice(forecast, lang);
  const approved = picked.map(({ rule, hour }) => `- ${fill(lang === 'en' ? rule.en : rule.km, lang, hour)}`).join('\n');
  const ai = await complete(
    ADVICE_SYSTEM,
    `Language: ${lang === 'en' ? 'English' : 'Khmer'}\nForecast (next 24 h): ${JSON.stringify(forecast[0])}\nApproved advice:\n${approved}`,
    800,
  );
  // Guard: keep it short; fall back to the approved text if the model goes long.
  return ai && ai.length <= 400 ? ai : fallback;
}
