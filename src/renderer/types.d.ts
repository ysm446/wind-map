interface WindApiResult {
  source: 'cache' | 'sample' | 'nomads' | 'archive';
  records: unknown;
}

interface AppSettings {
  particleTexSize?: number; // 粒子数 = この値の 2 乗 (128/256/512/1024)
  speed?: number;
  trail?: number;
  forecastHour?: number;
}

interface Window {
  windApi: {
    getWindData(): Promise<WindApiResult | null>;
    fetchWind(forecastHour: number): Promise<WindApiResult>;
    fetchArchiveWind(time: string): Promise<WindApiResult>;
    getSettings(): Promise<AppSettings | null>;
    saveSettings(settings: AppSettings): Promise<void>;
  };
}

declare module '*.json' {
  const value: unknown;
  export default value;
}
