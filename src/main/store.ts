// 風データの永続ストア (ファイル型)。
// userData/wind-db/<id>/ にコレクション単位で保存する。
//   meta.json    … 名前 / 出自 / 格子情報 / 各フレームの有効時刻
//   frame-XXXX.bin … u[nx*ny] + v[nx*ny] を Float32 (LE) で連結したバイナリ
// 格子情報は全フレーム共通なので meta.json に 1 回だけ持ち、フレームは数値の
// 生バイナリにしてサイズを抑える (1°格子で約 0.5MB/枚)。
// 一覧はサブディレクトリの meta.json を走査して作るため、別途の索引は持たない。

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { GfsRecord, gribMessageToRecord } from './nomads';

export interface GridInfo {
  nx: number;
  ny: number;
  lo1: number;
  la1: number;
  dx: number;
  dy: number;
}

export interface FrameMeta {
  time: string; // 有効時刻 (ISO, UTC)
  refTime: string; // 基準ラン時刻
  forecastHour: number;
  file: string; // 例: "frame-0000.bin"
}

export interface CollectionMeta {
  id: string;
  name: string;
  source: 'forecast' | 'archive';
  grid: GridInfo;
  frames: FrameMeta[];
  createdAt: string;
  updatedAt: string;
}

// 一覧表示用の要約 (フレーム配列は含めない)
export interface CollectionSummary {
  id: string;
  name: string;
  source: 'forecast' | 'archive';
  frameCount: number;
  start: string | null;
  end: string | null;
  updatedAt: string;
}

export interface FramePayload {
  grid: GridInfo;
  u: Float32Array;
  v: Float32Array;
  time: string;
  refTime: string;
  forecastHour: number;
}

function dbDir(): string {
  return path.join(app.getPath('userData'), 'wind-db');
}

function collectionDir(id: string): string {
  return path.join(dbDir(), id);
}

function readMeta(id: string): CollectionMeta | null {
  try {
    const text = fs.readFileSync(path.join(collectionDir(id), 'meta.json'), 'utf8');
    return JSON.parse(text) as CollectionMeta;
  } catch {
    return null;
  }
}

function writeMeta(meta: CollectionMeta): void {
  const dir = collectionDir(meta.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}

function summarize(meta: CollectionMeta): CollectionSummary {
  const times = meta.frames.map((f) => f.time);
  return {
    id: meta.id,
    name: meta.name,
    source: meta.source,
    frameCount: meta.frames.length,
    start: times.length ? times[0] : null,
    end: times.length ? times[times.length - 1] : null,
    updatedAt: meta.updatedAt,
  };
}

// 保存済みコレクションを更新日時の新しい順に一覧する
export function listCollections(): CollectionSummary[] {
  const root = dbDir();
  if (!fs.existsSync(root)) return [];
  const out: CollectionSummary[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const meta = readMeta(entry.name);
    if (meta) out.push(summarize(meta));
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export function getCollection(id: string): CollectionMeta | null {
  return readMeta(id);
}

export function deleteCollection(id: string): void {
  const dir = collectionDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

export function renameCollection(id: string, name: string): void {
  const meta = readMeta(id);
  if (!meta) throw new Error('コレクションが見つかりません');
  meta.name = name;
  meta.updatedAt = new Date().toISOString();
  writeMeta(meta);
}

// 指定フレームの u/v 配列を読み出す
export function readFrame(id: string, index: number): FramePayload {
  const meta = readMeta(id);
  if (!meta) throw new Error('コレクションが見つかりません');
  const frame = meta.frames[index];
  if (!frame) throw new Error(`フレームがありません: ${index}`);
  const buf = fs.readFileSync(path.join(collectionDir(id), frame.file));
  const n = meta.grid.nx * meta.grid.ny;
  // Buffer の byteOffset を考慮して Float32Array を切り出す
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, n * 2);
  return {
    grid: meta.grid,
    u: f32.slice(0, n),
    v: f32.slice(n, n * 2),
    time: frame.time,
    refTime: frame.refTime,
    forecastHour: frame.forecastHour,
  };
}

// GfsRecord の u/v ペアを 1 フレームのバイナリに変換する
function recordsToBytes(records: GfsRecord[]): { grid: GridInfo; bytes: Buffer } {
  const uRec = records.find(
    (r) => r.header.parameterCategory === 2 && r.header.parameterNumber === 2,
  );
  const vRec = records.find(
    (r) => r.header.parameterCategory === 2 && r.header.parameterNumber === 3,
  );
  if (!uRec || !vRec) throw new Error('U/V レコードが揃っていません');
  const h = uRec.header;
  const n = h.nx * h.ny;
  if (uRec.data.length !== n || vRec.data.length !== n) {
    throw new Error('格子サイズとデータ長が一致しません');
  }
  const f32 = new Float32Array(n * 2);
  f32.set(uRec.data, 0);
  f32.set(vRec.data, n);
  return {
    grid: { nx: h.nx, ny: h.ny, lo1: h.lo1, la1: h.la1, dx: h.dx, dy: h.dy },
    bytes: Buffer.from(f32.buffer),
  };
}

// 新規コレクションを作成して 1 フレームずつ書き込むためのビルダー。
// 取得を逐次行いながら呼び出し、最後に finalize する。
export class CollectionBuilder {
  private readonly meta: CollectionMeta;
  private grid: GridInfo | null = null;

  constructor(name: string, source: 'forecast' | 'archive') {
    const now = new Date().toISOString();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.meta = {
      id,
      name: name.trim() || '無題',
      source,
      grid: { nx: 0, ny: 0, lo1: 0, la1: 90, dx: 1, dy: 1 },
      frames: [],
      createdAt: now,
      updatedAt: now,
    };
    fs.mkdirSync(collectionDir(id), { recursive: true });
  }

  get id(): string {
    return this.meta.id;
  }

  get frameCount(): number {
    return this.meta.frames.length;
  }

  // 1 フレームを追記する。time は有効時刻 (ISO)。
  addFrame(records: GfsRecord[], time: string, refTime: string, forecastHour: number): void {
    const { grid, bytes } = recordsToBytes(records);
    if (this.grid && (this.grid.nx !== grid.nx || this.grid.ny !== grid.ny)) {
      throw new Error('フレーム間で格子サイズが一致しません');
    }
    this.grid = grid;
    this.meta.grid = grid;
    const file = `frame-${String(this.meta.frames.length).padStart(4, '0')}.bin`;
    fs.writeFileSync(path.join(collectionDir(this.meta.id), file), bytes);
    this.meta.frames.push({ time, refTime, forecastHour, file });
  }

  // メタを書き出して確定する。1 フレームも無ければディレクトリごと破棄して null。
  finalize(): CollectionSummary | null {
    if (this.meta.frames.length === 0) {
      deleteCollection(this.meta.id);
      return null;
    }
    this.meta.frames.sort((a, b) => (a.time < b.time ? -1 : 1));
    this.meta.updatedAt = new Date().toISOString();
    writeMeta(this.meta);
    return summarize(this.meta);
  }

  // 失敗時にディレクトリごと破棄する
  abort(): void {
    deleteCollection(this.meta.id);
  }
}

export { gribMessageToRecord };
