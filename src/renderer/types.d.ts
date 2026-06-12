interface WindApiResult {
  source: 'cache' | 'sample' | 'nomads' | 'archive';
  records: unknown;
}

interface ColorSettings {
  coastline?: string;
  coastlineOpacity?: number;
  border?: string;
  borderOpacity?: number;
  ocean?: string;
  land?: string;
  graticule?: string;
  halo?: string;
  background?: string;
  stars?: string;
}

interface AppSettings {
  particleTexSize?: number; // 粒子数 = この値の 2 乗 (128/256/512/1024)
  speed?: number;
  brightness?: number; // パーティクルの明度 (0.1〜2)
  trail?: number;
  forecastHour?: number;
  overlay?: boolean; // 風速カラーオーバーレイの表示
  overlayOpacity?: number;
  particleScheme?: string; // COLOR_SCHEMES のキー (standard / viridis / turbo)
  colors?: ColorSettings;
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
