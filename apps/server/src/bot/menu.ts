// Quick-question menu: a keyboard under the chat box so farmers can tap instead of type.
// Each button either sends its question to the normal question handler (answered instantly
// from DataEF by the fast path) or runs a command (brief, prices, settings).
import { Keyboard } from 'grammy';

export type MenuAction =
  | { kind: 'ask'; question: string }
  | { kind: 'brief' }
  | { kind: 'prices' }
  | { kind: 'settings' }
  | { kind: 'help' };

type Button = { km: string; en: string; action: MenuAction | ((lang: string) => MenuAction) };

const ask = (km: string, en: string): Button => ({
  km,
  en,
  action: (lang) => ({ kind: 'ask', question: (lang === 'en' ? en : km).replace(/^\p{Extended_Pictographic}️?\s*/u, '') }),
});

// Two buttons per row. ⚠ Khmer to be checked by a Khmer speaker.
const ROWS: Button[][] = [
  [ask('🌦 ថ្ងៃនេះភ្លៀងទេ?', '🌦 Rain today?'), ask('🌧 ថ្ងៃស្អែកភ្លៀងទេ?', '🌧 Rain tomorrow?')],
  [ask('💱 អត្រាប្តូរប្រាក់ថ្ងៃនេះ', '💱 Exchange rate today'), ask('📈 ផ្សារហ៊ុនថ្ងៃនេះ', '📈 Stock market today')],
  [{ km: '🌾 តម្លៃកសិផល', en: '🌾 Crop prices', action: { kind: 'prices' } }, ask('💨 គុណភាពខ្យល់', '💨 Air quality')],
  [
    { km: '☀️ ព័ត៌មានថ្ងៃនេះ', en: '☀️ Today’s brief', action: { kind: 'brief' } },
    { km: '⚙️ ការកំណត់', en: '⚙️ Settings', action: { kind: 'settings' } },
  ],
];

/** The persistent quick-question keyboard in the user's language. */
export function menuKeyboard(lang: string) {
  const kb = new Keyboard();
  for (const row of ROWS) {
    for (const b of row) kb.text(lang === 'en' ? b.en : b.km);
    kb.row();
  }
  return kb.resized().persistent().placeholder(lang === 'en' ? 'Ask a question…' : 'សួរសំណួរ…');
}

/** Which menu button (in either language) this text is, if any. */
export function matchMenu(text: string, lang: string): MenuAction | null {
  for (const row of ROWS)
    for (const b of row)
      if (text === b.km || text === b.en) return typeof b.action === 'function' ? b.action(lang) : b.action;
  return null;
}

export const MENU_HINT = {
  km: '👇 ចុចប៊ូតុងខាងក្រោម ដើម្បីសួរសំណួររហ័ស ឬវាយសំណួររបស់អ្នក។',
  en: '👇 Tap a button below for a quick question, or type your own.',
};
