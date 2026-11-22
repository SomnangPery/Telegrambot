import '@sour/db/env';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { webhookCallback } from 'grammy';
import { aiEnabled, MODELS, PROVIDER } from '@sour/ai';
import { isMock } from '@sour/dataef';
import { registerApi } from './api';
import { BOT_COMMANDS, createBot } from './bot';
import { startScheduler } from './jobs';
import { setDeliveryBot } from './services/delivery';

const PORT = Number(process.env.PORT ?? 3000);
const mode = process.env.BOT_MODE === 'webhook' ? 'webhook' : 'polling';

async function main() {
  const app = Fastify({ logger: { level: 'warn' } });
  await app.register(cors, {
    origin: (process.env.DASHBOARD_URL ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-only-secret-change-me' });
  if (!process.env.JWT_SECRET) console.warn('⚠ JWT_SECRET not set – using an insecure dev secret');
  await registerApi(app);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const bot = token ? createBot(token) : null;
  setDeliveryBot(bot);

  if (bot && mode === 'webhook') {
    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
    app.post('/telegram/webhook', webhookCallback(bot, 'fastify', { secretToken }));
  }

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`API listening on :${PORT}`);
  console.log(`DataEF mode: ${isMock() ? 'mock (demo data)' : 'live'} · AI: ${aiEnabled() ? `${PROVIDER} ${MODELS.join(' → ')}` : 'off (template fallback)'}`);

  if (bot) {
    await bot.api.setMyCommands(BOT_COMMANDS).catch((e) => console.warn('setMyCommands failed:', e.message));
    if (mode === 'webhook') {
      const url = `${process.env.PUBLIC_URL}/telegram/webhook`;
      await bot.api.setWebhook(url, { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET });
      console.log(`Bot: webhook ${url}`);
    } else {
      await bot.api.deleteWebhook();
      void bot.start({ onStart: (me) => console.log(`Bot: @${me.username} (long polling)`) });
    }
  } else {
    console.warn('⚠ TELEGRAM_BOT_TOKEN not set – bot is off (dashboard/API still work)');
  }

  startScheduler();

  const shutdown = async () => {
    await bot?.stop();
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
