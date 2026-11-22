import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// --- Locations (imported once from the Ministry of Planning / DataEF code lists) ---
export const provinces = pgTable('provinces', {
  code: text('code').primaryKey(),
  nameKm: text('name_km').notNull(),
  nameEn: text('name_en').notNull(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  // Province name as the DataEF weather API expects it (e.g. "Siem Reap", "Oddar Meanchey")
  weatherName: text('weather_name'),
});

export const districts = pgTable('districts', {
  code: text('code').primaryKey(),
  provinceCode: text('province_code')
    .notNull()
    .references(() => provinces.code),
  nameKm: text('name_km').notNull(),
  nameEn: text('name_en').notNull(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
});

export const communes = pgTable('communes', {
  code: text('code').primaryKey(),
  districtCode: text('district_code')
    .notNull()
    .references(() => districts.code),
  nameKm: text('name_km').notNull(),
  nameEn: text('name_en').notNull(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
});

export const villages = pgTable('villages', {
  code: text('code').primaryKey(),
  communeCode: text('commune_code')
    .notNull()
    .references(() => communes.code),
  nameKm: text('name_km').notNull(),
  nameEn: text('name_en').notNull(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  // Location code understood by the weather API (village -> nearest forecast point)
  forecastLocation: text('forecast_location'),
});

// --- Users and officers ---
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  language: text('language').notNull().default('km'),
  villageCode: text('village_code').references(() => villages.code),
  // false after /stop or when the user blocks the bot; the row is kept
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
});

// 'news' = announcements from partner organisations (NGOs etc.); on by default, farmers can opt out.
export const TOPICS = ['weather', 'fx', 'csx', 'news'] as const;
export type Topic = (typeof TOPICS)[number];

export const subscriptions = pgTable(
  'subscriptions',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topic: text('topic').$type<Topic>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    thresholdPct: real('threshold_pct'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.topic] })],
);

/**
 * Dashboard accounts.
 *  officer – commune agriculture officer: risk map + alerts to villages of their commune
 *  partner – NGO / donor / authority: news & announcements to the areas in area_codes
 *  admin   – platform admin: news to anywhere + everything officers can do
 */
export type DashboardRole = 'officer' | 'partner' | 'admin';

export const officers = pgTable('officers', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  communeCode: text('commune_code').references(() => communes.code),
  role: text('role').$type<DashboardRole>().notNull().default('officer'),
  // Organisation shown to farmers as the sender ("📢 សារពី …")
  orgName: text('org_name'),
  orgNameKm: text('org_name_km'),
  // Location code prefixes a partner may reach (e.g. ["02"] = Battambang). null = everywhere (admin).
  areaCodes: jsonb('area_codes').$type<string[]>(),
});

// --- Alerts and delivery ---
export type AlertType = 'brief' | 'weather_urgent' | 'fx' | 'csx' | 'officer' | 'news';

export const alerts = pgTable('alerts', {
  id: serial('id').primaryKey(),
  type: text('type').$type<AlertType>().notNull(),
  villageCode: text('village_code'),
  // Officer alerts can target several villages at once; news targets location code prefixes
  villageCodes: jsonb('village_codes').$type<string[]>(),
  officerId: integer('officer_id').references(() => officers.id),
  title: text('title'),
  textKm: text('text_km').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DeliveryStatus = 'sent' | 'failed' | 'blocked';

export const deliveries = pgTable(
  'deliveries',
  {
    alertId: integer('alert_id')
      .notNull()
      .references(() => alerts.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').$type<DeliveryStatus>().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    error: text('error'),
  },
  (t) => [primaryKey({ columns: [t.alertId, t.userId] })],
);

// De-duplicates urgent alerts. village_code is '*' for global kinds (fx, csx).
export const alertState = pgTable(
  'alert_state',
  {
    villageCode: text('village_code').notNull(),
    kind: text('kind').notNull(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.villageCode, t.kind] })],
);

export const apiCache = pgTable('api_cache', {
  key: text('key').primaryKey(),
  payload: jsonb('payload').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
