// Message templates. Rules (tech design §6.3): at most 6 lines, one emoji per line as a label,
// stale values show "updated HH:mm", CSX messages end with the not-investment-advice line.
import type { Cached, CsxIndex, CsxSummary, CurrentWeather, Forecast, FxRate, RiskReason } from '@sour/dataef';
import { biggestMoves } from '@sour/dataef';
import type { Lang } from './strings';

export * from './strings';
export * from './news';
export * from './brief';

const L = (lang: string): Lang => (lang === 'en' ? 'en' : 'km');

export const CONDITION: Record<Lang, Record<string, string>> = {
  km: {
    clear: 'មេឃស្រឡះ',
    cloudy: 'មានពពក',
    light_rain: 'ភ្លៀងតិចតួច',
    rain: 'ភ្លៀង',
    heavy_rain: 'ភ្លៀងខ្លាំង',
    thunderstorm: 'ភ្លៀងផ្គររន្ទះ',
    storm: 'ព្យុះ',
  },
  en: {
    clear: 'Clear sky',
    cloudy: 'Cloudy',
    light_rain: 'Light rain',
    rain: 'Rain',
    heavy_rain: 'Heavy rain',
    thunderstorm: 'Thunderstorm',
    storm: 'Storm',
  },
};

const REASON: Record<Lang, Record<RiskReason, string>> = {
  km: { heavy_rain: 'ភ្លៀងខ្លាំង', storm: 'ព្យុះ/ផ្គររន្ទះ', heat: 'កំដៅខ្លាំង', rain: 'ភ្លៀង', warm: 'ក្តៅ' },
  en: { heavy_rain: 'Heavy rain', storm: 'Storm / thunder', heat: 'Extreme heat', rain: 'Rain', warm: 'Hot' },
};
export const reasonText = (lang: string, r: RiskReason) => REASON[L(lang)][r];

export const NOT_ADVICE: Record<Lang, string> = {
  km: '⚠️ នេះមិនមែនជាដំបូន្មានវិនិយោគទេ។',
  en: '⚠️ This is not investment advice.',
};

export const fmtNum = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtTime = (d: Date) =>
  d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Phnom_Penh' });

export function fmtHour(lang: string, h: number) {
  if (L(lang) === 'en') return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
  const period = h < 11 ? 'ព្រឹក' : h < 13 ? 'ថ្ងៃត្រង់' : h < 18 ? 'រសៀល' : 'យប់';
  return `ម៉ោង ${h % 12 || 12} ${period}`;
}

const arrow = (pct: number) => (pct > 0 ? '▲' : pct < 0 ? '▼' : '•');
const pct = (p: number) => `${arrow(p)} ${fmtNum(Math.abs(p), 1)}%`;

/** " (updated 07:00)" when the value came from an expired cache entry. */
export function staleNote(lang: string, c: { fetchedAt: Date; stale: boolean }) {
  if (!c.stale) return '';
  return L(lang) === 'km' ? ` (ធ្វើបច្ចុប្បន្នភាព ${fmtTime(c.fetchedAt)})` : ` (updated ${fmtTime(c.fetchedAt)})`;
}

export function weatherLine(lang: string, f: Forecast) {
  const l = L(lang);
  const cond = CONDITION[l][f.condition] ?? f.condition;
  const mm = fmtNum(f.rainMm, f.rainMm < 10 ? 1 : 0);
  const rain = f.rainMm >= 0.5 ? (l === 'km' ? ` · ភ្លៀង ${mm} មម` : ` · rain ${mm} mm`) : '';
  const when =
    f.rainStartHour !== undefined && f.rainMm >= 0.5
      ? l === 'km'
        ? ` ចាប់ពី${fmtHour(lang, f.rainStartHour)}`
        : ` from ${fmtHour(lang, f.rainStartHour)}`
      : '';
  const emoji = f.rainMm >= 20 ? '🌧' : f.rainMm >= 0.5 ? '🌦' : f.tempMaxC >= 35 ? '🔥' : '🌤';
  return `${emoji} ${cond} · ${fmtNum(f.tempMaxC)}°C${rain}${when}`;
}

/** Current conditions line (DataEF, province level). */
export function currentLine(lang: string, now: Cached<CurrentWeather>) {
  const l = L(lang);
  const cond = CONDITION[l][now.data.condition] ?? now.data.conditionText;
  return l === 'km'
    ? `🌡 ឥឡូវនេះ៖ ${cond} · ${fmtNum(now.data.tempC)}°C${staleNote(lang, now)}`
    : `🌡 Now: ${cond} · ${fmtNum(now.data.tempC)}°C${staleNote(lang, now)}`;
}

export function fxLine(lang: string, fx: Cached<FxRate>) {
  const mid = Math.round((fx.data.usdKhrBuy + fx.data.usdKhrSell) / 2);
  return L(lang) === 'km'
    ? `💱 $1 = ${fmtNum(mid)} រៀល (អត្រាផ្លូវការ NBC)${staleNote(lang, fx)}`
    : `💱 $1 = ${fmtNum(mid)} riel (NBC official rate)${staleNote(lang, fx)}`;
}

export function csxLine(lang: string, idx: Cached<CsxIndex>) {
  const quiet = Math.abs(idx.data.changePct) < 0.5;
  const tail = quiet ? (L(lang) === 'km' ? ' – ថ្ងៃស្ងប់ស្ងាត់' : ' – a quiet day') : '';
  return `📈 CSX ${fmtNum(idx.data.value, 1)} (${pct(idx.data.changePct)})${tail}${staleNote(lang, idx)}`;
}

export type BriefInput = {
  lang: string;
  villageName: string;
  provinceName: string;
  weather?: { forecast: Cached<Forecast[]>; advice: string };
  /** Used only when no forecast is available. */
  now?: Cached<CurrentWeather>;
  fx?: Cached<FxRate>;
  csx?: Cached<CsxIndex>;
};

/** 6 AM morning brief with only the chosen sections. Returns null if every section is missing. */
export function morningBrief(b: BriefInput): string | null {
  const l = L(b.lang);
  const lines: string[] = [
    l === 'km'
      ? `☀️ អរុណសួស្តី – ភូមិ${b.villageName}, ${b.provinceName}`
      : `☀️ Good morning – ${b.villageName}, ${b.provinceName}`,
  ];
  const today = b.weather?.forecast.data[0];
  if (b.weather && today) {
    lines.push(weatherLine(b.lang, today) + staleNote(b.lang, b.weather.forecast));
    if (b.weather.advice) lines.push(`💡 ${b.weather.advice}`);
  } else if (b.now) {
    lines.push(currentLine(b.lang, b.now));
  }
  if (b.fx) lines.push(fxLine(b.lang, b.fx));
  if (b.csx) {
    lines.push(csxLine(b.lang, b.csx));
    lines.push(NOT_ADVICE[l]);
  }
  return lines.length > 1 ? lines.join('\n') : null;
}

export function urgentWeatherAlert(
  lang: string,
  villageName: string,
  f: Forecast,
  reasons: RiskReason[],
  advice: string,
) {
  const l = L(lang);
  const what = reasons.map((r) => reasonText(lang, r)).join(', ');
  return [
    l === 'km' ? `🚨 ការជូនដំណឹងបន្ទាន់ – ភូមិ${villageName}` : `🚨 Urgent alert – ${villageName}`,
    l === 'km' ? `⚠️ ${what} ក្នុង 24 ម៉ោងខាងមុខ` : `⚠️ ${what} in the next 24 hours`,
    weatherLine(lang, f),
    advice ? `💡 ${advice}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function fxUpdate(lang: string, fx: Cached<FxRate>, previousMid?: number) {
  const mid = (fx.data.usdKhrBuy + fx.data.usdKhrSell) / 2;
  const l = L(lang);
  const lines = [l === 'km' ? '💱 អត្រាប្តូរប្រាក់ថ្មីពី NBC' : '💱 New NBC exchange rate', fxLine(lang, fx)];
  if (previousMid) {
    const change = ((mid - previousMid) / previousMid) * 100;
    lines.push(l === 'km' ? `📊 ធៀបនឹងម្សិលមិញ៖ ${pct(change)}` : `📊 vs yesterday: ${pct(change)}`);
  }
  return lines.join('\n');
}

export function csxBrief(lang: string, idx: Cached<CsxIndex>, summary: Cached<CsxSummary> | null, explanation?: string) {
  const l = L(lang);
  const lines = [
    l === 'km'
      ? `📈 ផ្សារមូលបត្រកម្ពុជា (CSX) – សន្ទស្សន៍ ${fmtNum(idx.data.value, 1)} (${pct(idx.data.changePct)})`
      : `📈 Cambodia Securities Exchange – index ${fmtNum(idx.data.value, 1)} (${pct(idx.data.changePct)})`,
  ];
  const moves = summary ? biggestMoves(summary.data) : null;
  if (moves) {
    lines.push(
      l === 'km'
        ? `⬆️ ឡើងខ្លាំងជាងគេ៖ ${moves.up.ticker} ${pct(moves.up.changePct)}`
        : `⬆️ Biggest rise: ${moves.up.ticker} ${pct(moves.up.changePct)}`,
    );
    lines.push(
      l === 'km'
        ? `⬇️ ធ្លាក់ខ្លាំងជាងគេ៖ ${moves.down.ticker} ${pct(moves.down.changePct)}`
        : `⬇️ Biggest fall: ${moves.down.ticker} ${pct(moves.down.changePct)}`,
    );
  }
  if (explanation) lines.push(`💡 ${explanation}`);
  lines.push(NOT_ADVICE[l]);
  return lines.join('\n');
}

export function csxBigMove(lang: string, idx: Cached<CsxIndex>) {
  const l = L(lang);
  const dir = idx.data.changePct > 0 ? (l === 'km' ? 'ឡើង' : 'rose') : l === 'km' ? 'ធ្លាក់' : 'fell';
  return [
    l === 'km'
      ? `🔔 ជូនដំណឹង៖ សន្ទស្សន៍ CSX ${dir} ${fmtNum(Math.abs(idx.data.changePct), 1)}% ថ្ងៃនេះ`
      : `🔔 Alert: the CSX index ${dir} ${fmtNum(Math.abs(idx.data.changePct), 1)}% today`,
    l === 'km'
      ? '💡 ការប្រែប្រួលមួយថ្ងៃ មិនមានន័យថាក្រុមហ៊ុនខាត ឬចំណេញនោះទេ។ តម្លៃភាគហ៊ុនប្រែប្រួលជារៀងរាល់ថ្ងៃ។'
      : "💡 A one-day move doesn't mean the companies are losing or making money; prices move every day.",
    NOT_ADVICE[l],
  ].join('\n');
}

export function officerAlert(lang: string, text: string) {
  return L(lang) === 'km' ? `📢 សារពីមន្ត្រីកសិកម្មឃុំ\n${text}` : `📢 Message from your commune agriculture officer\n${text}`;
}
