// Our own types. Every wrapper converts the raw DataEF reply into one of these.

/** One forecast day for one location. */
export type Forecast = {
  locationCode: string;
  date: string; // YYYY-MM-DD
  rainMm: number;
  tempMaxC: number;
  tempMinC?: number;
  condition: string; // normalised: clear | cloudy | light_rain | rain | heavy_rain | thunderstorm | storm
  rainChancePct?: number;
  windKph?: number;
  /** Hour (0-23, local) when rain is expected to start, if the API gives hourly data. */
  rainStartHour?: number;
  fetchedAt: string;
};

/** Current conditions for a province, from the DataEF weather API (no forecast there). */
export type CurrentWeather = {
  provinceCode: string;
  province: string;
  observedAt: string; // local time of the observation
  tempC: number;
  feelsLikeC?: number;
  condition: string; // normalised category, see Forecast.condition
  conditionText: string; // original text, e.g. "Patchy rain nearby"
  precipMm: number;
  humidity?: number;
  windKph?: number;
  fetchedAt: string;
};

export type FxRate = { date: string; usdKhrBuy: number; usdKhrSell: number; fetchedAt: string };

export type CsxIndex = { date: string; value: number; changePct: number; fetchedAt: string };

export type CsxStock = {
  ticker: string;
  name?: string;
  close: number;
  open?: number;
  change?: number;
  changePct: number;
};
export type CsxSummary = { date: string; stocks: CsxStock[]; fetchedAt: string };

export type CropPriceItem = {
  id: string;
  category: 'paddy' | 'rice' | 'cash_crop' | 'fruit' | 'vegetable';
  nameKm: string;
  nameEn: string;
  aliasesKm: string[];
  aliasesEn: string[];
  priceMin: number;
  priceMax: number;
  priceAvg: number;
  unit: string;
  market: string;
  /** Market name in Khmer (shown in Khmer mode). */
  marketKm?: string;
  noteKm?: string;
  noteEn?: string;
};

export type AqiReading = {
  provinceCode: string;
  provinceName: string;
  aqi: number;
  category: 'good' | 'moderate' | 'unhealthy_sensitive' | 'unhealthy' | 'very_unhealthy' | 'hazardous';
  pm25?: number;
  pm10?: number;
  fetchedAt: string;
};

export type UvReading = {
  provinceCode: string;
  provinceName: string;
  uvIndex: number;
  level: 'low' | 'moderate' | 'high' | 'very_high' | 'extreme';
  fetchedAt: string;
};

/** Wrapper result: data plus whether it came from an expired cache entry. */
export type Cached<T> = { data: T; fetchedAt: Date; stale: boolean };
