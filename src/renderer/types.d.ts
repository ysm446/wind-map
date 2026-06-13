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
  tz?: number; // 時刻表示のタイムゾーンオフセット (時間, UTC からのずれ)
  autoFetch?: boolean; // 起動時に最新データを自動取得するか
  showFps?: boolean; // FPS を画面右上に表示するか
  showLegend?: boolean; // 左下の風速凡例を表示するか
  lang?: 'ja' | 'en'; // UI 言語
  colors?: ColorSettings;
}

interface GridInfo {
  nx: number;
  ny: number;
  lo1: number;
  la1: number;
  dx: number;
  dy: number;
}

interface CollectionSummary {
  id: string;
  name: string;
  source: 'forecast' | 'archive';
  frameCount: number;
  start: string | null;
  end: string | null;
  updatedAt: string;
}

interface FrameMeta {
  time: string;
  refTime: string;
  forecastHour: number;
  file: string;
}

interface CollectionMeta {
  id: string;
  name: string;
  source: 'forecast' | 'archive';
  grid: GridInfo;
  frames: FrameMeta[];
  createdAt: string;
  updatedAt: string;
}

interface FramePayload {
  grid: GridInfo;
  u: Float32Array;
  v: Float32Array;
  time: string;
  refTime: string;
  forecastHour: number;
}

type BuildOptions =
  | { kind: 'forecast'; name: string; startHour: number; endHour: number; stepHours: number }
  | { kind: 'archive'; name: string; start: string; end: string; stepHours: number };

interface BuildProgress {
  phase: 'running' | 'done' | 'error';
  current: number;
  total: number;
  saved: number;
  message?: string;
}

interface Window {
  windApi: {
    getWindData(): Promise<WindApiResult | null>;
    fetchWind(forecastHour: number): Promise<WindApiResult>;
    fetchArchiveWind(time: string): Promise<WindApiResult>;
    getSettings(): Promise<AppSettings | null>;
    saveSettings(settings: AppSettings): Promise<void>;
    captureScreenshot(): Promise<string>;
    dbList(): Promise<CollectionSummary[]>;
    dbGet(id: string): Promise<CollectionMeta | null>;
    dbGetFrame(id: string, index: number): Promise<FramePayload>;
    dbDelete(id: string): Promise<void>;
    dbRename(id: string, name: string): Promise<void>;
    dbBuild(opts: BuildOptions): Promise<CollectionSummary | null>;
    onBuildProgress(cb: (p: BuildProgress) => void): () => void;
  };
}

declare module '*.json' {
  const value: unknown;
  export default value;
}
