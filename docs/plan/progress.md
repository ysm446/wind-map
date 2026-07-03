# 進捗

作成日時: 2026-06-12 22:44
更新日時: 2026-07-04 06:48

## 現在の状態

P3 の GPU パーティクル化 + 風速カラーオーバーレイまで完了。
P5(風データDB・時間アニメーション)も完了。
P2b (ERA5、1940 年〜) はユーザーの CDS アカウント登録待ちで保留。
P3 の残りは高度切り替え、0.25° 対応、実星カタログ。

## 完了済み

- 2026-07-04: 取得のキャンセル対応
  - メインプロセスに単一の AbortController (`activeFetch`) を持ち、`fetch:cancel` IPC で
    中断。`fetchGfsWind` / `fetchArchiveWind` / `buildCollection` に AbortSignal を貫通
    (中断時は 'cancelled' を投げ、レンダラーが i18n 済み文言に変換)
  - 区間ビルドのキャンセルは取得済みフレームで finalize(部分保存)。進捗 done に
    `cancelled` フラグを追加
  - UI: 取得中のみ「キャンセル」ボタンを表示(データ取得・保存データの両ペイン)
  - 新しい取得の開始時は前の取得を自動で abort(起動時自動取得との競合も解消)

- 2026-07-04: 投影切替のトランジション改善と UI 移動
  - 切替時、画面中央の地点(地球儀: カメラ直下の経緯度、平面: 注視点の逆メルカトル)を
    注視点として引き継ぎ、地表(地図面)とのカメラ距離も保つ(setProjection)
  - 投影はプルダウン (#proj-select) にし、中央経度とともに「表示設定」ペインへ移動

- 2026-07-04: メニューを 2 ペイン構成へ変更(左ナビ + 右ペイン)
  - `<details>` 折りたたみを廃止し、`#section-nav`(ボタン列)+ `#section-panes`
    (`.pane.active` のみ表示)に変更。パネル幅 256 → 400px
  - 選択中セクションは `panelSection` として settings.json に永続化
  - セクション名短縮: オーバーレイ / 保存データ(i18n も更新)

- 2026-07-04: メニューの 1 行レイアウト化とタイトルクリックでの折りたたみ
  - スライダー・セレクト系の `.control` に `row` クラスを付け、flex +
    `display: contents` で「項目名 | パラメータ | 値」の 1 行に(`style.css`)
  - 項目名が長い場合は省略記号で切り、行内に収まらない付属要素(凡例)は次の行へ全幅
  - パネル幅 240 → 256px、長いラベルは i18n ごと短縮
  - 「Wind Map」タイトルクリックで本体 (#panel-body) を隠しタイトルバーだけに。
    `panelCollapsed` として settings.json に永続化。M キー(完全非表示)とは別機能

- 2026-07-04: 地図の中央経度指定・パーティクル密度均等化・ズーム下限緩和
  - 中央経度: 描画全体を「表示経度 = 実経度 - 中央経度」空間で行う方式。
    メルカトルの切れ目が常にジオメトリの継ぎ目 (表示経度 ±180°) に載るため破綻しない。
    地球儀は回転して見えるだけなので、変更時はカメラを逆回転して見た目を保つ。
    地表テクスチャは内容を横に1枚分ずらした3パス描画で切れ目をまたぐポリゴンに対応。
    ラインは全 LOD を再構築(実経度 ±180° をまたぐ線分は逆に繋がるようになる)
  - 密度: 粒子の再配置緯度分布を uMorph で「球面上で一様 (asin)」⇔「メルカトル地図上で
    一様 (メルカトル Y 一様 → 逆変換)」にブレンド。粒子の寿命サイクルで数秒かけて馴染む
  - ズーム下限: 地球儀 1.4 → 1.2、平面モードは 0.3 (applyProjControls でモード別に設定)

- 2026-07-04: 地球儀 ⇔ メルカトル平面のモーフ切替(`src/renderer/projection.ts`)
  - 全描画要素が経緯度ベースなことを利用し、共通 GLSL(球面位置と平面位置を
    uniform uMorph で mix)を各頂点シェーダーへ注入する方式
    - 地表: MeshBasicMaterial の onBeforeCompile で begin_vertex を差し替え
    - 海岸線・国境線: ShaderMaterial 化し aLonLat 属性を追加
    - オーバーレイ / GPU パーティクル / 蓄積バッファ内の深度用地球: uMorph 追加
    - CPU フォールバック: 軌跡に経緯度履歴を持たせ、モーフ中は再投影
  - 平面は経度0°方向 (+X) を法線に原点を通る配置。半径差 (Z ファイティング回避) は
    法線方向オフセットとして平面でも保たれる。メルカトルは ±85° でクランプ
  - 球ジオメトリの heightSegments は 36 の倍数にして頂点行を 85° に乗せる
    (乗らないと 85° をまたぐ頂点行が帯状に潰れて見える)
  - カメラはモーフ中に正面 (距離 4.8) へ補間。平面モードは回転無効・左ドラッグでパン
  - パネル最上部のチェックボックスで切替、settings.json の `projection` に永続化
  - 平面表示中に日付変更線をまたぐ CPU 粒子はリセット(軌跡が地図を横断しないように)

- 2026-06-13: P5 風データDB・時間アニメーション
  - ファイル型ストア(`src/main/store.ts`)。`userData/wind-db/<id>/` に
    meta.json + frame-XXXX.bin(u/v を Float32 で連結)で保存。一覧は走査で生成
  - 区間ビルド(`src/main/db-build.ts`)。予報シーケンス / 過去アーカイブの両対応、
    逐次取得・進捗通知・部分失敗スキップ・最大240コマ
  - IPC: `db:list` / `db:get` / `db:get-frame` / `db:delete` / `db:rename` /
    `db:build`(進捗は `db:build-progress` イベント)
  - 「保存データ / アニメーション」UI。一覧+削除、新規作成、再生(再生/一時停止・
    スクラブ・速度=秒/コマ・開始/終了位置・ループ・フレーム補間)。全フレームを
    メモリ展開し `applyWind()` で風だけ差し替えて滑らかに連結
  - フレーム補間(既定ON、チェックボックス切替): 再生位置を連続値にし隣接2コマの
    u/v を時間補間。GPU・オーバーレイはテクスチャをその場更新(`writeWindInterp`)。
    CPUフォールバックでは無効
  - `npm run test:db` で保存・読み出し・削除を検証(2025-06-01 の3コマで確認済み)

- 2026-06-13: 表示設定(色のカスタマイズ)
  - パネル内の折りたたみ `<details>` セクション。海岸線・国境線(色 + 不透明度)、
    海・陸・経緯線(テクスチャ再生成、150ms スロットル)、大気光・背景・星、
    「既定に戻す」ボタン
  - パーティクル配色プリセット(標準 / アース / Viridis / Turbo)。`particles.ts` の
    `COLOR_SCHEMES` に定義し、GPU ランプ・CPU 頂点色・オーバーレイ・凡例すべてに反映
  - すべて settings.json に永続化(`colors` ネスト + `particleScheme`)
  - 海岸線・国境線は通常アルファ合成に変更(加算はオーバーレイの明るい下地で白飛びするため)

- 2026-06-13: パーティクル明度スライダー (0.1〜2.0)
  - GPU は軌跡レイヤーの合成時に乗算 (`uBrightness`)、CPU は頂点色に乗算
  - settings.json に永続化 (`brightness`)

- 2026-06-13: 風速カラーオーバーレイ(`src/renderer/overlay.ts`)
  - 風場テクスチャをフラグメントシェーダーで直接サンプリングする半透明球を地表に重ねる
  - 風テクスチャ・カラーランプ生成は `wind-texture.ts` に切り出して GPU パーティクルと共有
  - UI: チェックボックスで ON/OFF、濃度スライダー、speedColor から生成した凡例(0〜35 m/s)
  - ON/OFF と濃度は settings.json に永続化

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

- P3 残り: 等圧面の高度切り替え、0.25° 格子対応、実星カタログによる星空(HYG 等)
- P2b【保留】: ERA5 による過去データ対応(1940 年〜)
  - 前提: ユーザーが https://cds.climate.copernicus.eu/ でアカウントを作成し、
    Personal Access Token を取得する必要がある
  - ERA5 は GRIB1 配信のため、GRIB1 デコーダの追加実装が必要(GRIB2 とは別形式)
- P4: エディタ機能と配布

## 注意点

- UI 設定はアプリ直下の `data/settings.json` に保存される(`.gitignore` 済み)。
  パッケージ化(asar)すると app パス直下は書き込み不可になるため、
  P4 の配布対応時に保存先の見直しが必要(exe 隣接ディレクトリ or userData)。

- 風データDB(P5)は `userData/wind-db/` に保存する(settings.json と違い app 直下
  ではないので、パッケージ化しても書き込める)。フレームは Float32 の生バイナリで、
  1°格子なら約0.5MB/コマ。多区間を貯めると容量が増えるので削除UIで管理する。
  IPC でフレームを返す際は Float32Array をそのまま渡す(構造化複製で効率転送)。

- F12 のスクリーンショットは現状デバッグ目的。保存先がアプリ直下 `data/screenshots/`
  のため、settings.json と同様にパッケージ化(asar)すると書き込めない。配布対応時に
  保存先の見直しが必要(P4 参照)。

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
