import { writeAdvice } from '@sour/ai';
import {
  assessRisk,
  cropPriceSourceLine,
  getAqi,
  getCropPrices,
  getCsxIndex,
  getCsxSummary,
  getCurrentWeather,
  getForecast,
  getFxRate,
  getFxTable,
  getUv,
} from '@sour/dataef';
import { getVillage, type Topic, type User } from '@sour/db';
import { detailedBrief, morningBrief } from '@sour/messages';

/** Memo so the AI writes advice once per village (and language) per run, not per user. */
export type AdviceMemo = Map<string, Promise<string>>;

/** A few reference crop prices relevant to the user's province (else the main paddy prices). */
function cropsFor(provinceEn: string) {
  const all = getCropPrices();
  const local = all.filter((c) => c.market.toLowerCase().includes(provinceEn.toLowerCase()));
  const paddy = all.filter((c) => c.category === 'paddy');
  return [...new Map([...local, ...paddy].map((c) => [c.id, c])).values()].slice(0, 4);
}

/** The detailed 6 AM brief with only the topics this user chose. */
export async function buildBrief(
  user: User,
  topics: Set<Topic> | Record<Topic, boolean>,
  memo: AdviceMemo = new Map(),
): Promise<string | null> {
  if (!user.villageCode) return null;
  const has = (t: Topic) => (topics instanceof Set ? topics.has(t) : topics[t]);
  const v = await getVillage(user.villageCode);
  if (!v) return null;
  const lang = user.language;
  const en = lang === 'en';
  const province = v.province.code;

  let weather: Parameters<typeof detailedBrief>[0]['weather'];
  if (has('weather')) {
    const forecast = await getForecast(v.village.forecastLocation ?? v.village.code);
    if (forecast?.data.length) {
      // After 6 PM (Cambodia time) the brief is about tomorrow, so advice and warnings are too.
      const hour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Phnom_Penh' }));
      const days = hour >= 18 && forecast.data.length > 1 ? forecast.data.slice(1) : forecast.data;
      const key = `${v.village.code}|${lang}|${days[0].date}`;
      if (!memo.has(key)) memo.set(key, writeAdvice(days, lang));
      const [now, aqi, uv, advice] = await Promise.all([
        getCurrentWeather(province),
        getAqi(province).catch(() => null),
        getUv(province).catch(() => null),
        memo.get(key)!,
      ]);
      const risk = assessRisk(days, 1);
      weather = {
        forecast,
        advice,
        risk: { level: risk.level, reasons: risk.reasons },
        now,
        aqi,
        uv,
        crops: { items: cropsFor(v.province.nameEn), sourceLine: cropPriceSourceLine(lang) },
      };
    } else {
      // No forecast at all: short brief with DataEF's current conditions instead.
      const now = (await getCurrentWeather(province)) ?? undefined;
      const fx = has('fx') ? ((await getFxRate()) ?? undefined) : undefined;
      const csx = has('csx') ? ((await getCsxIndex()) ?? undefined) : undefined;
      return morningBrief({
        lang,
        villageName: en ? v.village.nameEn : v.village.nameKm,
        provinceName: en ? v.province.nameEn : v.province.nameKm,
        now,
        fx,
        csx,
      });
    }
  }

  const fx = has('fx') ? await getFxTable() : null;
  const index = has('csx') ? await getCsxIndex() : null;
  const csx = index ? { index, summary: await getCsxSummary() } : null;

  return detailedBrief({
    lang,
    place: {
      village: en ? v.village.nameEn : v.village.nameKm,
      commune: en ? v.commune.nameEn : v.commune.nameKm,
      province: en ? v.province.nameEn : v.province.nameKm,
    },
    weather,
    fx,
    csx,
  });
}
