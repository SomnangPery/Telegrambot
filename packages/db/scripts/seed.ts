/**
 * Seeds sample Battambang locations (if the tables are empty) and the demo officer account.
 * Usage: pnpm db:seed
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { sql as dsql } from 'drizzle-orm';
import { ROOT_DIR, communes, db, districts, officers, provinces, sql, villages } from '../src/index';

type Sample = {
  provinces: (typeof provinces.$inferInsert)[];
  districts: (typeof districts.$inferInsert)[];
  communes: (typeof communes.$inferInsert)[];
  villages: (typeof villages.$inferInsert)[];
};

async function main() {
  const [{ n }] = await db.select({ n: dsql<number>`count(*)::int` }).from(villages);
  // Real locations come from `pnpm db:import` (DataEF). Sample data only with --sample (offline).
  if (n === 0 && process.argv.includes('--sample')) {
    const sample: Sample = JSON.parse(
      readFileSync(join(ROOT_DIR, 'data', 'sample_locations.json'), 'utf8'),
    );
    await db.insert(provinces).values(sample.provinces).onConflictDoNothing();
    await db.insert(districts).values(sample.districts).onConflictDoNothing();
    await db.insert(communes).values(sample.communes).onConflictDoNothing();
    // Until the real weather mapping exists, each village is its own forecast location.
    await db
      .insert(villages)
      .values(sample.villages.map((v) => ({ ...v, forecastLocation: v.forecastLocation ?? v.code })))
      .onConflictDoNothing();
    console.log(`Seeded ${sample.villages.length} sample villages.`);
  } else if (n === 0) {
    console.error('No villages yet. Run `pnpm db:import` first (or `pnpm db:seed -- --sample` offline).');
    await sql.end();
    process.exit(1);
  }

  const email = process.env.SEED_OFFICER_EMAIL ?? 'officer@demo.kh';
  const password = process.env.SEED_OFFICER_PASSWORD ?? 'demo1234';
  // Default area: first commune of Battambang city (district 0203). Changeable in the dashboard.
  const [first] = await db
    .select({ code: communes.code })
    .from(communes)
    .where(dsql`${communes.code} like ${(process.env.SEED_OFFICER_COMMUNE ?? '0203') + '%'}`)
    .orderBy(communes.code)
    .limit(1);
  const communeCode = first?.code ?? null;
  await db
    .insert(officers)
    .values({
      email,
      passwordHash: await bcrypt.hash(password, 10),
      name: 'Demo commune officer',
      communeCode,
    })
    .onConflictDoUpdate({
      target: officers.email,
      set: { passwordHash: await bcrypt.hash(password, 10), communeCode },
    });
  console.log(`Officer account: ${email} (commune ${communeCode})`);

  // The single NGO partner account: the partnership dashboard for news & announcements.
  const accounts = [
    {
      email: process.env.SEED_PARTNER_EMAIL ?? 'ngo@demo.kh',
      name: 'Demo NGO staff',
      role: 'partner' as const,
      orgName: process.env.SEED_PARTNER_ORG ?? 'Demo Farmers NGO',
      orgNameKm: process.env.SEED_PARTNER_ORG_KM ?? 'អង្គការជំនួយកសិករ (សាកល្បង)',
      // "all" = every province in Cambodia; or a list of codes to restrict, e.g. "02,14" or "0203".
      areaCodes:
        (process.env.SEED_PARTNER_AREAS ?? 'all') === 'all'
          ? null
          : process.env.SEED_PARTNER_AREAS!.split(',').map((s) => s.trim()),
    },
  ];
  for (const a of accounts) {
    const passwordHash = await bcrypt.hash(password, 10);
    await db
      .insert(officers)
      .values({ ...a, passwordHash, communeCode })
      .onConflictDoUpdate({
        target: officers.email,
        set: { passwordHash, role: a.role, orgName: a.orgName, orgNameKm: a.orgNameKm, areaCodes: a.areaCodes },
      });
    console.log(`${a.role} account: ${a.email} (${a.orgName}, areas: ${a.areaCodes?.join(',') ?? 'all'})`);
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
