// AWS Open Data の GFS アーカイブ (noaa-gfs-bdp-pds) から過去の地上10m風を取得する。
// アーカイブは 2021-01-01 頃から現在まで。認証不要。
// .idx ファイルでレコードのバイト位置を調べ、HTTP Range リクエストで
// UGRD/VGRD 10m の 2 レコード分(数百 KB)だけを取得する。

import { decodeGrib2 } from './grib2';
import { GfsRecord, gribMessageToRecord } from './nomads';

const BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';
const ARCHIVE_START_MS = Date.UTC(2021, 0, 1);

export interface ArchiveFetchResult {
  records: GfsRecord[];
  refTime: string;
  forecastHour: number;
}

// 指定時刻に最も近い 3 時間格子に丸め、解析に近いラン (f000 / f003) を選ぶ
export function planRequest(target: Date): { run: Date; forecastHour: number } {
  const step = 3 * 3600_000;
  const t3 = Math.round(target.getTime() / step) * step;
  const runMs = Math.floor(t3 / (6 * 3600_000)) * (6 * 3600_000);
  return { run: new Date(runMs), forecastHour: (t3 - runMs) / 3600_000 };
}

// GFSv16 (2021-03-22〜) は atmos/ サブディレクトリ入り、それ以前は直下
function candidateUrls(run: Date, forecastHour: number): string[] {
  const yyyy = run.getUTCFullYear();
  const mm = String(run.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(run.getUTCDate()).padStart(2, '0');
  const hh = String(run.getUTCHours()).padStart(2, '0');
  const fff = String(forecastHour).padStart(3, '0');
  const file = `gfs.t${hh}z.pgrb2.1p00.f${fff}`;
  return [
    `${BUCKET}/gfs.${yyyy}${mm}${dd}/${hh}/atmos/${file}`,
    `${BUCKET}/gfs.${yyyy}${mm}${dd}/${hh}/${file}`,
  ];
}

interface IdxEntry {
  offset: number;
  key: string; // "VAR:LEVEL"
}

function parseIdx(text: string): IdxEntry[] {
  const entries: IdxEntry[] = [];
  for (const line of text.split('\n')) {
    // 例: "585:34868709:d=2022010100:UGRD:10 m above ground:anl:"
    const parts = line.split(':');
    if (parts.length < 5) continue;
    const offset = Number(parts[1]);
    if (!Number.isFinite(offset)) continue;
    entries.push({ offset, key: `${parts[3]}:${parts[4]}` });
  }
  return entries;
}

// 対象レコードのバイト範囲 [start, end] を求める (end は次レコードの直前)
function findRange(entries: IdxEntry[], key: string): { start: number; end?: number } | null {
  const i = entries.findIndex((e) => e.key === key);
  if (i < 0) return null;
  return {
    start: entries[i].offset,
    end: i + 1 < entries.length ? entries[i + 1].offset - 1 : undefined,
  };
}

async function fetchUrl(
  url: string,
  init: { range?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 90_000);
  const onAbort = () => controller.abort();
  init.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: init.range ? { Range: init.range } : undefined,
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onAbort);
  }
}

// 過去日時 (UTC) の地上10m風を取得する。
// signal で中断できる (中断時は 'cancelled' を投げる)
export async function fetchArchiveWind(
  targetIso: string,
  signal?: AbortSignal,
): Promise<ArchiveFetchResult> {
  const target = new Date(targetIso);
  if (Number.isNaN(target.getTime())) throw new Error(`不正な日時です: ${targetIso}`);
  if (target.getTime() < ARCHIVE_START_MS) {
    throw new Error('GFS アーカイブは 2021-01-01 以降のみ利用できます');
  }

  const { run, forecastHour } = planRequest(target);

  for (const url of candidateUrls(run, forecastHour)) {
    const idxRes = await fetchUrl(`${url}.idx`, { timeoutMs: 30_000, signal });
    if (signal?.aborted) throw new Error('cancelled');
    if (!idxRes) continue;
    const entries = parseIdx(await idxRes.text());

    const uRange = findRange(entries, 'UGRD:10 m above ground');
    const vRange = findRange(entries, 'VGRD:10 m above ground');
    if (!uRange || !vRange) continue;

    // UGRD と VGRD は通常隣接しているので 1 リクエストにまとめる
    const start = Math.min(uRange.start, vRange.start);
    const end =
      uRange.end !== undefined && vRange.end !== undefined
        ? Math.max(uRange.end, vRange.end)
        : undefined;
    const dataRes = await fetchUrl(url, {
      range: `bytes=${start}-${end !== undefined ? end : ''}`,
      signal,
    });
    if (signal?.aborted) throw new Error('cancelled');
    if (!dataRes) continue;

    const bytes = new Uint8Array(await dataRes.arrayBuffer());
    const messages = decodeGrib2(bytes);
    const uMsg = messages.find(
      (m) => m.parameterCategory === 2 && m.parameterNumber === 2 && m.levelType === 103,
    );
    const vMsg = messages.find(
      (m) => m.parameterCategory === 2 && m.parameterNumber === 3 && m.levelType === 103,
    );
    if (!uMsg || !vMsg) continue;

    return {
      records: [gribMessageToRecord(uMsg), gribMessageToRecord(vMsg)],
      refTime: uMsg.refTime,
      forecastHour,
    };
  }

  throw new Error('指定日時の GFS アーカイブが見つかりませんでした');
}
