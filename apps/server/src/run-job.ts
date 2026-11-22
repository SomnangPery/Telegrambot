/**
 * Run one scheduled job once from the command line, e.g.:
 *   pnpm --filter @sour/server job refresh
 *   pnpm --filter @sour/server job brief
 */
import '@sour/db/env';
import { sql } from '@sour/db';
import { createBot } from './bot';
import { JOBS, type JobName } from './jobs';
import { setDeliveryBot } from './services/delivery';

const name = process.argv[2] as JobName;
if (!JOBS[name]) {
  console.error(`Usage: job <${Object.keys(JOBS).join('|')}>`);
  process.exit(1);
}
if (process.env.TELEGRAM_BOT_TOKEN) setDeliveryBot(createBot(process.env.TELEGRAM_BOT_TOKEN));
console.log(await JOBS[name]());
await sql.end();
