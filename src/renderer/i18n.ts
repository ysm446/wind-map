// UI の多言語対応(日本語 / English)。
// 静的ラベルは index.html の data-i18n / data-i18n-ph 属性で、
// 動的文字列は t(key) で切り替える。

export type Lang = 'ja' | 'en';

const STRINGS: Record<string, { ja: string; en: string }> = {
  // セクション見出し
  secParticles: { ja: 'パーティクル', en: 'Particles' },
  secOverlay: { ja: '風速オーバーレイ', en: 'Wind speed overlay' },
  secAppearance: { ja: '表示設定', en: 'Display settings' },
  secData: { ja: 'データ取得', en: 'Data fetch' },
  secDb: { ja: '保存データ / アニメーション', en: 'Saved data / Animation' },

  // パーティクル
  particleCount: { ja: '粒子数', en: 'Particle count' },
  speed: { ja: '速度', en: 'Speed' },
  brightness: { ja: '明度', en: 'Brightness' },
  trail: { ja: '軌跡の長さ', en: 'Trail length' },

  // オーバーレイ
  overlayToggle: { ja: '風速カラーオーバーレイ', en: 'Wind speed color overlay' },
  overlayOpacity: { ja: 'オーバーレイ濃度', en: 'Overlay opacity' },

  // 表示設定
  timezone: { ja: '時刻のタイムゾーン', en: 'Time zone' },
  showFps: { ja: 'FPS を表示する', en: 'Show FPS' },
  showLegend: { ja: '風速の凡例を表示', en: 'Show wind speed legend' },
  windSpeed: { ja: '風速 (m/s)', en: 'Wind speed (m/s)' },
  screenshotSaved: { ja: 'スクリーンショットを保存: ', en: 'Screenshot saved: ' },
  screenshotFailed: { ja: 'スクリーンショットの保存に失敗しました', en: 'Failed to save screenshot' },
  language: { ja: '言語', en: 'Language' },
  particleScheme: { ja: 'パーティクル配色', en: 'Particle colors' },
  schemeStandard: { ja: '標準', en: 'Standard' },
  schemeEarth: { ja: 'アース', en: 'Earth' },
  colCoast: { ja: '海岸線', en: 'Coastlines' },
  colBorder: { ja: '国境線', en: 'Borders' },
  colOcean: { ja: '海', en: 'Ocean' },
  colLand: { ja: '陸', en: 'Land' },
  colGrat: { ja: '経緯線', en: 'Graticule' },
  colHalo: { ja: '大気光', en: 'Atmosphere' },
  colBg: { ja: '背景', en: 'Background' },
  colStars: { ja: '星', en: 'Stars' },
  colorsReset: { ja: '既定に戻す', en: 'Reset to defaults' },

  // データ取得
  autoFetch: { ja: '起動時に最新データを自動取得', en: 'Auto-fetch latest data on startup' },
  forecastHour: { ja: '予報時刻', en: 'Forecast hour' },
  fetchLatest: { ja: '最新データを取得', en: 'Fetch latest data' },
  histTime: { ja: '過去日時', en: 'Past date-time' },
  fetchArchive: { ja: '過去データを取得', en: 'Fetch past data' },

  // 保存データ / アニメーション
  savedCollections: { ja: '保存済みコレクション', en: 'Saved collections' },
  noCollections: { ja: 'まだありません', en: 'None yet' },
  newCollection: { ja: '新規作成', en: 'New' },
  namePlaceholder: { ja: '名前', en: 'Name' },
  srcArchive: { ja: '過去アーカイブ', en: 'Past archive' },
  srcForecast: { ja: '予報シーケンス', en: 'Forecast sequence' },
  startLabel: { ja: '開始', en: 'Start' },
  endLabel: { ja: '終了', en: 'End' },
  fcstStart: { ja: '開始予報時刻', en: 'Start forecast hour' },
  fcstEnd: { ja: '終了予報時刻', en: 'End forecast hour' },
  step: { ja: '時間刻み', en: 'Time step' },
  saveRange: { ja: 'この区間を保存', en: 'Save this range' },
  speedPerFrame: { ja: '速度 (秒/コマ)', en: 'Speed (sec/frame)' },
  inPoint: { ja: '開始位置', en: 'Start point' },
  outPoint: { ja: '終了位置', en: 'End point' },
  interp: { ja: 'フレーム補間', en: 'Frame interpolation' },
  loop: { ja: 'ループ再生', en: 'Loop' },
  play: { ja: '▶ 再生', en: '▶ Play' },
  pause: { ja: '⏸ 一時停止', en: '⏸ Pause' },

  // データソース名
  srcCache: { ja: 'GFS キャッシュ', en: 'GFS cache' },
  srcSample: { ja: 'GFS 同梱サンプル', en: 'GFS bundled sample' },
  srcNomads: { ja: 'GFS NOMADS', en: 'GFS NOMADS' },
  srcArchiveData: { ja: 'GFS アーカイブ', en: 'GFS archive' },
  synthetic: { ja: '合成風場(フォールバック)', en: 'Synthetic field (fallback)' },

  // 動的文字列
  dataLoading: { ja: 'データ読み込み中…', en: 'Loading data…' },
  dataPrefix: { ja: 'データ: ', en: 'Data: ' },
  savedTag: { ja: '(保存)', en: '(saved)' },
  framesUnit: { ja: 'コマ', en: ' frames' },
  listForecast: { ja: '予報', en: 'Forecast' },
  listArchive: { ja: 'アーカイブ', en: 'Archive' },
  fetching: { ja: '取得中…', en: 'Fetching…' },
  fetchDone: { ja: '取得完了', en: 'Done' },
  fetchFail: { ja: '取得失敗: ', en: 'Failed: ' },
  cannotParse: { ja: 'データを解釈できませんでした', en: 'Could not parse data' },
  enterDateTime: { ja: '日時を入力してください', en: 'Please enter a date-time' },
  updatedLatest: { ja: '最新データに更新しました', en: 'Updated to latest data' },
  startupFetching: { ja: '起動時の最新データを取得中…', en: 'Fetching latest data on startup…' },
  loadingFrames: { ja: '読み込み中…', en: 'Loading…' },
  loadFailed: { ja: '読み込み失敗', en: 'Load failed' },
  buildPreparing: { ja: '準備中…', en: 'Preparing…' },
  buildFail: { ja: '失敗: ', en: 'Failed: ' },
  enterStartEnd: { ja: '開始/終了日時を入力してください', en: 'Please enter start/end date-times' },
};

let current: Lang = 'ja';

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

export function t(key: keyof typeof STRINGS | string): string {
  const entry = STRINGS[key];
  return entry ? entry[current] : key;
}

// "取得中… 3/10(保存 2)" / "Fetching… 3/10 (saved 2)"
export function tBuildRunning(current_: number, total: number, saved: number): string {
  return getLang() === 'ja'
    ? `取得中… ${current_}/${total}(保存 ${saved})`
    : `Fetching… ${current_}/${total} (saved ${saved})`;
}

// "保存完了(5コマ)" / "Saved (5 frames)"
export function tBuildDone(saved: number): string {
  return getLang() === 'ja' ? `保存完了(${saved}コマ)` : `Saved (${saved} frames)`;
}

// "「名前」を削除しますか?" / 'Delete "name"?'
export function tConfirmDelete(name: string): string {
  return getLang() === 'ja' ? `「${name}」を削除しますか?` : `Delete "${name}"?`;
}

// index.html の data-i18n / data-i18n-ph 属性を持つ要素へ反映する
export function applyStaticI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n')!);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-ph')!);
  });
  document.documentElement.lang = current;
}
