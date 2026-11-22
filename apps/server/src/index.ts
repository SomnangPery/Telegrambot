import '@sour/db/env';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { webhookCallback } from 'grammy';
import { aiEnabled, MODELS, PROVIDER } from '@sour/ai';
import { isMock } from '@sour/dataef';
import { ROOT_DIR, ensureAccounts, ensureLocations, runMigrations } from '@sour/db';
import { registerApi } from './api';
import { BOT_COMMANDS, createBot } from './bot';
import { startScheduler } from './jobs';
import { setDeliveryBot } from './services/delivery';

const PORT = Number(process.env.PORT ?? 3000);
// On Render (RENDER=true) default to webhook mode: polling stops whenever a free instance sleeps.
const ON_RENDER = !!process.env.RENDER;
const mode = (process.env.BOT_MODE ?? (ON_RENDER ? 'webhook' : 'polling')) === 'webhook' ? 'webhook' : 'polling';
if (ON_RENDER && mode === 'polling')
  console.warn('⚠ BOT_MODE=polling on Render: set BOT_MODE=webhook (polling stops while the service sleeps).');
// Render sets RENDER_EXTERNAL_URL automatically (e.g. https://sour-dataef.onrender.com).
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const DASHBOARD_DIST = join(ROOT_DIR, 'apps', 'dashboard', 'dist');

async function main() {
  // 1. Database: tables (production), then all of Cambodia + demo accounts if the DB is empty.
  // Creates/updates tables. Always on Render (unless AUTO_MIGRATE=false); opt-in elsewhere.
  if ((process.env.AUTO_MIGRATE ?? (ON_RENDER ? 'true' : 'false')).toLowerCase() === 'true') await runMigrations();
  await ensureLocations();
  await ensureAccounts();

  // 2. HTTP: API, Telegram webhook, and the built dashboard on the same address.
  const app = Fastify({ logger: { level: 'warn' } });
  // Dashboard origins allowed to call the API from another domain (e.g. Vercel).
  // Comma-separated; "*" wildcards allowed: DASHBOARD_URL=https://sour-dataef.vercel.app,https://*.vercel.app
  const allowed = (process.env.DASHBOARD_URL ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .map((s) => new RegExp(`^${s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')}$`, 'i'));
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowed.some((re) => re.test(origin))),
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-only-secret-change-me' });
  if (!process.env.JWT_SECRET) console.warn('⚠ JWT_SECRET not set – using an insecure dev secret');
  await registerApi(app);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const bot = token ? createBot(token) : null;
  setDeliveryBot(bot);

  // Telegram allows only A-Z a-z 0-9 _ - in the webhook secret (1–256 chars).
  const secretToken = (process.env.TELEGRAM_WEBHOOK_SECRET || createHash('sha256').update(token ?? '').digest('hex'))
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 256);
  if (bot && mode === 'webhook') {
    app.post('/telegram/webhook', webhookCallback(bot, 'fastify', { secretToken }));
  }

  if (existsSync(join(DASHBOARD_DIST, 'index.html'))) {
    await app.register(fastifyStatic, { root: DASHBOARD_DIST, wildcard: false });
    // Single-page app: unknown non-API paths load the dashboard.
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api') || req.url.startsWith('/telegram'))
        return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
    console.log('Dashboard: served from apps/dashboard/dist');
  }

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`API listening on :${PORT}${PUBLIC_URL ? ` (${PUBLIC_URL})` : ''}`);
  console.log(
    `DataEF mode: ${isMock() ? 'mock (demo data)' : 'live'} · AI: ${aiEnabled() ? `${PROVIDER} ${MODELS.join(' → ')}` : 'off (template fallback)'}`,
  );

  // 3. Telegram bot.
  if (bot) {
    await bot.api.setMyCommands(BOT_COMMANDS).catch((e) => console.warn('setMyCommands failed:', e.message));
    if (mode === 'webhook') {
      if (!PUBLIC_URL) throw new Error('BOT_MODE=webhook needs PUBLIC_URL (or RENDER_EXTERNAL_URL)');
      const url = `${PUBLIC_URL}/telegram/webhook`;
      await bot.api.setWebhook(url, { secret_token: secretToken, drop_pending_updates: false });
      console.log(`Bot: webhook ${url}`);
    } else {
      // Don't silently steal the bot from a deployed server: polling would delete its webhook.
      const info = await bot.api.getWebhookInfo();
      if (info.url && process.env.ALLOW_WEBHOOK_TAKEOVER !== 'true') {
        console.warn(
          `⚠ Bot is already connected to a deployed server (${info.url}). Not starting long polling here, so the live bot keeps working.\n` +
            '  Use a separate test bot token for local development, or set ALLOW_WEBHOOK_TAKEOVER=true.',
        );
      } else {
        await bot.api.deleteWebhook();
        void bot.start({ onStart: (me) => console.log(`Bot: @${me.username} (long polling)`) });
      }
    }
  } else {
    console.warn('⚠ TELEGRAM_BOT_TOKEN not set – bot is off (dashboard/API still work)');
  }

  // 4. Scheduler: 6 AM brief, hourly checks, cache refresh.
  startScheduler();

  const shutdown = async () => {
    if (mode === 'polling') await bot?.stop().catch(() => {});
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
