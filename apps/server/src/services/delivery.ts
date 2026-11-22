import { GrammyError, type Bot } from 'grammy';
import {
  alerts,
  db,
  deliveries,
  updateUser,
  type AlertType,
  type DeliveryStatus,
  type User,
} from '@sour/db';

const BATCH = 25; // Telegram: stay at or under ~25 messages per second
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Recipient = { user: User; text: string };

let botRef: Bot | null = null;
export const setDeliveryBot = (bot: Bot | null) => (botRef = bot);

/**
 * Sends each recipient its text, in batches of 25 per second, and records an `alerts` row per
 * distinct text plus a `deliveries` row per user. Returns sent / failed / blocked counts.
 */
export async function deliver(
  type: AlertType,
  recipients: Recipient[],
  opts: {
    villageCode?: string | null;
    villageCodes?: string[];
    officerId?: number;
    /** Record ONE alerts row (this title/text) for every recipient, e.g. a news post sent in 2 languages. */
    record?: { title?: string; textKm: string };
  } = {},
) {
  const counts = { sent: 0, failed: 0, blocked: 0, alertIds: [] as number[] };
  if (!recipients.length) return counts;

  const alertIdByText = new Map<string, number>();
  if (opts.record) {
    const [row] = await db
      .insert(alerts)
      .values({
        type,
        title: opts.record.title,
        textKm: opts.record.textKm,
        villageCodes: opts.villageCodes ?? null,
        officerId: opts.officerId,
      })
      .returning({ id: alerts.id });
    for (const r of recipients) alertIdByText.set(r.text, row.id);
    counts.alertIds.push(row.id);
  }

  // Otherwise one alerts row per distinct message text.
  for (const text of opts.record ? [] : new Set(recipients.map((r) => r.text))) {
    const sameText = recipients.filter((r) => r.text === text);
    const villages = [...new Set(sameText.map((r) => r.user.villageCode).filter(Boolean))] as string[];
    const [row] = await db
      .insert(alerts)
      .values({
        type,
        textKm: text,
        villageCode: opts.villageCode ?? (villages.length === 1 ? villages[0] : null),
        villageCodes: opts.villageCodes ?? villages,
        officerId: opts.officerId,
      })
      .returning({ id: alerts.id });
    alertIdByText.set(text, row.id);
    counts.alertIds.push(row.id);
  }

  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH);
    const started = Date.now();
    await Promise.all(
      batch.map(async ({ user, text }) => {
        let status: DeliveryStatus = 'sent';
        let error: string | null = null;
        try {
          if (!botRef) throw new Error('Telegram bot is not running (TELEGRAM_BOT_TOKEN missing)');
          await botRef.api.sendMessage(user.telegramId, text);
        } catch (err) {
          error = (err as Error).message;
          status = err instanceof GrammyError && err.error_code === 403 ? 'blocked' : 'failed';
          if (status === 'blocked') await updateUser(user.id, { active: false });
        }
        counts[status]++;
        await db
          .insert(deliveries)
          .values({ alertId: alertIdByText.get(text)!, userId: user.id, status, error })
          .onConflictDoNothing();
      }),
    );
    const wait = 1000 - (Date.now() - started);
    if (i + BATCH < recipients.length && wait > 0) await sleep(wait);
  }
  return counts;
}
