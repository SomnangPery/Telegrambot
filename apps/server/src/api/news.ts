// News & announcements from partner organisations (NGOs, donors, authorities) and admins.
// Partners can only reach the areas in their account (area_codes); admins can reach everywhere.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, gte, inArray, sql as dsql } from 'drizzle-orm';
import {
  alerts,
  communes,
  db,
  deliveries,
  districts,
  newsAudience,
  officers,
  provinces,
  villages,
} from '@sour/db';
import { newsMessage } from '@sour/messages';
import { deliver } from '../services/delivery';

const WEEKLY_LIMIT = Number(process.env.NEWS_WEEKLY_LIMIT ?? 10); // per partner; admins unlimited
const MAX_TITLE = 120;
const MAX_TEXT = 2000;

async function account(id: number) {
  const [o] = await db.select().from(officers).where(eq(officers.id, id)).limit(1);
  return o;
}
type Account = Awaited<ReturnType<typeof account>>;

// Announcements come only from the NGO partner dashboard.
const canSendNews = (a: Account) => a?.role === 'partner';

/** Is `code` inside one of the account's allowed prefixes? (admin / null = everywhere) */
const allowed = (a: Account, code: string) => !a.areaCodes || a.areaCodes.some((p) => code.startsWith(p));

/** Human names for location prefixes: "02" → Battambang, "0203" → Battambang City, Battambang … */
async function describe(codes: string[]) {
  const by = (len: number) => codes.filter((c) => c.length === len);
  const [p, d, c, v] = await Promise.all([
    by(2).length ? db.select().from(provinces).where(inArray(provinces.code, by(2))) : [],
    by(4).length ? db.select().from(districts).where(inArray(districts.code, by(4))) : [],
    by(6).length ? db.select().from(communes).where(inArray(communes.code, by(6))) : [],
    by(8).length ? db.select().from(villages).where(inArray(villages.code, by(8))) : [],
  ]);
  const names = new Map<string, { nameKm: string; nameEn: string; level: string }>();
  for (const r of p) names.set(r.code, { nameKm: r.nameKm, nameEn: r.nameEn, level: 'province' });
  for (const r of d) names.set(r.code, { nameKm: r.nameKm, nameEn: r.nameEn, level: 'district' });
  for (const r of c) names.set(r.code, { nameKm: r.nameKm, nameEn: r.nameEn, level: 'commune' });
  for (const r of v) names.set(r.code, { nameKm: r.nameKm, nameEn: r.nameEn, level: 'village' });
  return codes.map((code) => ({ code, ...(names.get(code) ?? { nameKm: code, nameEn: code, level: 'unknown' }) }));
}

/** Validates requested area prefixes against the account. Returns an error message or the clean list. */
async function checkAreas(a: Account, areas: unknown): Promise<string[] | string> {
  if (!Array.isArray(areas) || !areas.length) return 'choose at least one area';
  const clean = [...new Set(areas.map(String).filter((s) => /^\d{2}(\d{2}){0,3}$/.test(s)))];
  if (!clean.length) return 'invalid area codes';
  const outside = clean.filter((c) => !allowed(a, c));
  if (outside.length) return `not allowed to send to: ${outside.join(', ')}`;
  const known = await describe(clean);
  const unknown = known.filter((k) => k.level === 'unknown');
  if (unknown.length) return `unknown area: ${unknown.map((u) => u.code).join(', ')}`;
  return clean;
}

async function sentThisWeek(id: number) {
  const [{ n }] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(alerts)
    .where(and(eq(alerts.officerId, id), eq(alerts.type, 'news'), gte(alerts.createdAt, new Date(Date.now() - 7 * 86_400_000))));
  return n;
}

export async function registerNewsApi(api: FastifyInstance) {
  // Only partner/admin accounts may use these routes.
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    const a = await account(req.user.id);
    if (!canSendNews(a)) return reply.code(403).send({ error: 'news is sent from the NGO partner dashboard' });
    return a;
  };

  /** The account's allowed areas (for the area picker) and remaining sends this week. */
  api.get('/api/news/areas', async (req, reply) => {
    const a = await guard(req, reply);
    if (!a || reply.sent) return;
    const used = await sentThisWeek(a.id);
    return {
      everywhere: !a.areaCodes,
      areas: a.areaCodes ? await describe(a.areaCodes) : [],
      weeklyLimit: a.role === 'admin' ? null : WEEKLY_LIMIT,
      sentThisWeek: used,
    };
  });

  /** How many farmers a post would reach (active, in the areas, partner news not turned off). */
  api.post<{ Body: { areas: string[] } }>('/api/news/preview', async (req, reply) => {
    const a = await guard(req, reply);
    if (!a || reply.sent) return;
    const areas = await checkAreas(a, req.body?.areas);
    if (typeof areas === 'string') return reply.code(400).send({ error: areas });
    return { recipients: (await newsAudience(areas)).length, areas: await describe(areas) };
  });

  api.post<{ Body: { areas: string[]; title?: string; text: string } }>('/api/news/send', async (req, reply) => {
    const a = await guard(req, reply);
    if (!a || reply.sent) return;
    const title = String(req.body?.title ?? '').trim().slice(0, MAX_TITLE);
    const text = String(req.body?.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'message is empty' });
    if (text.length > MAX_TEXT) return reply.code(400).send({ error: `message is longer than ${MAX_TEXT} characters` });
    const areas = await checkAreas(a, req.body?.areas);
    if (typeof areas === 'string') return reply.code(400).send({ error: areas });
    if (a.role !== 'admin' && (await sentThisWeek(a.id)) >= WEEKLY_LIMIT)
      return reply.code(429).send({ error: `weekly limit of ${WEEKLY_LIMIT} announcements reached` });

    const sender = { orgName: a.orgName ?? a.name, orgNameKm: a.orgNameKm };
    const recipients = (await newsAudience(areas)).map((user) => ({
      user,
      text: newsMessage(user.language, sender, title, text),
    }));
    const result = await deliver('news', recipients, {
      villageCodes: areas,
      officerId: a.id,
      record: { title, textKm: text },
    });
    // Keep a record even when nobody is registered in the area yet.
    if (!recipients.length)
      await db.insert(alerts).values({ type: 'news', title, textKm: text, villageCodes: areas, officerId: a.id });
    return { recipients: recipients.length, sent: result.sent, failed: result.failed, blocked: result.blocked };
  });

  /** Past announcements with reach (partners see their own; admins see all). */
  api.get('/api/news', async (req, reply) => {
    const a = await guard(req, reply);
    if (!a || reply.sent) return;
    const rows = await db
      .select({
        id: alerts.id,
        title: alerts.title,
        text: alerts.textKm,
        areas: alerts.villageCodes,
        createdAt: alerts.createdAt,
        sender: officers.orgName,
        sent: dsql<number>`count(${deliveries.userId}) filter (where ${deliveries.status} = 'sent')::int`,
        failed: dsql<number>`count(${deliveries.userId}) filter (where ${deliveries.status} = 'failed')::int`,
        blocked: dsql<number>`count(${deliveries.userId}) filter (where ${deliveries.status} = 'blocked')::int`,
      })
      .from(alerts)
      .leftJoin(deliveries, eq(deliveries.alertId, alerts.id))
      .leftJoin(officers, eq(officers.id, alerts.officerId))
      .where(a.role === 'admin' ? eq(alerts.type, 'news') : and(eq(alerts.type, 'news'), eq(alerts.officerId, a.id)))
      .groupBy(alerts.id, officers.orgName)
      .orderBy(desc(alerts.createdAt))
      .limit(100);
    const names = await describe([...new Set(rows.flatMap((r) => r.areas ?? []))]);
    const byCode = new Map(names.map((n) => [n.code, n]));
    return rows.map((r) => ({ ...r, areas: (r.areas ?? []).map((c) => byCode.get(c) ?? { code: c, nameKm: c, nameEn: c }) }));
  });
}
