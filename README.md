# Wind Map

地球上の風の流れを 3D で可視化するスタンドアロンのデスクトップアプリです。
[earth.nullschool.net](https://earth.nullschool.net/) のような滑らかな流線表現を、
Electron + Three.js でローカルアプリとして実現します。実際の気象データ
(NOAA GFS)を取得して描画し、過去データの保存・時間アニメーションにも対応します。

## 主な機能

- **3D 地球儀** — マウスで回転・ズーム(OrbitControls)。ベクター海岸線・国境線を
  カメラ距離に応じて LOD 切替(Natural Earth 110m / 50m / 10m)。
- **GPU パーティクルによる風の流線** — 粒子状態を浮動小数点テクスチャに持ち、
  ping-pong FBO で移流。画面スペースの蓄積バッファで軌跡を描く。粒子数は
  16,384〜1,048,576 から選択(GPU 非対応環境では CPU 移流にフォールバック)。
- **風速カラーオーバーレイ** — 地表を風速に応じた色で塗る(濃度・配色プリセット可変)。
- **実データの取得**
  - 最新の予報(NOAA GFS / NOMADS、地上 10m 風、予報時刻 +0〜+120h)
  - 過去データ(AWS Open Data の GFS アーカイブ、2021-01-01〜)
  - GRIB2 は純 TypeScript デコーダで展開(外部バイナリ不要)
- **風データの保存と時間アニメーション**
  - 取得した風を「コレクション」としてファイル型 DB に永続保存
  - 一定区間(予報シーケンス / 過去アーカイブ)をまとめて取得して保存
  - 再生 / 一時停止・速度・開始/終了位置・ループ・**フレーム補間**
  - 右下のタイムラインスライダーで時刻を直接スクラブ、**スペースキー**で再生トグル
- **表示設定** — 配色プリセット、各部の色、明度、時刻のタイムゾーン(UTC±)など。
  設定は `settings.json` に永続化。

## 動作環境

- Windows(主たる検証環境)。Electron ベースのため他 OS でも動作する想定。
- Node.js(LTS 推奨)と npm。
- GPU パーティクルには WebGL2 + 浮動小数点レンダーターゲット対応の GPU を推奨
  (非対応時は自動で CPU 移流に切り替わります)。

## セットアップと起動

```bash
npm install      # 依存関係のインストール
npm run build    # レンダラー(Vite)とメイン/preload(esbuild)をビルド
npm start        # アプリを起動 (electron .)
```

開発時はビルドと起動をまとめて行えます。

```bash
npm run dev      # build + start
```

> Windows の一部環境(VSCode 拡張のターミナル等)では `ELECTRON_RUN_AS_NODE` が
> 設定されていることがあり、そのままだと Electron が素の Node として起動して
> 失敗します。起動前にこの環境変数を解除してください。

## 使い方

1. 起動すると、設定によっては最新の GFS データを自動取得して表示します
   (「データ取得」内のチェックボックスで切替)。
2. 左パネルの各セクション(折りたたみ式)で表示や取得を操作します。
   - **データ取得** — 予報時刻を選んで「最新データを取得」、または過去日時を指定して
     「過去データを取得」。
   - **保存データ / アニメーション** — 区間を指定して保存(コレクション化)し、
     一覧から選んで再生。タイムラインスライダーやスペースキーで操作できます。
   - **表示設定** — 配色・色・タイムゾーンなど。
3. 時刻表示・入力欄は設定したタイムゾーン(既定 UTC+9)で扱われます。

## データソース

| 種別 | ソース | 備考 |
|---|---|---|
| 予報 | NOAA GFS(NOMADS GRIB filter) | 無料・認証不要。地上 10m 風 |
| 過去 | AWS Open Data(`noaa-gfs-bdp-pds`) | 2021-01-01〜。`.idx` + HTTP Range で必要分のみ取得 |

現状は 1.0° 格子(3 時間刻み)を使用します。

## アーキテクチャ

```
Electron アプリ
├─ メインプロセス (Node.js)
│   ├─ 気象データのダウンロード (NOMADS / AWS アーカイブ)
│   ├─ GRIB2 → 内部形式への変換(純 TS デコーダ)
│   ├─ 風データDB(userData/wind-db にフレーム単位で保存)
│   └─ IPC でレンダラーへデータ提供
└─ レンダラープロセス (Three.js / WebGL)
    ├─ 3D 地球儀・海岸線・国境線
    ├─ GPU パーティクル移流と軌跡描画
    ├─ 風速カラーオーバーレイ
    └─ UI(取得・保存・再生・表示設定)
```

- セキュリティ方針: `contextIsolation: true` / `nodeIntegration: false`。
  レンダラーからのデータ取得は preload 経由の IPC に限定。
- 風データの内部形式は cambecc/earth 互換の GFS JSON。

## ディレクトリ構成

```
src/
  main/        メインプロセス (main, preload, nomads, archive, grib2, store, db-build)
  renderer/    レンダラー (globe, gpu-particles, overlay, wind, main, style ...)
scripts/       取得・保存の単体検証スクリプト
docs/          目的・計画・進捗・変更履歴・設計資料
assets/        同梱サンプルデータ
```

## 開発用スクリプト

```bash
npm run test:nomads    # NOMADS からの取得を検証
npm run test:archive   # AWS アーカイブからの取得を検証
npm run test:db        # 風データDB の保存・読み出し・削除を検証 (Electron 上)
```

## データの保存先

- UI 設定: アプリ直下の `data/settings.json`
- 取得キャッシュ: `userData/wind-cache/`
- 風データDB: `userData/wind-db/`(コレクションごとに `meta.json` + フレームのバイナリ)

## 補足・制限

- GFS のランは公開まで 5 時間程度かかるため、「最新」でも数時間前の解析が基準になります。
- NOMADS の OpenDAP(DODS)は 2025 年に廃止済みのため、GRIB filter を利用します。
- 0.25° 格子(1 時間刻み)、等圧面の高度切替、ERA5(1940 年〜)などは今後の課題です。
  詳細は `docs/plan/plan.md` を参照してください。

## ライセンス

private(個人プロジェクト)。
