import { Bot, type Context } from 'grammy';
import { answerQuestion } from '@sour/ai';
import { cropPriceSourceLine, formatCropPrice, getCropPrices } from '@sour/dataef';
import { getTopics, getUserByTelegramId, setTopic, updateUser, upsertUser, type Topic, type User } from '@sour/db';
import { t } from '@sour/messages';
import { buildBrief } from '../services/brief';
import {
  isPicking,
  picking,
  showCommunes,
  showDistricts,
  showLanguage,
  showProvinces,
  showSearchResults,
  showSettings,
  showTopics,
  showVillages,
  showWelcome,
} from './picker';
import { MENU_HINT, matchMenu, menuKeyboard } from './menu';

async function currentUser(ctx: Context): Promise<User> {
  const { user } = await upsertUser(ctx.from!.id);
  return (await getUserByTelegramId(ctx.from!.id)) ?? user;
}

/** Shows (or refreshes) the quick-question keyboard under the chat box. */
async function sendMenu(ctx: Context, lang: string, text?: string) {
  await ctx.reply(text ?? (lang === 'en' ? MENU_HINT.en : MENU_HINT.km), { reply_markup: menuKeyboard(lang) });
}

async function sendBrief(ctx: Context, user: User) {
  if (!user.villageCode) return ctx.reply(t(user.language, 'needVillage'));
  await ctx.replyWithChatAction('typing');
  const text = await buildBrief(user, await getTopics(user.id));
  await ctx.reply(text ?? t(user.language, 'briefEmpty'), { reply_markup: menuKeyboard(user.language) });
}

async function sendPrices(ctx: Context, user: User) {
  await ctx.replyWithChatAction('typing');
  const items = getCropPrices().slice(0, 7);
  const lines = [
    t(user.language, 'cropPricesTitle'),
    ...items.map((item) => formatCropPrice(item, user.language)),
    cropPriceSourceLine(user.language),
  ];
  await ctx.reply(lines.join('\n\n'), { reply_markup: menuKeyboard(user.language) });
}

export function createBot(token: string) {
  const bot = new Bot(token);

  // ---------- Commands ----------
  bot.command('start', async (ctx) => {
    const { created } = await upsertUser(ctx.from!.id);
    const user = (await getUserByTelegramId(ctx.from!.id))!;
    if (!user.active) await updateUser(user.id, { active: true });
    if (created || !user.villageCode) return showLanguage(ctx);
    await showSettings(ctx, user);
    await sendMenu(ctx, user.language);
  });

  bot.command(['menu', 'questions'], async (ctx) => {
    const user = await currentUser(ctx);
    if (!user.villageCode) return ctx.reply(t(user.language, 'needVillage'));
    await sendMenu(ctx, user.language);
  });

  bot.command('settings', async (ctx) => {
    const user = await currentUser(ctx);
    if (!user.villageCode) return showLanguage(ctx);
    await showSettings(ctx, user);
  });

  bot.command('brief', async (ctx) => sendBrief(ctx, await currentUser(ctx)));

  bot.command(['prices', 'price'], async (ctx) => sendPrices(ctx, await currentUser(ctx)));

  bot.command('help', async (ctx) => {
    const user = await currentUser(ctx);
    if (user.villageCode) await sendMenu(ctx, user.language, t(user.language, 'help'));
    else await ctx.reply(t(user.language, 'help'));
  });

  bot.command('stop', async (ctx) => {
    const user = await currentUser(ctx);
    await updateUser(user.id, { active: false });
    await ctx.reply(t(user.language, 'stopped'), { reply_markup: { remove_keyboard: true } });
  });

  // ---------- Buttons ----------
  bot.callbackQuery(/^lang:(km|en)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await currentUser(ctx);
    const language = ctx.match[1];
    await updateUser(user.id, { language });
    if (!user.villageCode) return showWelcome(ctx, language);
    await showSettings(ctx, { ...user, language });
    await sendMenu(ctx, language); // keyboard in the new language
  });

  bot.callbackQuery(['start', 's:village'], async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await currentUser(ctx);
    await showProvinces(ctx, user.language);
  });

  bot.callbackQuery(/^p:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await currentUser(ctx);
    await showDistricts(ctx, user.language, ctx.match[1]);
  });

  bot.callbackQuery(/^d:(\w+)(?::(\d+))?$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await currentUser(ctx);
    await showCommunes(ctx, user.language, ctx.match[1], Number(ctx.match[2] ?? 0));
  });

  bot.callbackQuery(/^c:(\w+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await currentUser(ctx);
    await showVillages(ctx, user.language, ctx.match[1], Number(ctx.match[2]));
  });

  bot.callbackQuery(/^v:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await currentUser(ctx);
    const wasRegistered = !!user.villageCode;
    await updateUser(user.id, { villageCode: ctx.match[1], active: true });
    picking.delete(ctx.from.id);
    const updated = { ...user, villageCode: ctx.match[1] };
    if (wasRegistered) await showSettings(ctx, updated);
    else await showTopics(ctx, updated, 'new');
  });

  bot.callbackQuery(/^t:(new|edit):(weather|fx|csx|news)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await currentUser(ctx);
    const topic = ctx.match[2] as Topic;
    const topics = await getTopics(user.id);
    await setTopic(user.id, topic, !topics[topic]);
    await showTopics(ctx, user, ctx.match[1] as 'new' | 'edit');
  });

  bot.callbackQuery(/^done:(new|edit)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await currentUser(ctx);
    if (ctx.match[1] === 'edit') return showSettings(ctx, user);
    // Sign-up finished: confirmation + a sample brief right away.
    await ctx.editMessageText(t(user.language, 'saved')).catch(() => ctx.reply(t(user.language, 'saved')));
    await ctx.replyWithChatAction('typing');
    const brief = await buildBrief(user, await getTopics(user.id));
    if (brief) await ctx.reply(brief);
    await sendMenu(ctx, user.language);
  });

  bot.callbackQuery('s:topics', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTopics(ctx, await currentUser(ctx), 'edit');
  });

  bot.callbackQuery('s:lang', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showLanguage(ctx);
  });

  // ---------- Voice / audio / video notes: not supported in stage 1 (text only) ----------
  bot.on(['message:voice', 'message:audio', 'message:video_note'], async (ctx) => {
    const user = await currentUser(ctx);
    const text =
      user.language === 'en'
        ? '🎤 Sorry, I can’t listen to voice messages yet. Please type your question or tap a button below.'
        : '🎤 សូមអភ័យទោស ខ្ញុំមិនទាន់អាចស្តាប់សារជាសំឡេងបានទេ។ សូមវាយសំណួរ ឬចុចប៊ូតុងខាងក្រោម។';
    await ctx.reply(text, user.villageCode ? { reply_markup: menuKeyboard(user.language) } : {});
  });

  // ---------- Free text: village search while picking, otherwise a question (FR-10) ----------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    const user = await currentUser(ctx);

    // Quick-question menu buttons.
    const action = user.villageCode ? matchMenu(text, user.language) : null;
    if (action) {
      picking.delete(ctx.from.id);
      if (action.kind === 'brief') return sendBrief(ctx, user);
      if (action.kind === 'prices') return sendPrices(ctx, user);
      if (action.kind === 'settings') return showSettings(ctx, user);
      if (action.kind === 'help') return sendMenu(ctx, user.language, t(user.language, 'help'));
    }

    if (!action && (!user.villageCode || isPicking(ctx.from.id))) return showSearchResults(ctx, user.language, text);

    await ctx.replyWithChatAction('typing');
    const question = action?.kind === 'ask' ? action.question : text;
    const answer = await answerQuestion(question, user.villageCode, user.language);
    await ctx.reply(answer ?? t(user.language, 'aiError'), { reply_markup: menuKeyboard(user.language) });
  });

  bot.catch((err) => console.error('[bot]', err.error));
  return bot;
}

export const BOT_COMMANDS = [
  { command: 'start', description: 'ចាប់ផ្តើម / Start' },
  { command: 'menu', description: 'សំណួររហ័ស / Quick questions' },
  { command: 'brief', description: 'ព័ត៌មានថ្ងៃនេះ / Today’s brief' },
  { command: 'prices', description: 'តម្លៃកសិផល / Crop prices' },
  { command: 'settings', description: 'ការកំណត់ / Settings' },
  { command: 'help', description: 'ជំនួយ / Help' },
  { command: 'stop', description: 'បិទការផ្ញើ / Turn off updates' },
];
