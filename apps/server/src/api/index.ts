import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { desc, eq, inArray, sql as dsql } from 'drizzle-orm';
import { draftOfficerAlert } from '@sour/ai';
import { assessRisk, getCurrentWeather, getForecast } from '@sour/dataef';
import {
  activeUsersInVillages,
  alerts,
  communes,
  db,
  deliveries,
  districts,
  getVillage,
  listCommunes,
  listDistricts,
  listProvinces,
  officers,
  provinces,
  villages,
} from '@sour/db';
import { officerAlert } from '@sour/messages';
import { deliver } from '../services/delivery';
import { registerNewsApi } from './news';
import { villagesWithRisk } from '../services/risk';
import { JOBS, type JobName } from '../jobs';

type Officer = { id: number; email: string; communeCode: string | null };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Officer;
    user: Officer;
  }
}

async function auth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'unauthorized' });
  }
}

async function officerRow(id: number) {
  const [o] = await db.select().from(officers).where(eq(officers.id, id)).limit(1);
  return o;
}

/** Officers may only target villages in their own commune (when they have one). */
async function allowedVillages(officer: Officer, codes: string[]) {
  if (!codes.length) return [];
  const { communeCode } = await officerRow(officer.id);
  const rows = await db.select().from(villages).where(inArray(villages.code, codes));
  return rows.filter((v) => !communeCode || v.communeCode === communeCode);
}

async function officerJson(id: number) {
  const o = await officerRow(id);
  const area = o.communeCode
    ? await db
        .select({ commune: communes, district: districts, province: provinces })
        .from(communes)
        .innerJoin(districts, eq(communes.districtCode, districts.code))
        .innerJoin(provinces, eq(districts.provinceCode, provinces.code))
        .where(eq(communes.code, o.communeCode))
        .limit(1)
    : [];
  return {
    id: o.id,
    email: o.email,
    name: o.name,
    communeCode: o.communeCode,
    area: area[0] ?? null,
    role: o.role,
    orgName: o.orgName,
    orgNameKm: o.orgNameKm,
  };
}

export async function registerApi(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true }));

  app.post<{ Body: { email: string; password: string } }>('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body ?? ({} as { email: string; password: string });
    const [o] = await db.select().from(officers).where(eq(officers.email, String(email).toLowerCase())).limit(1);
    if (!o || !(await bcrypt.compare(String(password), o.passwordHash)))
      return reply.code(401).send({ error: 'Wrong email or password' });
    const token = app.jwt.sign({ id: o.id, email: o.email, communeCode: o.communeCode }, { expiresIn: '12h' });
    return { token, officer: await officerJson(o.id) };
  });

  // Demo mode: one-click sign-in as a role, no password (DEMO_MODE=true in .env). Never for production.
  const demoMode = () => (process.env.DEMO_MODE ?? 'false').toLowerCase() === 'true';
  app.get('/api/auth/demo', async () => ({ enabled: demoMode() }));
  app.post<{ Body: { role: string } }>('/api/auth/demo', async (req, reply) => {
    if (!demoMode()) return reply.code(404).send({ error: 'demo mode is off' });
    const role = req.body?.role === 'partner' ? 'partner' : 'officer';
    const [o] = await db.select().from(officers).where(eq(officers.role, role)).orderBy(officers.id).limit(1);
    if (!o) return reply.code(404).send({ error: `no ${role} account – run pnpm db:seed` });
    const token = app.jwt.sign({ id: o.id, email: o.email, communeCode: o.communeCode }, { expiresIn: '12h' });
    return { token, officer: await officerJson(o.id) };
  });

  // Everything else under /api needs a valid JWT.
  app.register(async (api) => {
    api.addHook('preHandler', auth);
    await registerNewsApi(api);

    // Commune alerts are for officers and admins; partners use the news routes instead.
    api.addHook('preHandler', async (req, reply) => {
      if (!/^\/api\/alerts\/(draft|send)/.test(req.url)) return;
      const [o] = await db.select({ role: officers.role }).from(officers).where(eq(officers.id, req.user.id)).limit(1);
      if (o?.role === 'partner') return reply.code(403).send({ error: 'partner accounts send news, not commune alerts' });
    });

    api.get('/api/me', async (req) => officerJson(req.user.id));

    // The officer's area (commune). Any commune in Cambodia can be chosen.
    api.put<{ Body: { communeCode: string } }>('/api/me', async (req, reply) => {
      const code = String(req.body?.communeCode ?? '');
      const [c] = await db.select().from(communes).where(eq(communes.code, code)).limit(1);
      if (!c) return reply.code(400).send({ error: 'unknown commune' });
      await db.update(officers).set({ communeCode: code }).where(eq(officers.id, req.user.id));
      return officerJson(req.user.id);
    });

    api.get('/api/locations/provinces', async () => listProvinces());
    api.get<{ Querystring: { province: string } }>('/api/locations/districts', async (req) =>
      listDistricts(String(req.query.province ?? '')),
    );
    api.get<{ Querystring: { district: string } }>('/api/locations/communes', async (req) =>
      listCommunes(String(req.query.district ?? '')),
    );

    api.get<{ Querystring: { commune?: string } }>('/api/villages', async (req, reply) => {
      const commune = req.query.commune ?? (await officerRow(req.user.id)).communeCode;
      if (!commune) return reply.code(400).send({ error: 'commune is required' });
      return villagesWithRisk(commune);
    });

    api.get<{ Params: { code: string } }>('/api/villages/:code/forecast', async (req, reply) => {
      const v = await getVillage(req.params.code);
      if (!v) return reply.code(404).send({ error: 'village not found' });
      const [fc, now] = await Promise.all([
        getForecast(v.village.forecastLocation ?? v.village.code),
        getCurrentWeather(v.province.code),
      ]);
      if (!fc) return reply.code(503).send({ error: 'forecast not available' });
      return {
        village: v.village,
        commune: v.commune,
        province: v.province,
        forecast: fc.data.slice(0, 3),
        risk: assessRisk(fc.data, 3),
        fetchedAt: fc.fetchedAt,
        stale: fc.stale,
        now: now ? { ...now.data, stale: now.stale } : null,
      };
    });

    api.post<{ Body: { villageCodes: string[] } }>('/api/alerts/draft', async (req, reply) => {
      const chosen = await allowedVillages(req.user, req.body?.villageCodes ?? []);
      if (!chosen.length) return reply.code(400).send({ error: 'choose at least one village' });
      const withForecast = await Promise.all(
        chosen.map(async (v) => {
          const fc = await getForecast(v.forecastLocation ?? v.code);
          const risk = fc ? assessRisk(fc.data, 1) : { level: 'normal' as const, reasons: [] };
          return { nameKm: v.nameKm, forecast: fc?.data ?? [], level: risk.level, reasons: risk.reasons };
        }),
      );
      return { text: await draftOfficerAlert(withForecast) };
    });

    api.post<{ Body: { villageCodes: string[]; text: string; preview?: boolean } }>(
      '/api/alerts/send',
      async (req, reply) => {
        const text = String(req.body?.text ?? '').trim();
        if (!text) return reply.code(400).send({ error: 'message is empty' });
        if (text.length > 3500) return reply.code(400).send({ error: 'message is too long' });
        const chosen = await allowedVillages(req.user, req.body?.villageCodes ?? []);
        if (!chosen.length) return reply.code(400).send({ error: 'choose at least one village' });
        const codes = chosen.map((v) => v.code);
        const recipients = await activeUsersInVillages(codes);
        if (req.body.preview) return { recipients: recipients.length };

        const result = await deliver(
          'officer',
          recipients.map((user) => ({ user, text: officerAlert(user.language, text) })),
          { villageCodes: codes, officerId: req.user.id },
        );
        // Record the officer's own text even when nobody is registered yet.
        if (!recipients.length)
          await db.insert(alerts).values({ type: 'officer', textKm: text, villageCodes: codes, officerId: req.user.id });
        return { recipients: recipients.length, ...result };
      },
    );

    api.get('/api/alerts', async () => {
      const rows = await db
        .select({
          id: alerts.id,
          type: alerts.type,
          textKm: alerts.textKm,
          villageCode: alerts.villageCode,
          villageCodes: alerts.villageCodes,
          officerId: alerts.officerId,
          createdAt: alerts.createdAt,
          sent: dsql<number>`count(*) filter (where ${deliveries.status} = 'sent')::int`,
          failed: dsql<number>`count(*) filter (where ${deliveries.status} = 'failed')::int`,
          blocked: dsql<number>`count(*) filter (where ${deliveries.status} = 'blocked')::int`,
        })
        .from(alerts)
        .leftJoin(deliveries, eq(deliveries.alertId, alerts.id))
        .groupBy(alerts.id)
        .orderBy(desc(alerts.createdAt))
        .limit(100);
      return rows;
    });

    // Demo helper: run a scheduled job now (e.g. trigger the morning brief on stage).
    api.post<{ Params: { name: string } }>('/api/jobs/:name/run', async (req, reply) => {
      const job = JOBS[req.params.name as JobName];
      if (!job) return reply.code(404).send({ error: `unknown job; use one of ${Object.keys(JOBS).join(', ')}` });
      return job();
    });
  });
}
