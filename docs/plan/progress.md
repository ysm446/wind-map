# 進捗

作成日時: 2026-06-12 22:44
更新日時: 2026-06-13 00:15

## 現在の状態

P3 の GPU パーティクル化まで完了。262,144 粒子(最大 100 万)が 120fps で動く。
P2b (ERA5、1940 年〜) はユーザーの CDS アカウント登録待ちで保留。
P3 の残りはカラーオーバーレイ、高度切り替え、0.25° 対応。

## 完了済み

- 2026-06-13: ベクター海岸線 + LOD(globe.ts の `Coastlines`)
  - 110m/50m は起動時ロード、10m は初回ズーム時に動的 import
  - 切替距離: >4.5 で 110m、2.5〜4.5 で 50m、<2.5 で 10m

- 2026-06-13: P3 GPU パーティクル化(`src/renderer/gpu-particles.ts`)
  - ping-pong FBO による状態更新 + 画面スペース蓄積バッファによる軌跡
  - 粒子数セレクト(16K〜1M)、軌跡スライダーは蓄積の減衰率にマップ
  - 非対応環境は CPU 移流(6000 粒子)にフォールバック

- 2026-06-13: P2a 過去データ(GFS アーカイブ)
  - AWS Open Data (noaa-gfs-bdp-pds) から idx + HTTP Range で必要レコードのみ取得
    (`src/main/archive.ts`)
  - 過去日時入力 UI(datetime-local、UTC 解釈)と「過去データを取得」ボタン
  - `npm run test:archive -- <ISO日時>` で取得単体を検証可能
  - 2021-02(旧レイアウト)/ 2023-08(f003)/ 2025-06 の 3 パターンで検証済み

- 2026-06-12: 技術選定とアーキテクチャ決定(goals.md / plan.md 参照)
- 2026-06-12: P1 実データ取得
  - NOMADS GRIB filter から地上10m風の GRIB2 を取得(`src/main/nomads.ts`)
  - 純 TypeScript の GRIB2 デコーダ実装(`src/main/grib2.ts`、テンプレート 5.0/5.2/5.3)
  - `wind:fetch` IPC、userData へのキャッシュ保存、予報時刻スライダー(+0〜+120h)と取得ボタン
  - `npm run test:nomads` で取得単体を検証可能(`--write-cache` でアプリのキャッシュに書ける)
  - デコード結果を Open-Meteo の GFS モデル値と 3 地点で照合し一致を確認
- 2026-06-12: P0 プロトタイプ実装
  - Electron + Vite + TypeScript + Three.js の骨組み(`npm run build` → `npm start`)
  - 3D 地球儀(Natural Earth 110m の陸地 GeoJSON をキャンバスに描いてテクスチャ化)
  - OrbitControls による回転・ズーム
  - GFS JSON 形式(cambecc/earth 互換)の読み込みと双線形補間
  - CPU パーティクル移流 + 流線描画(既定 6000 粒子 × 軌跡 16 点、実測 120fps)
  - 風速による色付け、粒子数・速度スライダー、FPS 表示
  - サンプルデータ同梱(`assets/data/current-wind.json`、GFS 2014-01-31 00:00 UTC)
  - データ欠如時は合成風場にフォールバック

## 未着手

- P3 残り: 風速カラーオーバーレイ、等圧面の高度切り替え、0.25° 格子対応、
  実星カタログによる星空(HYG 等)
- P2b【保留】: ERA5 による過去データ対応(1940 年〜)
  - 前提: ユーザーが https://cds.climate.copernicus.eu/ でアカウントを作成し、
    Personal Access Token を取得する必要がある
  - ERA5 は GRIB1 配信のため、GRIB1 デコーダの追加実装が必要(GRIB2 とは別形式)
- P4: エディタ機能と配布

## 注意点

- UI 設定はアプリ直下の `data/settings.json` に保存される(`.gitignore` 済み)。
  パッケージ化(asar)すると app パス直下は書き込み不可になるため、
  P4 の配布対応時に保存先の見直しが必要(exe 隣接ディレクトリ or userData)。

- **NOMADS の OpenDAP (DODS) は 2025 年に廃止済み (SCN 25-81)**。データ取得は GRIB filter
  (`filter_gfs_1p00.pl`)を使うこと。ラン未公開時は HTML エラーページが返るので
  先頭 4 バイトの `GRIB` マジックで判定している。
- GFS のランは公開まで 5 時間程度かかる。`candidateRuns()` は 5 時間前を基準に直近 4 サイクルを試す。
- 風データの内部形式は cambecc/earth 互換の GFS JSON(plan.md「風データの形式」参照)。
- レンダラーは contextIsolation 前提。データ取得は必ず preload の IPC 経由にする。
- 地球テクスチャは画像ファイルではなくキャンバス生成。file:// 環境での CORS/taint 問題を避けるため。
- 経緯度 → 3D 座標変換は `src/renderer/globe.ts` の `lonLatToVector3` に統一(SphereGeometry の UV と整合)。
- 開発環境(VSCode 拡張内のターミナル)では `ELECTRON_RUN_AS_NODE` が設定されていることがあり、
  そのままだと Electron が素の Node として起動して失敗する。起動前に解除すること。
- 動作検証は環境変数 `WINDMAP_SCREENSHOT=出力先.png` を付けて起動すると、
  描画 4 秒後にスクリーンショットを保存して自動終了する。
