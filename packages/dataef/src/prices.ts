import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CropPriceItem } from './types';

const FALLBACK_ITEMS: CropPriceItem[] = [
  {
    id: 'paddy_phka_rumduol',
    category: 'paddy',
    nameKm: 'ស្រូវផ្ការំដួល (ស្រូវសើម)',
    nameEn: 'Phka Rumduol Paddy (Wet)',
    aliasesKm: ['ផ្ការំដួល', 'ស្រូវផ្ការំដួល', 'ស្រូវក្រអូប', 'ស្រូវ'],
    aliasesEn: ['phka rumduol', 'fragrant rice', 'jasmine paddy', 'paddy', 'rice'],
    priceMin: 1400,
    priceMax: 1550,
    priceAvg: 1480,
    unit: 'kg',
    market: 'Battambang & Banteay Meanchey Millers',
    noteKm: 'តម្លៃទិញដល់ជង្រុក ឬរោងម៉ាស៊ីនកិនស្រូវ (សំណើម ~25%)',
    noteEn: 'Farmgate/mill purchase price (moisture ~25%)',
  },
  {
    id: 'paddy_sen_kra_ob',
    category: 'paddy',
    nameKm: 'ស្រូវសែនក្រអូប (ស្រូវសើម)',
    nameEn: 'Sen Kra Ob Paddy (Wet)',
    aliasesKm: ['សែនក្រអូប', 'ស្រូវសែនក្រអូប'],
    aliasesEn: ['sen kra ob', 'sen kraob', 'sko'],
    priceMin: 1250,
    priceMax: 1380,
    priceAvg: 1320,
    unit: 'kg',
    market: 'Battambang & Takeo',
    noteKm: 'ស្រូវក្រអូបស្រាលរដូវវស្សា',
    noteEn: 'Early-maturing fragrant paddy',
  },
  {
    id: 'paddy_ir504',
    category: 'paddy',
    nameKm: 'ស្រូវប្រាំង IR504 / OM',
    nameEn: 'IR504 / OM Dry Season Paddy',
    aliasesKm: ['អាយអ៊ែរ', '៥០៤', 'ស្រូវប្រាំង', 'ir504'],
    aliasesEn: ['ir504', 'om5451', 'dry season paddy'],
    priceMin: 1020,
    priceMax: 1150,
    priceAvg: 1080,
    unit: 'kg',
    market: 'Prey Veng & Takeo',
    noteKm: 'ស្រូវសម្រាប់កែច្នៃ និងនាំចេញតាមព្រំដែន',
    noteEn: 'Export and processing paddy variety',
  },
  {
    id: 'fresh_cassava',
    category: 'cash_crop',
    nameKm: 'ដំឡូងមីស្រស់',
    nameEn: 'Fresh Cassava Root',
    aliasesKm: ['ដំឡូងមី', 'ដំឡូងមីស្រស់', 'ដំឡូង'],
    aliasesEn: ['cassava', 'fresh cassava', 'tapioca'],
    priceMin: 330,
    priceMax: 420,
    priceAvg: 375,
    unit: 'kg',
    market: 'Battambang, Pailin & Kratie',
    noteKm: 'តម្លៃថ្លឹងនៅស្តង់ ឬរោងចក្រម្សៅមី',
    noteEn: 'Delivered to starch factory or collection stall',
  },
  {
    id: 'dry_cassava',
    category: 'cash_crop',
    nameKm: 'ដំឡូងមីស្ងួត (ចំណិត)',
    nameEn: 'Dried Cassava Chips',
    aliasesKm: ['ដំឡូងមីស្ងួត', 'ដំឡូងចំណិត', 'ដំឡូងស្ងួត'],
    aliasesEn: ['dry cassava', 'cassava chips'],
    priceMin: 750,
    priceMax: 880,
    priceAvg: 810,
    unit: 'kg',
    market: 'Battambang & Banteay Meanchey Border',
    noteKm: 'ចំណិតដំឡូងមីហាលស្ងួតល្អសម្រាប់នាំចេញ',
    noteEn: 'Sun-dried cassava chips for feed/export',
  },
  {
    id: 'raw_cashew',
    category: 'cash_crop',
    nameKm: 'គ្រាប់ស្វាយចន្ទីស្រស់',
    nameEn: 'Raw Cashew Nuts (Wet)',
    aliasesKm: ['ស្វាយចន្ទី', 'គ្រាប់ស្វាយចន្ទី', 'ចន្ទី', 'ស្វាយចន្ទីស្រស់'],
    aliasesEn: ['cashew', 'raw cashew', 'wet cashew nuts'],
    priceMin: 5600,
    priceMax: 6800,
    priceAvg: 6200,
    unit: 'kg',
    market: 'Kampong Thom & Ratanakiri',
    noteKm: 'គ្រាប់ស្រស់ទើបប្រមូលផល (ពូជ M23 / M10)',
    noteEn: 'Freshly harvested RCN (M23 / M10 varieties)',
  },
  {
    id: 'dry_cashew',
    category: 'cash_crop',
    nameKm: 'គ្រាប់ស្វាយចន្ទីស្ងួត',
    nameEn: 'Dried Cashew Nuts (Dry RCN)',
    aliasesKm: ['ស្វាយចន្ទីស្ងួត', 'គ្រាប់ស្វាយចន្ទីស្ងួត'],
    aliasesEn: ['dry cashew', 'dried cashew nuts'],
    priceMin: 7200,
    priceMax: 8500,
    priceAvg: 7800,
    unit: 'kg',
    market: 'Kampong Thom, Kratie & Preah Vihear',
    noteKm: 'គ្រាប់ហាលស្ងួតល្អ សំណើម ៨-១០%',
    noteEn: 'Dried cashew nuts, 8-10% moisture',
  },
  {
    id: 'red_corn',
    category: 'cash_crop',
    nameKm: 'ពោតក្រហម (ចំណីសត្វ)',
    nameEn: 'Red Maize / Corn (Animal Feed)',
    aliasesKm: ['ពោតក្រហម', 'ពោត'],
    aliasesEn: ['red corn', 'maize', 'corn'],
    priceMin: 950,
    priceMax: 1150,
    priceAvg: 1050,
    unit: 'kg',
    market: 'Battambang & Pailin',
    noteKm: 'ពោតគ្រាប់ស្ងួតសម្រាប់រោងចក្រចំណីសត្វ',
    noteEn: 'Dried corn grain for feed production',
  },
  {
    id: 'rubber_cup_lump',
    category: 'cash_crop',
    nameKm: 'ជ័រកៅស៊ូកក',
    nameEn: 'Natural Rubber Cup Lump',
    aliasesKm: ['កៅស៊ូ', 'ជ័រកៅស៊ូ', 'ជ័រកៅស៊ូកក'],
    aliasesEn: ['rubber', 'cup lump', 'natural rubber'],
    priceMin: 3900,
    priceMax: 4700,
    priceAvg: 4300,
    unit: 'kg',
    market: 'Tbong Khmum & Kampong Cham',
    noteKm: 'កៅស៊ូកកកម្រិត DRC 50%',
    noteEn: 'Field cup lump DRC 50%',
  },
  {
    id: 'black_pepper',
    category: 'cash_crop',
    nameKm: 'ម្រេចខ្មៅ',
    nameEn: 'Black Pepper',
    aliasesKm: ['ម្រេច', 'ម្រេចខ្មៅ'],
    aliasesEn: ['pepper', 'black pepper', 'kampot pepper'],
    priceMin: 16000,
    priceMax: 22000,
    priceAvg: 19000,
    unit: 'kg',
    market: 'Tbong Khmum & Kampot',
    noteKm: 'ម្រេចខ្មៅស្ងួតគុណភាពល្អ',
    noteEn: 'Quality dried black peppercorn',
  },
];

let cachedPrices: CropPriceItem[] | null = null;

/** Where the reference prices come from and when they were last updated (not a live feed). */
let priceMeta: { updatedAt: string | null; source: string | null; sourceKm: string | null } = {
  updatedAt: null,
  source: null,
  sourceKm: null,
};
export function getCropPriceMeta() {
  loadPrices();
  return priceMeta;
}

/** "📋 Reference prices · MAFF (AMIS) & CRF · updated 20 Nov 2026" */
export function cropPriceSourceLine(lang: string) {
  const m = getCropPriceMeta();
  const date = m.updatedAt
    ? new Date(m.updatedAt).toLocaleDateString(lang === 'en' ? 'en-GB' : 'km-KH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Phnom_Penh',
      })
    : null;
  return lang === 'en'
    ? `📋 Reference prices${m.source ? ` · ${m.source}` : ''}${date ? ` · updated ${date}` : ''}. Prices change daily; check with your buyer.`
    : `📋 តម្លៃយោង${m.sourceKm ? ` · ${m.sourceKm}` : ''}${date ? ` · ធ្វើបច្ចុប្បន្នភាព ${date}` : ''}។ តម្លៃប្រែប្រួលរៀងរាល់ថ្ងៃ សូមផ្ទៀងផ្ទាត់ជាមួយអ្នកទិញ។`;
}

function loadPrices(): CropPriceItem[] {
  if (cachedPrices) return cachedPrices;
  try {
    const candidatePaths = [
      join(process.cwd(), 'data', 'commodity_prices.json'),
      join(process.cwd(), '..', '..', 'data', 'commodity_prices.json'),
    ];
    for (const p of candidatePaths) {
      if (existsSync(p)) {
        const raw = JSON.parse(readFileSync(p, 'utf8'));
        if (Array.isArray(raw.items)) {
          priceMeta = {
            updatedAt: raw.updated_at ?? null,
            source: raw.source ?? null,
            sourceKm: raw.source_km ?? raw.source ?? null,
          };
          cachedPrices = raw.items.map((i: any) => ({
            id: i.id,
            category: i.category,
            nameKm: i.name_km,
            nameEn: i.name_en,
            aliasesKm: i.aliases_km ?? [],
            aliasesEn: i.aliases_en ?? [],
            priceMin: i.price_min,
            priceMax: i.price_max,
            priceAvg: i.price_avg,
            unit: i.unit,
            market: i.market,
            marketKm: i.market_km,
            noteKm: i.note_km,
            noteEn: i.note_en,
          }));
          return cachedPrices!;
        }
      }
    }
  } catch (err) {
    console.warn('[prices] failed loading commodity_prices.json, using fallback:', (err as Error).message);
  }
  cachedPrices = FALLBACK_ITEMS;
  return cachedPrices;
}

export function getCropPrices(): CropPriceItem[] {
  return loadPrices();
}

export function searchCropPrices(query: string): CropPriceItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return getCropPrices();
  return getCropPrices().filter((item) => {
    const nameKm = item.nameKm.toLowerCase();
    const nameEn = item.nameEn.toLowerCase();
    const category = item.category.toLowerCase();
    return (
      nameKm.includes(q) ||
      q.includes(nameKm) ||
      nameEn.includes(q) ||
      q.includes(nameEn) ||
      category.includes(q) ||
      item.aliasesKm.some((a) => a && (a.toLowerCase().includes(q) || q.includes(a.toLowerCase()))) ||
      item.aliasesEn.some((a) => a && (a.toLowerCase().includes(q) || q.includes(a.toLowerCase())))
    );
  });
}

export function findCropPrice(query: string): CropPriceItem | null {
  const matches = searchCropPrices(query);
  return matches[0] ?? null;
}

export function formatCropPrice(item: CropPriceItem, lang: string): string {
  const isEn = lang === 'en';
  const name = isEn ? item.nameEn : item.nameKm;
  const unit = isEn ? item.unit : (item.unit === 'kg' ? 'គ.ក្រ' : item.unit);
  const min = item.priceMin.toLocaleString();
  const max = item.priceMax.toLocaleString();
  const avg = item.priceAvg.toLocaleString();
  // One language per message: Khmer market name in Khmer mode (fall back to English only if missing).
  const market = isEn ? item.market : (item.marketKm ?? item.market);
  const note = isEn ? item.noteEn : item.noteKm;

  if (isEn) {
    return [
      `🌾 ${name}: ${min}–${max} KHR/${unit} (avg ${avg} KHR)`,
      `📍 Market: ${market}${note ? ` · ${note}` : ''}`,
    ].join('\n');
  }

  return [
    `🌾 ${name}៖ ${min} – ${max} រៀល/${unit} (មធ្យម ${avg} រៀល)`,
    `📍 ទីផ្សារ៖ ${market}${note ? ` · ${note}` : ''}`,
  ].join('\n');
}
