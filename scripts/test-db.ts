// 風データDB の保存・読み出しを Electron 上で検証する。
// 過去アーカイブから小さな区間を取得 → コレクション保存 → 一覧 → フレーム読み出し
// → 削除 までを通しで確認する。
//   npm run test:db
// ネットワーク (AWS GFS アーカイブ) にアクセスする。

import { app } from 'electron';
import { buildCollection } from '../src/main/db-build';
import { listCollections, getCollection, readFrame, deleteCollection } from '../src/main/store';

async function main(): Promise<void> {
  await app.whenReady();
  let exitCode = 0;
  try {
    console.log('== build (archive 2025-06-01 00:00Z〜06:00Z step 3h) ==');
    const summary = await buildCollection(
      {
        kind: 'archive',
        name: 'テスト区間',
        start: '2025-06-01T00:00:00Z',
        end: '2025-06-01T06:00:00Z',
        stepHours: 3,
      },
      (p) => console.log(`  progress: ${p.phase} ${p.current}/${p.total} saved=${p.saved}`),
    );
    if (!summary) throw new Error('ビルド結果が空');
    console.log('  summary:', JSON.stringify(summary));

    console.log('== list ==');
    const list = listCollections();
    console.log(`  ${list.length} collection(s)`);

    console.log('== meta ==');
    const meta = getCollection(summary.id);
    if (!meta) throw new Error('meta 取得失敗');
    console.log(`  frames=${meta.frames.length} grid=${meta.grid.nx}x${meta.grid.ny} times=${meta.frames.map((f) => f.time).join(', ')}`);

    console.log('== frame 0 ==');
    const f = readFrame(summary.id, 0);
    const n = f.grid.nx * f.grid.ny;
    if (f.u.length !== n || f.v.length !== n) throw new Error('u/v 長さ不一致');
    // 東京付近 (lat 35.7, lon 139.7) のサンプル値を表示
    const xi = Math.round((139.7 - f.grid.lo1) / f.grid.dx);
    const yi = Math.round((f.grid.la1 - 35.7) / f.grid.dy);
    const idx = yi * f.grid.nx + xi;
    console.log(`  u/v length OK (${n}). Tokyo sample u=${f.u[idx].toFixed(2)} v=${f.v[idx].toFixed(2)}`);

    console.log('== delete ==');
    deleteCollection(summary.id);
    const after = listCollections().some((c) => c.id === summary.id);
    console.log(`  deleted: ${!after}`);
    if (after) throw new Error('削除されていない');

    console.log('\nALL OK');
  } catch (err) {
    console.error('TEST FAILED:', err);
    exitCode = 1;
  } finally {
    app.exit(exitCode);
  }
}

void main();
