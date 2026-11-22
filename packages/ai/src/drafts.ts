import type { CsxIndex, CsxSummary, Forecast, RiskReason } from '@sour/dataef';
import { biggestMoves } from '@sour/dataef';
import { reasonText, weatherLine } from '@sour/messages';
import { templateAdvice } from './advice';
import { complete } from './client';

export type DraftVillage = {
  nameKm: string;
  forecast: Forecast[];
  level: string;
  reasons: RiskReason[];
};

/** AI-drafted Khmer alert for the officer to edit (FR-13). Falls back to a template. */
export async function draftOfficerAlert(villages: DraftVillage[]): Promise<string> {
  // Base the message on the worst village so the warning is not watered down.
  const order = { urgent: 2, watch: 1, normal: 0 } as Record<string, number>;
  const worst = [...villages].sort((a, b) => order[b.level] - order[a.level])[0];
  if (!worst?.forecast[0]) return '';
  const names = villages.map((v) => `ភូមិ${v.nameKm}`).join(', ');
  const reasons = worst.reasons.map((r) => reasonText('km', r)).join(', ');
  const fallback = [
    reasons ? `⚠️ ${reasons} ក្នុង 24 ម៉ោងខាងមុខ សម្រាប់ ${names}។` : `📍 ${names}`,
    weatherLine('km', worst.forecast[0]),
    `💡 ${templateAdvice(worst.forecast, 'km')}`,
  ].join('\n');

  const ai = await complete(
    `You draft short Khmer warning messages that a commune agriculture officer sends to farmers on Telegram.
At most 4 short lines. Use only the numbers in the data. Use only the approved advice given. One emoji per line as a label.
Output only the message.`,
    `Villages: ${names}\nRisk: ${worst.level} (${reasons || 'none'})\nForecast next 24 h: ${JSON.stringify(worst.forecast[0])}\nApproved advice: ${templateAdvice(worst.forecast, 'km')}`,
    1024,
  );
  return ai && ai.length <= 600 ? ai : fallback;
}

/** One plain sentence explaining today's CSX move (FR-9). Empty string if the AI is unavailable. */
export async function explainCsx(idx: CsxIndex, summary: CsxSummary | null, lang = 'km'): Promise<string> {
  const moves = summary ? biggestMoves(summary) : null;
  const ai = await complete(
    `Explain today's Cambodian stock market move in ONE short, plain sentence in ${lang === 'en' ? 'English' : 'Khmer'} for a first-time investor.
Use only the numbers given. Never suggest buying, selling or holding. Output only the sentence.`,
    JSON.stringify({ index: idx, biggest_rise: moves?.up, biggest_fall: moves?.down }),
    600,
  );
  return ai && ai.length <= 300 ? ai : '';
}
