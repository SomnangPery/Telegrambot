import { assessRisk, getForecasts } from '@sour/dataef';
import { communes, db, subscriberCounts, villages } from '@sour/db';
import { eq } from 'drizzle-orm';

/** Villages of a commune with coordinates, 3-day risk and subscriber count (dashboard map). */
export async function villagesWithRisk(communeCode: string) {
  const rows = await db
    .select({ village: villages, commune: communes })
    .from(villages)
    .innerJoin(communes, eq(villages.communeCode, communes.code))
    .where(eq(villages.communeCode, communeCode));
  const counts = await subscriberCounts(rows.map((r) => r.village.code));
  // One batched forecast request for the whole commune.
  const forecasts = await getForecasts(rows.map((r) => r.village.forecastLocation ?? r.village.code));

  return rows.map(({ village, commune }) => {
    const fc = forecasts.get(village.forecastLocation ?? village.code);
    return {
      code: village.code,
      nameKm: village.nameKm,
      nameEn: village.nameEn,
      // Map fallback: commune centre point when the village has no coordinates
      lat: village.lat ?? commune.lat,
      lng: village.lng ?? commune.lng,
      approximateLocation: village.lat == null,
      subscribers: counts.get(village.code) ?? 0,
      risk: fc ? assessRisk(fc.data, 3) : null,
      forecastUpdatedAt: fc?.fetchedAt ?? null,
      forecastStale: fc?.stale ?? null,
    };
  });
}
