import cron from 'node-cron';
import { and, eq, isNotNull, sql as dsql } from 'drizzle-orm';
import { explainCsx, writeAdvice } from '@sour/ai';
import {
  assessRisk,
  getCsxIndex,
  getCsxSummary,
  getForecast,
  getFxRate,
  readCache,
  refreshAll,
  writeCache,
} from '@sour/dataef';
import {
  activeUsersWithTopics,
  alertState,
  db,
  getVillage,
  officers,
  subscriptions,
  users,
  villages,
} from '@sour/db';
import { csxBigMove, csxBrief, fxUpdate, urgentWeatherAlert } from '@sour/messages';
import { buildBrief, type AdviceMemo } from '../services/brief';
import { deliver, type Recipient } from '../services/delivery';

const TZ = 'Asia/Phnom_Penh';
const DEDUPE_MS = 6 * 60 * 60 * 1000; // same urgent alert at most once per 6 h

// ---------- helpers ----------
async function canSend(villageCode: string, kind: string, windowMs = DEDUPE_MS) {
  const [row] = await db
    .select()
    .from(alertState)
    .where(and(eq(alertState.villageCode, villageCode), eq(alertState.kind, kind)))
    .limit(1);
  return !row || Date.now() - row.lastSentAt.getTime() > windowMs;
}

async function markSent(villageCode: string, kind: string) {
  await db
    .insert(alertState)
    .values({ villageCode, kind, lastSentAt: new Date() })
    .onConflictDoUpdate({ target: [alertState.villageCode, alertState.kind], set: { lastSentAt: new Date() } });
}

/** Forecast locations worth refreshing: villages with users + villages in officers' communes. */
async function forecastLocations() {
  const rows = await db
    .selectDistinct({ loc: dsql<string>`coalesce(${villages.forecastLocation}, ${villages.code})` })
    .from(villages)
    .where(
      dsql`${villages.code} in (select ${users.villageCode} from ${users} where ${users.active})
        or ${villages.communeCode} in (select ${officers.communeCode} from ${officers} where ${officers.communeCode} is not null)`,
    );
  return rows.map((r) => r.loc);
}

// ---------- jobs ----------
export async function refreshCacheJob() {
  const res = await refreshAll(await forecastLocations());
  console.log(`[jobs] cache refresh: ${JSON.stringify(res)}`);
  return res;
}

/** 06:00 – each user gets only the topics they chose; advice written once per village. */
export async function morningBriefJob() {
  // Fetch fresh data first so the 6 AM brief always has today's numbers.
  await refreshCacheJob().catch((e) => console.warn('[jobs] pre-brief refresh failed:', (e as Error).message));
  const memo: AdviceMemo = new Map();
  const recipients: Recipient[] = [];
  for (const { user, topics } of await activeUsersWithTopics()) {
    if (!topics.size) continue;
    const text = await buildBrief(user, topics, memo);
    if (text) recipients.push({ user, text });
  }
  const res = await deliver('brief', recipients);
  console.log(`[jobs] morning brief: ${res.sent} sent, ${res.failed} failed, ${res.blocked} blocked`);
  return res;
}

/** Hourly – urgent weather alert per village when the next 24 h crosses a threshold. */
export async function weatherCheckJob() {
  const all = (await activeUsersWithTopics()).filter((u) => u.topics.has('weather'));
  const byVillage = new Map<string, typeof all>();
  for (const u of all) byVillage.set(u.user.villageCode!, [...(byVillage.get(u.user.villageCode!) ?? []), u]);
  let alertsSent = 0;
  for (const [code, members] of byVillage) {
    const v = await getVillage(code);
    if (!v) continue;
    const fc = await getForecast(v.village.forecastLocation ?? code);
    if (!fc?.data[0]) continue;
    const risk = assessRisk(fc.data, 1);
    if (risk.level !== 'urgent') continue;
    const kind = `weather:${risk.reasons.sort().join('+')}`;
    if (!(await canSend(code, kind))) continue;

    const advice = new Map<string, string>();
    const recipients: Recipient[] = [];
    for (const { user } of members) {
      const lang = user.language;
      if (!advice.has(lang)) advice.set(lang, await writeAdvice(fc.data, lang));
      const name = lang === 'en' ? v.village.nameEn : v.village.nameKm;
      recipients.push({ user, text: urgentWeatherAlert(lang, name, fc.data[0], risk.reasons, advice.get(lang)!) });
    }
    await deliver('weather_urgent', recipients, { villageCode: code });
    await markSent(code, kind);
    alertsSent++;
  }
  console.log(`[jobs] weather check: ${alertsSent} village alert(s)`);
  return { villages: byVillage.size, alertsSent };
}

const mid = (r: { usdKhrBuy: number; usdKhrSell: number }) => (r.usdKhrBuy + r.usdKhrSell) / 2;
const DEFAULT_FX_THRESHOLD_PCT = 0.5;

/**
 * Exchange rate (FR-8). daily=true (08:30): send the new NBC rate to every fx subscriber.
 * daily=false (hourly): send early only to users whose threshold the change crosses.
 */
export async function rateCheckJob(daily = true) {
  const fx = await getFxRate('refresh');
  if (!fx) return { sent: 0 };
  const last = await readCache<{ mid: number; date: string }>('fx:last_sent');
  const change = last ? (Math.abs(mid(fx.data) - last.data.mid) / last.data.mid) * 100 : 0;
  if (daily && last?.data.date === fx.data.date && change === 0) return { sent: 0 };

  const subs = (await activeUsersWithTopics()).filter((u) => u.topics.has('fx'));
  const thresholds = new Map(
    (
      await db
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.topic, 'fx'), isNotNull(subscriptions.thresholdPct)))
    ).map((s) => [s.userId, s.thresholdPct!]),
  );
  const recipients = subs
    .filter(({ user }) => daily || change >= (thresholds.get(user.id) ?? DEFAULT_FX_THRESHOLD_PCT))
    .map(({ user }) => ({ user, text: fxUpdate(user.language, fx, last?.data.mid) }));
  if (!recipients.length) return { sent: 0 };
  const res = await deliver('fx', recipients, { villageCodes: [] });
  await writeCache('fx:last_sent', { mid: mid(fx.data), date: fx.data.date }, 365 * 24 * 3600_000);
  console.log(`[jobs] rate check: ${res.sent} sent`);
  return res;
}

/** 16:00 on trading days – CSX brief, plus a big-move alert when the index moves > 2 %. */
export async function csxCheckJob() {
  const [idx, summary] = await Promise.all([getCsxIndex('refresh'), getCsxSummary('refresh')]);
  if (!idx) return { sent: 0 };
  const subs = (await activeUsersWithTopics()).filter((u) => u.topics.has('csx'));
  const explanations = new Map<string, string>();
  const recipients: Recipient[] = [];
  for (const { user } of subs) {
    const lang = user.language;
    if (!explanations.has(lang)) explanations.set(lang, await explainCsx(idx.data, summary?.data ?? null, lang));
    recipients.push({ user, text: csxBrief(lang, idx, summary, explanations.get(lang)) });
  }
  const res = await deliver('csx', recipients, { villageCodes: [] });

  if (Math.abs(idx.data.changePct) > 2 && (await canSend('*', 'csx_big', 20 * 3600_000))) {
    await deliver(
      'csx',
      subs.map(({ user }) => ({ user, text: csxBigMove(user.language, idx) })),
      { villageCodes: [] },
    );
    await markSent('*', 'csx_big');
  }
  console.log(`[jobs] CSX check: ${res.sent} sent`);
  return res;
}

export const JOBS = {
  refresh: refreshCacheJob,
  brief: morningBriefJob,
  weather: weatherCheckJob,
  rate: () => rateCheckJob(true),
  csx: csxCheckJob,
} as const;
export type JobName = keyof typeof JOBS;

/** Wraps a job so one failure never stops the scheduler. */
const safe = (name: string, fn: () => Promise<unknown>) => async () => {
  try {
    await fn();
  } catch (err) {
    console.error(`[jobs] ${name} failed:`, err);
  }
};

export function startScheduler() {
  cron.schedule('*/30 * * * *', safe('refresh', refreshCacheJob), { timezone: TZ });
  cron.schedule('0 6 * * *', safe('brief', morningBriefJob), { timezone: TZ });
  cron.schedule('5 * * * *', safe('weather', weatherCheckJob), { timezone: TZ });
  cron.schedule('30 8 * * *', safe('rate', () => rateCheckJob(true)), { timezone: TZ });
  cron.schedule('35 9-17 * * *', safe('rate-early', () => rateCheckJob(false)), { timezone: TZ });
  cron.schedule('0 16 * * 1-5', safe('csx', csxCheckJob), { timezone: TZ });
  console.log('[jobs] scheduler started (Asia/Phnom_Penh)');
  // Warm the cache at boot so the first reply never waits on an API.
  void safe('refresh', refreshCacheJob)();
}
