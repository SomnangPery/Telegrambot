// Sign-up / settings screens. One message is edited in place; all state lives in callback data
// and the database, so a server restart never breaks a half-finished sign-up.
import { InlineKeyboard, type Context } from 'grammy';
import {
  getTopics,
  getVillage,
  listCommunes,
  listDistricts,
  listProvinces,
  listVillages,
  searchVillages,
  type User,
} from '@sour/db';
import { t } from '@sour/messages';

const PAGE = 16;
const name = (lang: string, r: { nameKm: string; nameEn: string }) => (lang === 'en' ? r.nameEn : r.nameKm);

/** Users currently in the village picker: typed text is treated as a village search. */
export const picking = new Map<number, number>();
const markPicking = (ctx: Context) => ctx.from && picking.set(ctx.from.id, Date.now() + 30 * 60_000);
export const isPicking = (id: number) => (picking.get(id) ?? 0) > Date.now();

/** Edit the current message when answering a button, otherwise send a new one. */
export async function show(ctx: Context, text: string, keyboard?: InlineKeyboard) {
  const extra = keyboard ? { reply_markup: keyboard } : {};
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, extra);
      return;
    } catch {
      /* message too old or unchanged – fall through and send a new one */
    }
  }
  await ctx.reply(text, extra);
}

function grid(kb: InlineKeyboard, items: { label: string; data: string }[], cols = 2) {
  items.forEach((it, i) => {
    kb.text(it.label, it.data);
    if ((i + 1) % cols === 0) kb.row();
  });
  if (items.length % cols !== 0) kb.row();
  return kb;
}

export async function showLanguage(ctx: Context) {
  const kb = new InlineKeyboard().text('🇰🇭 ភាសាខ្មែរ', 'lang:km').text('🇬🇧 English', 'lang:en');
  await show(ctx, t('km', 'chooseLanguage'), kb);
}

export async function showWelcome(ctx: Context, lang: string) {
  await show(ctx, t(lang, 'welcome'), new InlineKeyboard().text(t(lang, 'startButton'), 'start'));
}

export async function showProvinces(ctx: Context, lang: string) {
  markPicking(ctx);
  const rows = await listProvinces();
  // Only one province in the demo: skip straight to its districts.
  if (rows.length === 1) return showDistricts(ctx, lang, rows[0].code, true);
  const kb = grid(new InlineKeyboard(), rows.map((p) => ({ label: name(lang, p), data: `p:${p.code}` })));
  await show(ctx, `${t(lang, 'pickProvince')}\n${t(lang, 'searchHint')}`, kb);
}

export async function showDistricts(ctx: Context, lang: string, provinceCode: string, onlyProvince = false) {
  markPicking(ctx);
  const rows = await listDistricts(provinceCode);
  const kb = grid(new InlineKeyboard(), rows.map((d) => ({ label: name(lang, d), data: `d:${d.code}:0` })));
  if (!onlyProvince) kb.text(t(lang, 'back'), 'start');
  await show(ctx, `${t(lang, 'pickDistrict')}\n${t(lang, 'searchHint')}`, kb);
}

export async function showCommunes(ctx: Context, lang: string, districtCode: string, page = 0) {
  markPicking(ctx);
  const rows = await listCommunes(districtCode);
  const slice = rows.slice(page * PAGE, (page + 1) * PAGE);
  const kb = grid(new InlineKeyboard(), slice.map((c) => ({ label: name(lang, c), data: `c:${c.code}:0` })));
  kb.text(t(lang, 'back'), page > 0 ? `d:${districtCode}:${page - 1}` : `p:${districtCode.slice(0, 2)}`);
  if ((page + 1) * PAGE < rows.length) kb.text(t(lang, 'next'), `d:${districtCode}:${page + 1}`);
  await show(ctx, `${t(lang, 'pickCommune')}\n${t(lang, 'searchHint')}`, kb);
}

export async function showVillages(ctx: Context, lang: string, communeCode: string, page = 0) {
  markPicking(ctx);
  const rows = await listVillages(communeCode);
  const slice = rows.slice(page * PAGE, (page + 1) * PAGE);
  const kb = grid(new InlineKeyboard(), slice.map((v) => ({ label: name(lang, v), data: `v:${v.code}` })));
  if (page > 0) kb.text(t(lang, 'back'), `c:${communeCode}:${page - 1}`);
  else kb.text(t(lang, 'back'), `d:${communeCode.slice(0, 4)}:0`);
  if ((page + 1) * PAGE < rows.length) kb.text(t(lang, 'next'), `c:${communeCode}:${page + 1}`);
  await show(ctx, `${t(lang, 'pickVillage')}\n${t(lang, 'searchHint')}`, kb);
}

export async function showSearchResults(ctx: Context, lang: string, query: string) {
  const rows = await searchVillages(query);
  if (!rows.length) {
    await ctx.reply(t(lang, 'searchNone'));
    return;
  }
  const kb = new InlineKeyboard();
  for (const r of rows) {
    const where = lang === 'en' ? `${r.communeEn}, ${r.provinceEn}` : `${r.communeKm}, ${r.provinceKm}`;
    kb.text(`${name(lang, r)} – ${where}`, `v:${r.code}`).row();
  }
  await ctx.reply(t(lang, 'searchResults'), { reply_markup: kb });
}

/** Update checklist. mode 'new' = during sign-up (Done sends the sample brief). */
export async function showTopics(ctx: Context, user: User, mode: 'new' | 'edit') {
  const lang = user.language;
  const topics = await getTopics(user.id);
  const kb = new InlineKeyboard();
  for (const topic of ['weather', 'fx', 'csx', 'news'] as const) {
    kb.text(`${topics[topic] ? '☑️' : '⬜'} ${t(lang, `topic_${topic}`)}`, `t:${mode}:${topic}`).row();
  }
  kb.text(t(lang, 'done'), `done:${mode}`);
  await show(ctx, t(lang, 'chooseTopics'), kb);
}

export async function showSettings(ctx: Context, user: User) {
  const lang = user.language;
  const topics = await getTopics(user.id);
  const v = user.villageCode ? await getVillage(user.villageCode) : null;
  const villageText = v
    ? `${name(lang, v.village)}, ${name(lang, v.commune)}, ${name(lang, v.province)}`
    : t(lang, 'none');
  const chosen = (['weather', 'fx', 'csx', 'news'] as const).filter((x) => topics[x]).map((x) => t(lang, `topic_${x}`));
  const text = [
    t(lang, 'settingsTitle'),
    `${t(lang, 'settingsVillage')}: ${villageText}`,
    `${t(lang, 'settingsTopics')}: ${chosen.length ? chosen.join(', ') : t(lang, 'none')}`,
  ].join('\n');
  const kb = new InlineKeyboard()
    .text(t(lang, 'changeVillage'), 's:village')
    .row()
    .text(t(lang, 'changeTopics'), 's:topics')
    .row()
    .text(t(lang, 'changeLanguage'), 's:lang');
  await show(ctx, text, kb);
}
