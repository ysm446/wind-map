// 一定区間の風データを逐次取得して 1 つのコレクションに保存する。
// 予報 (NOMADS) と過去アーカイブ (AWS) の両方に対応する。
// 取得は逐次 (サーバーに優しく)。途中で失敗したフレームはスキップして続行する。

import { fetchGfsWind } from './nomads';
import { fetchArchiveWind } from './archive';
import { CollectionBuilder, CollectionSummary } from './store';

const MAX_FRAMES = 240; // 暴走防止の上限

export type BuildOptions =
  | {
      kind: 'forecast';
      name: string;
      startHour: number;
      endHour: number;
      stepHours: number;
    }
  | {
      kind: 'archive';
      name: string;
      start: string; // ISO (UTC)
      end: string; // ISO (UTC)
      stepHours: number;
    };

export interface BuildProgress {
  phase: 'running' | 'done' | 'error';
  current: number; // 処理済みステップ数
  total: number; // 総ステップ数
  saved: number; // 保存できたフレーム数
  message?: string;
}

// 取得対象の時刻リスト (有効時刻 or 予報時間) を組み立てる
function planSteps(opts: BuildOptions): number[] {
  const step = Math.max(1, Math.round(opts.stepHours));
  const steps: number[] = [];
  if (opts.kind === 'forecast') {
    const start = Math.max(0, Math.round(opts.startHour / 3) * 3);
    const end = Math.max(start, Math.round(opts.endHour / 3) * 3);
    for (let h = start; h <= end && steps.length < MAX_FRAMES; h += step) steps.push(h);
  } else {
    const t0 = new Date(opts.start).getTime();
    const t1 = new Date(opts.end).getTime();
    if (Number.isNaN(t0) || Number.isNaN(t1)) throw new Error('開始/終了日時が不正です');
    if (t1 < t0) throw new Error('終了日時が開始日時より前です');
    const ms = step * 3600_000;
    for (let t = t0; t <= t1 && steps.length < MAX_FRAMES; t += ms) steps.push(t);
  }
  return steps;
}

export async function buildCollection(
  opts: BuildOptions,
  onProgress: (p: BuildProgress) => void,
): Promise<CollectionSummary | null> {
  const steps = planSteps(opts);
  if (steps.length === 0) throw new Error('取得対象の時刻がありません');

  const builder = new CollectionBuilder(opts.name, opts.kind);
  const total = steps.length;
  let lastValid = '';

  try {
    for (let i = 0; i < steps.length; i++) {
      onProgress({ phase: 'running', current: i, total, saved: builder.frameCount });
      try {
        let records, refTime, forecastHour;
        if (opts.kind === 'forecast') {
          const r = await fetchGfsWind(steps[i]);
          records = r.records;
          refTime = r.refTime;
          forecastHour = r.forecastHour;
        } else {
          const r = await fetchArchiveWind(new Date(steps[i]).toISOString());
          records = r.records;
          refTime = r.refTime;
          forecastHour = r.forecastHour;
        }
        // 有効時刻 = ラン時刻 + 予報時間。丸めで前フレームと重複したらスキップ
        const valid = new Date(new Date(refTime).getTime() + forecastHour * 3600_000).toISOString();
        if (valid === lastValid) continue;
        lastValid = valid;
        builder.addFrame(records, valid, refTime, forecastHour);
      } catch (err) {
        // 1 フレームの失敗は致命傷にせず続行する
        console.error('frame fetch failed', err);
      }
    }
  } catch (err) {
    builder.abort();
    throw err;
  }

  const summary = builder.finalize();
  onProgress({
    phase: 'done',
    current: total,
    total,
    saved: summary?.frameCount ?? 0,
    message: summary ? undefined : '保存できたフレームがありませんでした',
  });
  return summary;
}
