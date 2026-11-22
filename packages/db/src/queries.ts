import { and, asc, eq, ilike, inArray, or, sql as dsql } from 'drizzle-orm';
import { db } from './client';
import {
  communes,
  districts,
  provinces,
  subscriptions,
  TOPICS,
  users,
  villages,
  type Topic,
} from './schema';

export type User = typeof users.$inferSelect;
export type Village = typeof villages.$inferSelect;

// ---------- Locations ----------
export const listProvinces = () => db.select().from(provinces).orderBy(asc(provinces.nameEn));
export const listDistricts = (provinceCode: string) =>
  db
    .select()
    .from(districts)
    .where(eq(districts.provinceCode, provinceCode))
    .orderBy(asc(districts.nameEn));
export const listCommunes = (districtCode: string) =>
  db
    .select()
    .from(communes)
    .where(eq(communes.districtCode, districtCode))
    .orderBy(asc(communes.nameEn));
export const listVillages = (communeCode: string) =>
  db
    .select()
    .from(villages)
    .where(eq(villages.communeCode, communeCode))
    .orderBy(asc(villages.nameEn));

export async function getVillage(code: string) {
  const rows = await db
    .select({
      village: villages,
      commune: communes,
      district: districts,
      province: provinces,
    })
    .from(villages)
    .innerJoin(communes, eq(villages.communeCode, communes.code))
    .innerJoin(districts, eq(communes.districtCode, districts.code))
    .innerJoin(provinces, eq(districts.provinceCode, provinces.code))
    .where(eq(villages.code, code))
    .limit(1);
  return rows[0] ?? null;
}
export type VillageWithParents = NonNullable<Awaited<ReturnType<typeof getVillage>>>;

/** Find villages by Khmer or English name (for search-by-typing and the AI's find_village tool). */
export async function searchVillages(name: string, limit = 8) {
  const q = `%${name.trim()}%`;
  return db
    .select({
      code: villages.code,
      nameKm: villages.nameKm,
      nameEn: villages.nameEn,
      communeKm: communes.nameKm,
      communeEn: communes.nameEn,
      provinceKm: provinces.nameKm,
      provinceEn: provinces.nameEn,
    })
    .from(villages)
    .innerJoin(communes, eq(villages.communeCode, communes.code))
    .innerJoin(districts, eq(communes.districtCode, districts.code))
    .innerJoin(provinces, eq(districts.provinceCode, provinces.code))
    .where(or(ilike(villages.nameKm, q), ilike(villages.nameEn, q)))
    .orderBy(asc(villages.code))
    .limit(limit);
}

/**
 * Finds a place by name at any level. Villages first; otherwise a matching commune, district or
 * province, returned with one representative village (its first village) for weather lookups.
 */
export async function findPlace(name: string) {
  const clean = name
    .trim()
    .replace(/^(ខេត្ត|ស្រុក|ក្រុង|ខណ្ឌ|ឃុំ|សង្កាត់|ភូមិ|province|district|commune|village)\s*/i, '')
    .replace(/\s*(province|district|commune|village)$/i, '');
  const firstVillage = (prefix: string) =>
    db
      .select({ code: villages.code })
      .from(villages)
      .where(ilike(villages.code, `${prefix}%`))
      .orderBy(asc(villages.code))
      .limit(1)
      .then((r) => r[0]?.code ?? null);

  // 1. Exact name match, biggest area first ("Kampot" = the province, not a village "Tuol Kampot").
  const exactLevels = [
    { level: 'province' as const, table: provinces },
    { level: 'district' as const, table: districts },
    { level: 'commune' as const, table: communes },
  ];
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  for (const { level, table } of exactLevels) {
    const rows = await db
      .select({ code: table.code, nameKm: table.nameKm, nameEn: table.nameEn })
      .from(table)
      .where(
        or(
          dsql`lower(${table.nameKm}) = ${clean.toLowerCase()}`,
          dsql`replace(lower(${table.nameEn}), ' ', '') = ${squash(clean)}`,
          // Province list names like "រាជធានីភ្នំពេញ" still match "ភ្នំពេញ"
          ilike(table.nameKm, `%${clean}`),
        ),
      )
      .limit(3);
    if (rows.length)
      return Promise.all(rows.map(async (r) => ({ level, ...r, villageCode: await firstVillage(r.code) })));
  }

  // 2. Village names, then partial matches at the other levels.
  const villagesFound = await searchVillages(clean, 5);
  if (villagesFound.length) return villagesFound.map((v) => ({ level: 'village' as const, ...v }));
  const q = `%${clean}%`;
  const levels = [
    { level: 'commune' as const, table: communes },
    { level: 'district' as const, table: districts },
    { level: 'province' as const, table: provinces },
  ];
  for (const { level, table } of levels) {
    const rows = await db
      .select({ code: table.code, nameKm: table.nameKm, nameEn: table.nameEn })
      .from(table)
      .where(or(ilike(table.nameKm, q), ilike(table.nameEn, q), ilike(table.nameEn, q.replace(/\s+/g, ''))))
      .limit(5);
    if (rows.length)
      return Promise.all(rows.map(async (r) => ({ level, ...r, villageCode: await firstVillage(r.code) })));
  }
  return [];
}

// ---------- Users ----------
export async function getUserByTelegramId(telegramId: number) {
  const rows = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return rows[0] ?? null;
}

/** Creates the user (with default subscriptions: weather on, fx/csx off) or touches last_active_at. */
export async function upsertUser(telegramId: number) {
  const existing = await getUserByTelegramId(telegramId);
  if (existing) {
    await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, existing.id));
    return { user: existing, created: false };
  }
  const [user] = await db
    .insert(users)
    .values({ telegramId })
    .onConflictDoNothing()
    .returning();
  const u = user ?? (await getUserByTelegramId(telegramId))!;
  await db
    .insert(subscriptions)
    .values(TOPICS.map((topic) => ({ userId: u.id, topic, enabled: topic === 'weather' || topic === 'news' })))
    .onConflictDoNothing();
  return { user: u, created: true };
}

export async function updateUser(id: number, patch: Partial<Pick<User, 'language' | 'villageCode' | 'active'>>) {
  await db.update(users).set({ ...patch, lastActiveAt: new Date() }).where(eq(users.id, id));
}

export async function getTopics(userId: number): Promise<Record<Topic, boolean>> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  // 'news' is opt-out: users who never touched it still receive partner announcements.
  const out = { weather: false, fx: false, csx: false, news: true } as Record<Topic, boolean>;
  for (const r of rows) out[r.topic] = r.enabled;
  return out;
}

export async function setTopic(userId: number, topic: Topic, enabled: boolean) {
  await db
    .insert(subscriptions)
    .values({ userId, topic, enabled })
    .onConflictDoUpdate({
      target: [subscriptions.userId, subscriptions.topic],
      set: { enabled },
    });
}

/** Active users that have a village, with their enabled topics. */
export async function activeUsersWithTopics() {
  const rows = await db
    .select({ user: users, topic: subscriptions.topic, enabled: subscriptions.enabled })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(and(eq(users.active, true), dsql`${users.villageCode} is not null`));
  const map = new Map<number, { user: User; topics: Set<Topic> }>();
  for (const r of rows) {
    const e = map.get(r.user.id) ?? { user: r.user, topics: new Set<Topic>() };
    if (r.topic && r.enabled) e.topics.add(r.topic);
    map.set(r.user.id, e);
  }
  return [...map.values()];
}

/**
 * Farmers a partner announcement reaches: active users whose village code starts with one of the
 * given location prefixes ("02" province, "0203" district, "020301" commune, 8 digits = village)
 * and who have not turned off partner news.
 */
export function newsAudience(prefixes: string[]) {
  if (!prefixes.length) return Promise.resolve([] as User[]);
  const area = or(...prefixes.map((p) => ilike(users.villageCode, `${p}%`)));
  return db
    .select()
    .from(users)
    .where(
      and(
        eq(users.active, true),
        area,
        dsql`not exists (select 1 from ${subscriptions} s where s.user_id = ${users.id} and s.topic = 'news' and s.enabled = false)`,
      ),
    );
}

/** Active users in the given villages (officer send-to-all). */
export function activeUsersInVillages(codes: string[]) {
  if (codes.length === 0) return Promise.resolve([] as User[]);
  return db
    .select()
    .from(users)
    .where(and(eq(users.active, true), inArray(users.villageCode, codes)));
}

/** Subscriber counts per village. */
export async function subscriberCounts(codes?: string[]) {
  const rows = await db
    .select({ code: users.villageCode, n: dsql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.active, true),
        codes && codes.length ? inArray(users.villageCode, codes) : dsql`${users.villageCode} is not null`,
      ),
    )
    .groupBy(users.villageCode);
  return new Map(rows.map((r) => [r.code!, r.n]));
}
