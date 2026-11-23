// Detailed 6 AM morning brief: clear sections, only the topics the user chose.
// Every number comes from the data layer (DataEF / Open-Meteo / reference price list).
import type {
  AqiReading,
  Cached,
  CropPriceItem,
  CsxIndex,
  CsxSummary,
  CurrentWeather,
  Forecast,
  FxTable,
  RiskLevel,
  RiskReason,
  UvReading,
} from '@sour/dataef';
import { biggestMoves, formatAqi, formatRateLine, formatUv, MAIN_CURRENCIES } from '@sour/dataef';
import { CONDITION, fmtHour, fmtNum, NOT_ADVICE, reasonText, staleNote } from './index';

type Lang = 'km' | 'en';
const L = (lang: string): Lang => (lang === 'en' ? 'en' : 'km');

export type DetailedBriefInput = {
  lang: string;
  place: { village: string; commune: string; province: string };
  weather?: {
    forecast: Cached<Forecast[]>;
    advice: string;
    risk: { level: RiskLevel; reasons: RiskReason[] };
    now?: Cached<CurrentWeather> | null;
    aqi?: Cached<AqiReading> | null;
    uv?: Cached<UvReading> | null;
    crops?: { items: CropPriceItem[]; sourceLine: string };
  };
  fx?: Cached<FxTable> | null;
  csx?: { index: Cached<CsxIndex>; summary: Cached<CsxSummary> | null } | null;
};

const T = {
  km: {
    hello: '☀️ អរុណសួស្តី!',
    weatherToday: '🌦 អាកាសធាតុថ្ងៃនេះ',
    weatherTomorrow: '🌙 អាកាសធាតុថ្ងៃស្អែក',
    temp: 'សីតុណ្ហភាព',
    rain: 'ភ្លៀង',
    rainChance: 'ឱកាសភ្លៀង',
    from: 'ចាប់ពី',
    noRain: 'មិនមានភ្លៀងគួរឲ្យកត់សម្គាល់ទេ',
    wind: 'ខ្យល់',
    kmh: 'គ.ម/ម៉ោង',
    now: 'ឥឡូវនេះ',
    humidity: 'សំណើម',
    source: 'ប្រភព DataEF',
    outlook: '📆 ៣ ថ្ងៃខាងមុខ',
    today: 'ថ្ងៃនេះ',
    tomorrow: 'ថ្ងៃស្អែក',
    advice: '💡 ដំបូន្មានកសិកម្ម',
    warning: '⚠️ ប្រុងប្រយ័ត្ន',
    watch: '🟡 តាមដាន',
    crops: '🌾 តម្លៃកសិផលយោង',
    fx: '💱 អត្រាប្តូរប្រាក់ផ្លូវការ NBC',
    csx: '📈 ផ្សារមូលបត្រកម្ពុជា (CSX)',
    index: 'សន្ទស្សន៍',
    up: 'ឡើងខ្លាំងជាងគេ',
    down: 'ធ្លាក់ខ្លាំងជាងគេ',
    footer: '❓ សួរខ្ញុំបានគ្រប់ពេល ឬចុច /menu',
    mm: 'មម',
  },
  en: {
    hello: '☀️ Good morning!',
    weatherToday: '🌦 Weather today',
    weatherTomorrow: '🌙 Weather tomorrow',
    temp: 'Temperature',
    rain: 'Rain',
    rainChance: 'chance of rain',
    from: 'from',
    noRain: 'No significant rain expected',
    wind: 'Wind',
    kmh: 'km/h',
    now: 'Right now',
    humidity: 'humidity',
    source: 'source DataEF',
    outlook: '📆 Next 3 days',
    today: 'Today',
    tomorrow: 'Tomorrow',
    advice: '💡 Farming advice',
    warning: '⚠️ Warning',
    watch: '🟡 Watch',
    crops: '🌾 Reference crop prices',
    fx: '💱 NBC official exchange rates',
    csx: '📈 Cambodia Securities Exchange (CSX)',
    index: 'Index',
    up: 'Biggest rise',
    down: 'Biggest fall',
    footer: '❓ Ask me anything any time, or tap /menu',
    mm: 'mm',
  },
} as const;

const dayName = (date: string, lang: string) =>
  new Date(`${date}T00:00:00+07:00`).toLocaleDateString(lang === 'en' ? 'en-GB' : 'km-KH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Phnom_Penh',
  });

const arrow = (p: number) => (p > 0 ? '▲' : p < 0 ? '▼' : '•');
const pct = (p: number) => `${arrow(p)} ${fmtNum(Math.abs(p), 2)}%`;
const mm = (n: number) => fmtNum(n, n < 10 ? 1 : 0);

const localHour = (d: Date) =>
  Number(d.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Phnom_Penh' }));

/** Greeting for the time of day in Cambodia. */
export function greeting(lang: string, hour: number) {
  const km = lang !== 'en';
  if (hour >= 4 && hour < 11) return km ? '☀️ អរុណសួស្តី!' : '☀️ Good morning!';
  if (hour >= 11 && hour < 17) return km ? '🌤 ទិវាសួស្តី!' : '🌤 Good afternoon!';
  if (hour >= 17 && hour < 21) return km ? '🌇 សាយណ្ហសួស្តី!' : '🌇 Good evening!';
  return km ? '🌙 រាត្រីសួស្តី!' : '🌙 Good night!';
}

export function detailedBrief(b: DetailedBriefInput): string | null {
  const l = L(b.lang);
  const t = T[l];
  const sections: string[][] = [];

  // Header: greeting for the time of day, place, date + current time (Asia/Phnom_Penh)
  const now = new Date();
  const hour = localHour(now);
  const evening = hour >= 18; // after 6 PM the useful forecast is tomorrow's
  const todayDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' });
  const clock = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Phnom_Penh' });
  sections.push([
    greeting(l, hour),
    l === 'km'
      ? `📍 ភូមិ${b.place.village} · ឃុំ/សង្កាត់${b.place.commune} · ${b.place.province}`
      : `📍 ${b.place.village}, ${b.place.commune}, ${b.place.province}`,
    `📅 ${dayName(todayDate, b.lang)} · 🕘 ${clock}`,
  ]);

  // Main weather section: today, or tomorrow in the evening
  const w = b.weather;
  const today = w?.forecast.data[evening && w.forecast.data[1] ? 1 : 0];
  if (w && today) {
    const title = evening && today !== w.forecast.data[0] ? t.weatherTomorrow : t.weatherToday;
    const lines = [`${title}${staleNote(b.lang, w.forecast)}`];
    lines.push(`• ${CONDITION[l][today.condition] ?? today.condition}`);
    lines.push(
      `• ${t.temp}: ${fmtNum(today.tempMinC ?? today.tempMaxC)}–${fmtNum(today.tempMaxC)}°C`,
    );
    if (today.rainMm >= 0.5) {
      const when = today.rainStartHour !== undefined ? ` · ${t.from} ${fmtHour(b.lang, today.rainStartHour)}` : '';
      lines.push(`• ${t.rain}: ${mm(today.rainMm)} ${t.mm} · ${t.rainChance} ${today.rainChancePct ?? 0}%${when}`);
    } else {
      lines.push(`• ${t.noRain} (${t.rainChance} ${today.rainChancePct ?? 0}%)`);
    }
    if (today.windKph !== undefined && Number.isFinite(today.windKph))
      lines.push(`• ${t.wind}: ${fmtNum(today.windKph)} ${t.kmh}`);
    if (w.now) {
      const n = w.now.data;
      const hum = n.humidity !== undefined && Number.isFinite(n.humidity) ? ` · ${t.humidity} ${fmtNum(n.humidity)}%` : '';
      lines.push(`• ${t.now}: ${CONDITION[l][n.condition] ?? n.conditionText}, ${fmtNum(n.tempC)}°C${hum} (${t.source})`);
    }
    if (w.aqi) lines.push(`• ${formatAqi(w.aqi.data, b.lang)}`);
    // UV is a live reading (≈0 at 6 AM), so only show it when it's meaningful.
    if (w.uv && w.uv.data.uvIndex >= 3) lines.push(`• ${formatUv(w.uv.data, b.lang)}`);
    if (w.risk.level !== 'normal') {
      const label = w.risk.level === 'urgent' ? t.warning : t.watch;
      lines.push(`${label}: ${w.risk.reasons.map((r) => reasonText(b.lang, r)).join(', ')}`);
    }
    sections.push(lines);

    // 3-day outlook
    const days = w.forecast.data.slice(0, 3);
    if (days.length > 1) {
      sections.push([
        t.outlook,
        ...days.map((d, i) => {
          const name = i === 0 ? t.today : i === 1 ? t.tomorrow : dayName(d.date, b.lang).split(' ')[0];
          const rain = d.rainMm >= 0.5 ? ` · ${t.rain} ${mm(d.rainMm)} ${t.mm}` : '';
          return `• ${name}: ${CONDITION[l][d.condition] ?? d.condition} · ${fmtNum(d.tempMinC ?? d.tempMaxC)}–${fmtNum(d.tempMaxC)}°C${rain}`;
        }),
      ]);
    }

    if (w.advice) sections.push([t.advice, w.advice]);

    if (w.crops?.items.length) {
      sections.push([
        t.crops,
        ...w.crops.items.map((c) => {
          const unit = l === 'en' ? c.unit : c.unit === 'kg' ? 'គ.ក្រ' : c.unit;
          const riel = l === 'en' ? 'riel' : 'រៀល';
          return `• ${l === 'en' ? c.nameEn : c.nameKm}: ${fmtNum(c.priceMin)}–${fmtNum(c.priceMax)} ${riel}/${unit}`;
        }),
        w.crops.sourceLine,
      ]);
    }
  }

  // Exchange rates
  if (b.fx) {
    const rows = MAIN_CURRENCIES.map((c) => b.fx!.data.rates.find((r) => r.code === c)).filter(
      (r): r is NonNullable<typeof r> => !!r,
    );
    if (rows.length) sections.push([`${t.fx}${staleNote(b.lang, b.fx)}`, ...rows.map((r) => formatRateLine(r, b.lang))]);
  }

  // Stock market
  if (b.csx) {
    const i = b.csx.index.data;
    const lines = [`${t.csx}${staleNote(b.lang, b.csx.index)}`, `• ${t.index}: ${fmtNum(i.value, 2)} (${pct(i.changePct)})`];
    const moves = b.csx.summary ? biggestMoves(b.csx.summary.data) : null;
    if (moves) {
      lines.push(`• ${t.up}: ${moves.up.ticker} ${pct(moves.up.changePct)} (${fmtNum(moves.up.close)} ${l === 'en' ? 'riel' : 'រៀល'})`);
      lines.push(`• ${t.down}: ${moves.down.ticker} ${pct(moves.down.changePct)} (${fmtNum(moves.down.close)} ${l === 'en' ? 'riel' : 'រៀល'})`);
    }
    lines.push(NOT_ADVICE[l]);
    sections.push(lines);
  }

  if (sections.length === 1) return null; // only the header: nothing to send
  sections.push([t.footer]);
  return sections.map((s) => s.join('\n')).join('\n\n');
}
