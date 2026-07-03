import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Globe, createCoastlines, createBorders, lonLatToVector3 } from './globe';
import { MAP_CAMERA_DIST } from './projection';
import { WindField, makeSyntheticWind } from './wind';
import { ParticleSystem, COLOR_SCHEMES, type ColorStops } from './particles';
import { GpuParticleSystem } from './gpu-particles';
import { SpeedOverlay } from './overlay';
import { RAMP_MAX_SPEED } from './wind-texture';
import {
  t,
  setLang,
  getLang,
  applyStaticI18n,
  tBuildRunning,
  tBuildDone,
  tConfirmDelete,
  type Lang,
} from './i18n';

// 表示設定の既定色。index.html の input の初期値と一致させておく
const DEFAULT_COLORS: Required<ColorSettings> = {
  coastline: '#9db4d6',
  coastlineOpacity: 0.5,
  border: '#8593a8',
  borderOpacity: 0.3,
  ocean: '#0c1422',
  land: '#1d2939',
  graticule: '#ffffff',
  halo: '#4a7fc9',
  background: '#0a0e14',
  stars: '#5a6a82',
};

const GLOBE_RADIUS = 1;
const PARTICLE_RADIUS = 1.004; // 地表より少し浮かせて Z ファイティングを避ける

// ズーム範囲。下限はカメラの near (0.1) を切らない程度に近づける
const GLOBE_MIN_DIST = 1.2; // 地球儀モード (地表から 0.2)
const MAP_MIN_DIST = 0.3; // 平面モード (地図面から 0.3)
const MAX_DIST = 8;

// データソースの種別キー → i18n キー
const SOURCE_KEY: Record<string, string> = {
  cache: 'srcCache',
  sample: 'srcSample',
  nomads: 'srcNomads',
  archive: 'srcArchiveData',
};

// 時刻表示のタイムゾーンオフセット(時間)。設定で変更でき、UTC からのずれを表す。
let displayTz = 9; // 既定は日本時間 (UTC+9)

// "UTC" / "UTC+9" / "UTC-5" のようなラベル
function tzLabel(): string {
  if (displayTz === 0) return 'UTC';
  const sign = displayTz > 0 ? '+' : '-';
  return `UTC${sign}${Math.abs(displayTz)}`;
}

// UTC の ms を、選択中タイムゾーンの壁時計時刻に直した ISO 文字列(末尾 Z は名目)
function isoInTz(ms: number): string {
  return new Date(ms + displayTz * 3600_000).toISOString();
}

// datetime-local の入力値(選択中タイムゾーンの壁時計時刻)を UTC の ISO へ変換する
function tzInputToUtcIso(value: string): string {
  return new Date(Date.parse(`${value}:00Z`) - displayTz * 3600_000).toISOString();
}

// UTC の ms を datetime-local 入力用(選択中タイムゾーンの壁時計、"YYYY-MM-DDTHH:MM")へ
function tzInputValue(ms: number): string {
  return isoInTz(ms).slice(0, 16);
}

// 例: "GFS NOMADS / 2026-06-12 12:00 UTC+9 (+6h)"
function describeField(field: WindField, sourceName: string): string {
  if (!field.refTime) return sourceName;
  const fh = field.forecastTime ?? 0;
  const validMs = new Date(field.refTime).getTime() + fh * 3600_000;
  const time = isoInTz(validMs).slice(0, 16).replace('T', ' ');
  const fhLabel = fh > 0 ? ` (+${fh}h)` : '';
  return `${sourceName} / ${time} ${tzLabel()}${fhLabel}`;
}

async function loadWindField(): Promise<{ field: WindField; source: string | null }> {
  try {
    const result = await window.windApi.getWindData();
    if (result) {
      const field = WindField.fromGfsJson(result.records);
      if (field) {
        return { field, source: result.source };
      }
    }
  } catch (err) {
    console.error('wind data load failed', err);
  }
  return { field: makeSyntheticWind(), source: null };
}

async function init(): Promise<void> {
  const container = document.getElementById('app')!;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEFAULT_COLORS.background);

  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  camera.position.set(0, 0.8, 3.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = GLOBE_MIN_DIST;
  controls.maxDistance = MAX_DIST;
  controls.rotateSpeed = 0.5;

  const globe = new Globe(
    GLOBE_RADIUS,
    { ocean: DEFAULT_COLORS.ocean, land: DEFAULT_COLORS.land, graticule: DEFAULT_COLORS.graticule },
    DEFAULT_COLORS.halo,
  );
  scene.add(globe.group);

  // ベクター海岸線・国境線 (LOD 付き)。地表より少し浮かせて Z ファイティングを避ける
  const coastlines = createCoastlines(GLOBE_RADIUS * 1.0015);
  const borders = createBorders(GLOBE_RADIUS * 1.0014);
  scene.add(coastlines.group);
  scene.add(borders.group);

  // 風速カラーオーバーレイ。海岸線・国境線より下、地表より上に重ねる
  const overlay = new SpeedOverlay(GLOBE_RADIUS * 1.0008);
  scene.add(overlay.mesh);

  // 薄い星空
  const starsMat = new THREE.PointsMaterial({
    color: DEFAULT_COLORS.stars,
    size: 0.06,
    sizeAttenuation: true,
  });
  {
    const starCount = 1200;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const v = new THREE.Vector3()
        .randomDirection()
        .multiplyScalar(40 + Math.random() * 20);
      positions.set([v.x, v.y, v.z], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    scene.add(new THREE.Points(geometry, starsMat));
  }

  const gpuSupported = GpuParticleSystem.isSupported(renderer);
  let gpuParticles: GpuParticleSystem | null = null;
  let cpuParticles: ParticleSystem | null = null;
  let windField: WindField | null = null;

  const countSelect = document.getElementById('count') as HTMLSelectElement;
  const speedSlider = document.getElementById('speed') as HTMLInputElement;
  const speedValue = document.getElementById('speed-value')!;
  const brightnessSlider = document.getElementById('brightness') as HTMLInputElement;
  const brightnessValue = document.getElementById('brightness-value')!;
  const trailSlider = document.getElementById('trail') as HTMLInputElement;
  const trailValue = document.getElementById('trail-value')!;
  const overlayCheck = document.getElementById('overlay') as HTMLInputElement;
  const overlayDetail = document.getElementById('overlay-detail')!;
  const overlayOpacity = document.getElementById('overlay-opacity') as HTMLInputElement;
  const overlayOpacityValue = document.getElementById('overlay-opacity-value')!;
  const fcstSlider = document.getElementById('fcst') as HTMLInputElement;
  const fcstValue = document.getElementById('fcst-value')!;
  const fetchBtn = document.getElementById('fetch-btn') as HTMLButtonElement;
  const autoFetchCheck = document.getElementById('auto-fetch') as HTMLInputElement;
  const fetchStatus = document.getElementById('fetch-status')!;
  const dataSourceEl = document.getElementById('data-source')!;
  const fpsEl = document.getElementById('fps')!;
  const dateDisplayDate = document.getElementById('date-display-date')!;
  const dateDisplayTime = document.getElementById('date-display-time')!;
  const schemeSelect = document.getElementById('scheme') as HTMLSelectElement;
  const colorsResetBtn = document.getElementById('colors-reset') as HTMLButtonElement;
  const tzSlider = document.getElementById('tz') as HTMLInputElement;
  const tzValue = document.getElementById('tz-value')!;
  const projMapCheck = document.getElementById('proj-map') as HTMLInputElement;
  const centerLonSlider = document.getElementById('center-lon') as HTMLInputElement;
  const centerLonValue = document.getElementById('center-lon-value')!;
  const showFpsCheck = document.getElementById('show-fps') as HTMLInputElement;
  const showLegendCheck = document.getElementById('show-legend') as HTMLInputElement;
  const legendEl = document.getElementById('legend')!;
  const legendBar = legendEl.querySelector<HTMLElement>('.legend-bar')!;
  const legendScale = legendEl.querySelector<HTMLElement>('.legend-scale')!;
  const langSelect = document.getElementById('lang') as HTMLSelectElement;

  // 色設定の input 要素。キーは ColorSettings / DEFAULT_COLORS と対応する
  const colorEl = (id: string) => document.getElementById(id) as HTMLInputElement;
  const colorInputs = {
    coastline: colorEl('col-coast'),
    border: colorEl('col-border'),
    ocean: colorEl('col-ocean'),
    land: colorEl('col-land'),
    graticule: colorEl('col-grat'),
    halo: colorEl('col-halo'),
    background: colorEl('col-bg'),
    stars: colorEl('col-stars'),
  } as const;
  const coastOpInput = colorEl('col-coast-op');
  const borderOpInput = colorEl('col-border-op');

  // 保存済みの UI 設定 (data/settings.json) を起動時に反映する
  function applySettings(s: AppSettings | null): void {
    if (!s) return;
    if (
      s.particleTexSize &&
      Array.from(countSelect.options).some((o) => Number(o.value) === s.particleTexSize)
    ) {
      countSelect.value = String(s.particleTexSize);
    }
    if (typeof s.speed === 'number' && Number.isFinite(s.speed)) {
      speedSlider.value = String(Math.min(1, Math.max(0.1, s.speed)));
      speedValue.textContent = Number(speedSlider.value).toFixed(1);
    }
    if (typeof s.brightness === 'number' && Number.isFinite(s.brightness)) {
      brightnessSlider.value = String(Math.min(2, Math.max(0.1, s.brightness)));
      brightnessValue.textContent = Number(brightnessSlider.value).toFixed(2);
    }
    if (typeof s.trail === 'number' && Number.isFinite(s.trail)) {
      trailSlider.value = String(Math.min(256, Math.max(4, Math.round(s.trail))));
      trailValue.textContent = trailSlider.value;
    }
    if (typeof s.forecastHour === 'number' && Number.isFinite(s.forecastHour)) {
      fcstSlider.value = String(Math.min(120, Math.max(0, Math.round(s.forecastHour / 3) * 3)));
      fcstValue.textContent = `+${fcstSlider.value}h`;
    }
    if (typeof s.overlay === 'boolean') overlayCheck.checked = s.overlay;
    if (typeof s.overlayOpacity === 'number' && Number.isFinite(s.overlayOpacity)) {
      overlayOpacity.value = String(Math.min(1, Math.max(0.1, s.overlayOpacity)));
    }
    if (typeof s.particleScheme === 'string' && s.particleScheme in COLOR_SCHEMES) {
      schemeSelect.value = s.particleScheme;
    }
    if (typeof s.tz === 'number' && Number.isFinite(s.tz)) {
      displayTz = Math.min(14, Math.max(-12, Math.round(s.tz)));
      tzSlider.value = String(displayTz);
    }
    if (s.projection === 'map') projMapCheck.checked = true;
    if (typeof s.mapCenterLon === 'number' && Number.isFinite(s.mapCenterLon)) {
      const v = Math.min(180, Math.max(-180, Math.round(s.mapCenterLon / 15) * 15));
      centerLonSlider.value = String(v);
    }
    if (typeof s.autoFetch === 'boolean') autoFetchCheck.checked = s.autoFetch;
    if (typeof s.showFps === 'boolean') showFpsCheck.checked = s.showFps;
    if (typeof s.showLegend === 'boolean') showLegendCheck.checked = s.showLegend;
    if (s.lang === 'ja' || s.lang === 'en') {
      setLang(s.lang);
      langSelect.value = s.lang;
    }
    if (s.colors) {
      const hex = /^#[0-9a-fA-F]{6}$/;
      for (const key of Object.keys(colorInputs) as Array<keyof typeof colorInputs>) {
        const v = s.colors[key];
        if (typeof v === 'string' && hex.test(v)) colorInputs[key].value = v;
      }
      if (typeof s.colors.coastlineOpacity === 'number' && Number.isFinite(s.colors.coastlineOpacity)) {
        coastOpInput.value = String(Math.min(1, Math.max(0, s.colors.coastlineOpacity)));
      }
      if (typeof s.colors.borderOpacity === 'number' && Number.isFinite(s.colors.borderOpacity)) {
        borderOpInput.value = String(Math.min(1, Math.max(0, s.colors.borderOpacity)));
      }
    }
  }

  let saveTimer: number | undefined;
  function scheduleSave(): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      window.windApi
        .saveSettings({
          particleTexSize: Number(countSelect.value),
          speed: Number(speedSlider.value),
          brightness: Number(brightnessSlider.value),
          trail: Number(trailSlider.value),
          forecastHour: Number(fcstSlider.value),
          overlay: overlayCheck.checked,
          overlayOpacity: Number(overlayOpacity.value),
          particleScheme: schemeSelect.value,
          projection: projMapCheck.checked ? 'map' : 'globe',
          mapCenterLon: Number(centerLonSlider.value),
          tz: displayTz,
          autoFetch: autoFetchCheck.checked,
          showFps: showFpsCheck.checked,
          showLegend: showLegendCheck.checked,
          lang: getLang(),
          colors: {
            coastline: colorInputs.coastline.value,
            coastlineOpacity: Number(coastOpInput.value),
            border: colorInputs.border.value,
            borderOpacity: Number(borderOpInput.value),
            ocean: colorInputs.ocean.value,
            land: colorInputs.land.value,
            graticule: colorInputs.graticule.value,
            halo: colorInputs.halo.value,
            background: colorInputs.background.value,
            stars: colorInputs.stars.value,
          },
        })
        .catch((err) => console.error('settings save failed', err));
    }, 500);
  }

  applySettings(await window.windApi.getSettings().catch(() => null));

  // --- 投影モード (地球儀 ⇔ メルカトル平面のモーフ) ---
  const MORPH_DURATION = 1.4; // モーフにかける秒数
  const proj = { value: 0, target: 0 }; // 0=地球儀, 1=平面
  // モーフ中のカメラ移動先。null なら遷移中ではない
  let camAnim: { pos: THREE.Vector3; tgt: THREE.Vector3 } | null = null;

  // smoothstep で緩急をつけたモーフ量
  const easedMorph = (): number => proj.value * proj.value * (3 - 2 * proj.value);

  function applyMorph(): void {
    const e = easedMorph();
    globe.setMorph(e);
    coastlines.setMorph(e);
    borders.setMorph(e);
    overlay.setMorph(e);
    if (gpuParticles) gpuParticles.setMorph(e);
    if (cpuParticles) cpuParticles.morph = e;
  }

  // 遷移完了後の OrbitControls 設定。平面では回転を無効化し、左ドラッグをパンにする
  function applyProjControls(): void {
    const map = proj.target === 1;
    controls.enableRotate = !map;
    controls.enablePan = map;
    controls.screenSpacePanning = true;
    controls.minDistance = map ? MAP_MIN_DIST : GLOBE_MIN_DIST;
    controls.mouseButtons.LEFT = map ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = map ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    controls.enabled = true;
  }

  function setProjection(map: boolean): void {
    proj.target = map ? 1 : 0;
    if (map) {
      // 地図の中心 (表示経度0° = +X 方向) の正面、全体が収まる距離へ
      camAnim = { pos: new THREE.Vector3(MAP_CAMERA_DIST, 0, 0), tgt: new THREE.Vector3() };
    } else {
      // 現在の視線方向を保ったまま、地球儀の距離レンジに収めて戻る
      const dist = Math.min(MAX_DIST, Math.max(GLOBE_MIN_DIST, camera.position.length()));
      camAnim = {
        pos: camera.position.clone().normalize().multiplyScalar(dist),
        tgt: new THREE.Vector3(),
      };
    }
    controls.enabled = false; // 遷移中は手動でカメラを動かす
  }

  projMapCheck.addEventListener('change', () => {
    setProjection(projMapCheck.checked);
    scheduleSave();
  });

  // --- 地図の中央経度 ---
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  let appliedCenterLon = 0;

  // "0°" / "135°E" / "90°W" / "180°"
  function centerLonLabel(v: number): string {
    if (v === 0) return '0°';
    if (v === 180 || v === -180) return '180°';
    return v > 0 ? `${v}°E` : `${-v}°W`;
  }

  // 中央経度を全描画要素へ反映する。描画は「表示経度 = 実経度 - 中央経度」の空間で
  // 行われるため、地球儀は回転して見えるだけで、メルカトルの切れ目が
  // ジオメトリの継ぎ目 (表示経度 ±180°) に載ったまま任意の位置で切れる
  function applyCenterLonNow(rotateCamera: boolean): void {
    const c = Number(centerLonSlider.value);
    if (c === appliedCenterLon) return;
    const delta = c - appliedCenterLon;
    appliedCenterLon = c;
    globe.setCenterLon(c);
    coastlines.setCenterLon(c);
    borders.setCenterLon(c);
    overlay.setCenterLon(c);
    if (gpuParticles) gpuParticles.setCenterLon(c);
    if (cpuParticles) cpuParticles.centerLon = c;
    // 地球儀モードでは表示空間の回転に合わせてカメラも回し、見た目を変えない
    if (rotateCamera && proj.target === 0 && !camAnim) {
      camera.position.applyAxisAngle(Y_AXIS, (-delta * Math.PI) / 180);
    }
  }

  // テクスチャ再生成・ライン再構築を伴うので、スライダー操作中は 200ms に 1 回へ間引く
  let centerLonTimer: number | undefined;
  centerLonSlider.addEventListener('input', () => {
    centerLonValue.textContent = centerLonLabel(Number(centerLonSlider.value));
    if (centerLonTimer === undefined) {
      centerLonTimer = window.setTimeout(() => {
        centerLonTimer = undefined;
        applyCenterLonNow(true);
      }, 200);
    }
    scheduleSave();
  });

  // 起動時の反映 (カメラはまだ配置前なので回さない)
  centerLonValue.textContent = centerLonLabel(Number(centerLonSlider.value));
  applyCenterLonNow(false);

  if (projMapCheck.checked) {
    // 保存済み設定が平面なら、モーフ済みの状態から開始する
    proj.value = proj.target = 1;
    applyMorph();
    camera.position.set(MAP_CAMERA_DIST, 0, 0);
    controls.update();
    applyProjControls();
  } else {
    // 起動時、設定タイムゾーンに対応する経度 (オフセット×15°) を正面へ向ける。
    // 例: UTC+9 → 東経135° (日本付近)。緯度は既定の少し見下ろす画角のまま。
    // 描画は表示経度空間なので中央経度ぶんを差し引く
    const dir = lonLatToVector3(displayTz * 15 - appliedCenterLon, 0, 1);
    const r = 3.2;
    camera.position.set(dir.x * r, 0.8, dir.z * r);
    controls.update();
  }

  function currentStops(): ColorStops {
    return COLOR_SCHEMES[schemeSelect.value] ?? COLOR_SCHEMES.standard;
  }

  // 配色ストップから linear-gradient の CSS を作る(凡例の色を粒子と一致させる)
  function gradientCss(stops: ColorStops): string {
    return `linear-gradient(to right, ${stops
      .map(([s, [r, g, b]]) => `rgb(${r}, ${g}, ${b}) ${((s / RAMP_MAX_SPEED) * 100).toFixed(1)}%`)
      .join(', ')})`;
  }

  // オーバーレイ濃度欄の凡例(メニュー内)
  function renderLegend(stops: ColorStops): void {
    const bar = overlayDetail.querySelector<HTMLElement>('#speed-legend .bar')!;
    bar.style.background = gradientCss(stops);
  }

  // 左下の風速カラースケール凡例(画面上)。目盛りは 0〜35 m/s。
  function renderScreenLegend(stops: ColorStops): void {
    legendBar.style.background = gradientCss(stops);
    const ticks = [0, 10, 20, 30, RAMP_MAX_SPEED];
    legendScale.innerHTML = ticks
      .map((v, i) => {
        const pct = (v / RAMP_MAX_SPEED) * 100;
        const tf = i === 0 ? '0' : i === ticks.length - 1 ? '-100%' : '-50%';
        return `<span style="left:${pct.toFixed(1)}%;transform:translateX(${tf})">${v}</span>`;
      })
      .join('');
  }

  // 配色プリセットを粒子・オーバーレイ・凡例へ反映する
  function applyScheme(): void {
    const stops = currentStops();
    if (gpuParticles) gpuParticles.setColorStops(stops);
    if (cpuParticles) cpuParticles.colorStops = stops;
    overlay.setColorStops(stops);
    renderLegend(stops);
    renderScreenLegend(stops);
  }

  // 地表テクスチャの再生成は重いので、ピッカー操作中は 150ms に 1 回へ間引く
  let surfaceTimer: number | undefined;
  function applySurfaceColors(): void {
    if (surfaceTimer !== undefined) return;
    surfaceTimer = window.setTimeout(() => {
      surfaceTimer = undefined;
      globe.setSurfaceColors({
        ocean: colorInputs.ocean.value,
        land: colorInputs.land.value,
        graticule: colorInputs.graticule.value,
      });
    }, 150);
  }

  function applyColors(): void {
    coastlines.setColor(colorInputs.coastline.value);
    coastlines.setOpacity(Number(coastOpInput.value));
    borders.setColor(colorInputs.border.value);
    borders.setOpacity(Number(borderOpInput.value));
    globe.setHaloColor(colorInputs.halo.value);
    (scene.background as THREE.Color).set(colorInputs.background.value);
    starsMat.color.set(colorInputs.stars.value);
    applySurfaceColors();
  }
  applyColors();
  applyScheme();

  for (const input of [...Object.values(colorInputs), coastOpInput, borderOpInput]) {
    input.addEventListener('input', () => {
      applyColors();
      scheduleSave();
    });
  }
  schemeSelect.addEventListener('change', () => {
    applyScheme();
    scheduleSave();
  });
  colorsResetBtn.addEventListener('click', () => {
    for (const key of Object.keys(colorInputs) as Array<keyof typeof colorInputs>) {
      colorInputs[key].value = DEFAULT_COLORS[key];
    }
    coastOpInput.value = String(DEFAULT_COLORS.coastlineOpacity);
    borderOpInput.value = String(DEFAULT_COLORS.borderOpacity);
    schemeSelect.value = 'standard';
    applyColors();
    applyScheme();
    scheduleSave();
  });

  // チェックボックス・スライダーの現在値をオーバーレイへ反映する
  function syncOverlay(): void {
    overlay.setEnabled(overlayCheck.checked);
    overlay.setOpacity(Number(overlayOpacity.value));
    overlayOpacityValue.textContent = Number(overlayOpacity.value).toFixed(2);
    overlayDetail.classList.toggle('disabled', !overlayCheck.checked);
  }
  syncOverlay();

  // 軌跡スライダー値 (4〜256) を蓄積バッファの減衰率に変換する
  function trailFadeFromSlider(): number {
    const len = Number(trailSlider.value);
    return Math.min(0.995, Math.max(0.6, 1 - 1.5 / len));
  }

  function rebuildParticles(): void {
    if (!windField) return;
    if (gpuParticles) {
      gpuParticles.dispose();
      gpuParticles = null;
    }
    if (cpuParticles) {
      scene.remove(cpuParticles.object3d);
      cpuParticles.dispose();
      cpuParticles = null;
    }
    if (gpuSupported) {
      gpuParticles = new GpuParticleSystem(
        renderer,
        windField,
        Number(countSelect.value),
        PARTICLE_RADIUS,
        GLOBE_RADIUS,
        easedMorph(),
      );
      gpuParticles.speedFactor = Number(speedSlider.value);
      gpuParticles.trailFade = trailFadeFromSlider();
      gpuParticles.brightness = Number(brightnessSlider.value);
      gpuParticles.setColorStops(currentStops());
      gpuParticles.setCenterLon(appliedCenterLon);
    } else {
      // GPU 非対応環境では CPU 移流(粒子数固定)にフォールバック。
      // 軌跡は頂点数に直結するため CPU では 64 点までに抑える
      cpuParticles = new ParticleSystem(
        6000,
        PARTICLE_RADIUS,
        windField,
        Math.min(64, Number(trailSlider.value)),
      );
      cpuParticles.speedFactor = Number(speedSlider.value);
      cpuParticles.brightness = Number(brightnessSlider.value);
      cpuParticles.colorStops = currentStops();
      cpuParticles.morph = easedMorph();
      cpuParticles.centerLon = appliedCenterLon;
      scene.add(cpuParticles.object3d);
    }
  }

  // 各数字を固定幅セル (.dg) で包み、桁ごとの字幅差による横ずれを防ぐ。
  // 値は数値・tzLabel のみなので HTML 挿入の危険はない。
  const wrapDigits = (s: string): string => s.replace(/\d/g, (d) => `<span class="dg">${d}</span>`);

  // 右下の大きな日付表示(選択中タイムゾーン)
  function setDateDisplayMs(ms: number): void {
    const iso = isoInTz(ms);
    dateDisplayDate.innerHTML = wrapDigits(iso.slice(0, 10));
    dateDisplayTime.innerHTML = wrapDigits(`${iso.slice(11, 16)} ${tzLabel()}`);
  }

  // フィールドの有効日時を表示する。合成風場など有効日時のないデータでは消す
  function updateDateDisplay(field: WindField): void {
    if (!field.refTime) {
      dateDisplayDate.textContent = '';
      dateDisplayTime.textContent = '';
      return;
    }
    setDateDisplayMs(fieldValidMs(field));
  }

  // フィールドの有効日時 (ms)。補間時刻の算出に使う
  function fieldValidMs(field: WindField): number {
    const ref = field.refTime ? new Date(field.refTime).getTime() : Date.now();
    return ref + (field.forecastTime ?? 0) * 3600_000;
  }

  // 新しい風場の適用。粒子と軌跡は保ったまま風だけ差し替える
  function applyWind(field: WindField): void {
    windField = field;
    updateDateDisplay(field);
    overlay.setWind(field);
    if (gpuParticles) gpuParticles.setWind(field);
    else if (cpuParticles) cpuParticles.setWind(field);
    else rebuildParticles();
  }

  if (!gpuSupported) {
    countSelect.disabled = true;
    countSelect.title = 'GPU パーティクル非対応環境のため固定 (6000)';
  }

  countSelect.addEventListener('change', () => {
    rebuildParticles();
    scheduleSave();
  });
  speedSlider.addEventListener('input', () => {
    speedValue.textContent = Number(speedSlider.value).toFixed(1);
    if (gpuParticles) gpuParticles.speedFactor = Number(speedSlider.value);
    if (cpuParticles) cpuParticles.speedFactor = Number(speedSlider.value);
    scheduleSave();
  });
  brightnessSlider.addEventListener('input', () => {
    brightnessValue.textContent = Number(brightnessSlider.value).toFixed(2);
    if (gpuParticles) gpuParticles.brightness = Number(brightnessSlider.value);
    if (cpuParticles) cpuParticles.brightness = Number(brightnessSlider.value);
    scheduleSave();
  });
  trailSlider.addEventListener('input', () => {
    trailValue.textContent = trailSlider.value;
    if (gpuParticles) gpuParticles.trailFade = trailFadeFromSlider();
    scheduleSave();
  });
  trailSlider.addEventListener('change', () => {
    if (cpuParticles) rebuildParticles();
  });
  overlayCheck.addEventListener('change', () => {
    syncOverlay();
    scheduleSave();
  });
  overlayOpacity.addEventListener('input', () => {
    syncOverlay();
    scheduleSave();
  });
  fcstSlider.addEventListener('input', () => {
    fcstValue.textContent = `+${fcstSlider.value}h`;
    scheduleSave();
  });
  const histTime = document.getElementById('hist-time') as HTMLInputElement;
  const histBtn = document.getElementById('hist-btn') as HTMLButtonElement;

  // 既定値: 1 年前の 0 時(選択中タイムゾーンで表示)。上限は現在時刻
  {
    const now = new Date();
    const pastMs = Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate());
    histTime.value = tzInputValue(pastMs);
  }

  // 現在表示中のデータ情報。タイムゾーン・言語変更時にラベルを作り直すため保持する
  let curField: WindField | null = null;
  let curSourceKey: string | null = null;
  let curCollection: { name: string; n: number } | null = null;
  function refreshSourceLabel(): void {
    if (curCollection) {
      dataSourceEl.textContent =
        t('dataPrefix') +
        curCollection.name +
        t('savedTag') +
        ' / ' +
        curCollection.n +
        t('framesUnit');
    } else if (curField && curField.refTime && curSourceKey) {
      dataSourceEl.textContent = t('dataPrefix') + describeField(curField, t(SOURCE_KEY[curSourceKey]));
    } else if (curField) {
      dataSourceEl.textContent = t('dataPrefix') + t('synthetic');
    }
  }

  async function runFetch(fetcher: () => Promise<WindApiResult>): Promise<void> {
    fetchBtn.disabled = true;
    histBtn.disabled = true;
    fetchStatus.textContent = t('fetching');
    try {
      const result = await fetcher();
      const field = WindField.fromGfsJson(result.records);
      if (!field) throw new Error(t('cannotParse'));
      applyWind(field);
      curField = field;
      curSourceKey = result.source;
      curCollection = null;
      refreshSourceLabel();
      fetchStatus.textContent = t('fetchDone');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // IPC 経由のエラーは定型の前置きが付くので除去する
      fetchStatus.textContent = `${t('fetchFail')}${message.replace(/^Error invoking remote method '[^']+': Error: /, '')}`;
    } finally {
      fetchBtn.disabled = false;
      histBtn.disabled = false;
    }
  }

  autoFetchCheck.addEventListener('change', scheduleSave);
  function syncFps(): void {
    fpsEl.classList.toggle('hidden', !showFpsCheck.checked);
  }
  syncFps();
  showFpsCheck.addEventListener('change', () => {
    syncFps();
    scheduleSave();
  });
  function syncLegend(): void {
    legendEl.classList.toggle('hidden', !showLegendCheck.checked);
  }
  syncLegend();
  showLegendCheck.addEventListener('change', () => {
    syncLegend();
    scheduleSave();
  });
  fetchBtn.addEventListener('click', () => {
    void runFetch(() => window.windApi.fetchWind(Number(fcstSlider.value)));
  });
  histBtn.addEventListener('click', () => {
    if (!histTime.value) {
      fetchStatus.textContent = t('enterDateTime');
      return;
    }
    // datetime-local の値は選択中タイムゾーンの壁時計時刻として解釈し UTC に直す
    void runFetch(() => window.windApi.fetchArchiveWind(tzInputToUtcIso(histTime.value)));
  });

  // --- 風データDB / アニメーション ---
  const dbList = document.getElementById('db-list')!;
  const dbName = document.getElementById('db-name') as HTMLInputElement;
  const dbSource = document.getElementById('db-source') as HTMLSelectElement;
  const dbArchiveFields = document.getElementById('db-archive-fields')!;
  const dbForecastFields = document.getElementById('db-forecast-fields')!;
  const dbStart = document.getElementById('db-start') as HTMLInputElement;
  const dbEnd = document.getElementById('db-end') as HTMLInputElement;
  const dbFcstStart = document.getElementById('db-fcst-start') as HTMLInputElement;
  const dbFcstStartValue = document.getElementById('db-fcst-start-value')!;
  const dbFcstEnd = document.getElementById('db-fcst-end') as HTMLInputElement;
  const dbFcstEndValue = document.getElementById('db-fcst-end-value')!;
  const dbStep = document.getElementById('db-step') as HTMLInputElement;
  const dbStepValue = document.getElementById('db-step-value')!;
  const dbBuildBtn = document.getElementById('db-build-btn') as HTMLButtonElement;
  const dbBuildStatus = document.getElementById('db-build-status')!;
  const dbPlayer = document.getElementById('db-player') as HTMLElement;
  const dbPlayerName = document.getElementById('db-player-name')!;
  const dbFrameLabel = document.getElementById('db-frame-label')!;
  const dbScrub = document.getElementById('db-scrub') as HTMLInputElement;
  const dbPlay = document.getElementById('db-play') as HTMLButtonElement;
  const dbSpeed = document.getElementById('db-speed') as HTMLInputElement;
  const dbSpeedValue = document.getElementById('db-speed-value')!;
  const dbIn = document.getElementById('db-in') as HTMLInputElement;
  const dbInValue = document.getElementById('db-in-value')!;
  const dbOut = document.getElementById('db-out') as HTMLInputElement;
  const dbOutValue = document.getElementById('db-out-value')!;
  const dbInterp = document.getElementById('db-interp') as HTMLInputElement;
  const dbLoop = document.getElementById('db-loop') as HTMLInputElement;
  const timelineBar = document.getElementById('timeline-bar') as HTMLElement;
  const timeline = document.getElementById('timeline') as HTMLInputElement;

  // 再生状態。frames は読み込み済みの風場をメモリに保持する。
  // pos は連続位置(フレーム単位)で、補間時は小数部を 2 コマの混合率に使う。
  const player = {
    id: null as string | null,
    frames: [] as WindField[],
    times: [] as number[], // 各フレームの有効日時 (ms)
    pos: 0,
    playing: false,
    inPoint: 0,
    outPoint: 0,
    frameDuration: 0.5, // 秒/コマ
    appliedIndex: -1, // 離散再生で最後に適用したコマ(再確保を避けるため)
  };
  let lastPlayTime = 0;

  // 補間は GPU パーティクル経路でのみ行う(CPU フォールバックは離散)
  const canInterp = (): boolean => gpuParticles !== null && dbInterp.checked;

  const listSourceLabel = (s: 'forecast' | 'archive'): string =>
    s === 'forecast' ? t('listForecast') : t('listArchive');

  function shortTime(iso: string | null): string {
    return iso ? isoInTz(new Date(iso).getTime()).slice(0, 16).replace('T', ' ') : '—';
  }

  function renderDbList(items: CollectionSummary[]): void {
    dbList.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'db-empty';
      empty.textContent = t('noCollections');
      dbList.appendChild(empty);
      return;
    }
    for (const c of items) {
      const item = document.createElement('div');
      item.className = 'db-item' + (c.id === player.id ? ' active' : '');
      const info = document.createElement('div');
      info.className = 'db-info';
      const name = document.createElement('div');
      name.className = 'db-name';
      name.textContent = c.name;
      const sub = document.createElement('div');
      sub.className = 'db-sub';
      sub.textContent = `${listSourceLabel(c.source)} · ${shortTime(c.start)}〜${shortTime(c.end)} · ${c.frameCount}${t('framesUnit')}`;
      info.append(name, sub);
      const del = document.createElement('button');
      del.className = 'db-del';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        void deleteCollection(c.id, c.name);
      });
      item.append(info, del);
      item.addEventListener('click', () => void loadCollection(c.id));
      dbList.appendChild(item);
    }
  }

  async function refreshDbList(): Promise<void> {
    const items = await window.windApi.dbList().catch(() => [] as CollectionSummary[]);
    renderDbList(items);
  }

  async function deleteCollection(id: string, name: string): Promise<void> {
    if (!window.confirm(tConfirmDelete(name))) return;
    await window.windApi.dbDelete(id).catch((err) => console.error('db delete failed', err));
    if (player.id === id) {
      player.id = null;
      player.frames = [];
      player.playing = false;
      dbPlayer.hidden = true;
      timelineBar.hidden = true;
    }
    await refreshDbList();
  }

  // 現在の連続位置 (player.pos) を地球へ反映する。
  // 補間 ON かつ小数位置なら隣接 2 コマを混ぜ、それ以外は最寄りコマを表示する。
  function applyAtPos(): void {
    const n = player.frames.length;
    if (!n) return;
    const maxIdx = n - 1;
    const pos = Math.max(0, Math.min(maxIdx, player.pos));
    const i0 = Math.floor(pos);
    const frac = pos - i0;

    if (canInterp() && frac > 1e-3 && i0 + 1 <= maxIdx) {
      const a = player.frames[i0];
      const b = player.frames[i0 + 1];
      gpuParticles!.setWindInterp(a, b, frac);
      overlay.setWindInterp(a, b, frac);
      windField = a; // 粒子再構築時の基準(次フレームで補間が上書きする)
      const tms = player.times[i0] + (player.times[i0 + 1] - player.times[i0]) * frac;
      setDateDisplayMs(tms);
      player.appliedIndex = -1; // 離散へ戻ったとき必ず再適用させる
    } else {
      const i = Math.round(pos);
      if (i !== player.appliedIndex) {
        applyWind(player.frames[i]);
        player.appliedIndex = i;
      }
    }

    const nearest = Math.round(pos);
    dbScrub.value = String(nearest);
    dbFrameLabel.textContent = `${nearest + 1}/${n}`;
    timeline.value = String(pos);
  }

  // 指定コマへ移動して表示する (スクラブ・読込用)
  function setFrame(index: number): void {
    if (!player.frames.length) return;
    player.pos = Math.max(0, Math.min(player.frames.length - 1, index));
    applyAtPos();
  }

  function setPlaying(on: boolean): void {
    player.playing = on && player.frames.length > 1;
    dbPlay.textContent = player.playing ? t('pause') : t('play');
    if (player.playing) {
      lastPlayTime = 0;
      // 終端から再生開始したら先頭へ戻す
      if (player.pos >= player.outPoint) player.pos = player.inPoint;
    }
  }

  async function loadCollection(id: string): Promise<void> {
    const meta = await window.windApi.dbGet(id).catch(() => null);
    if (!meta || meta.frames.length === 0) return;
    dbPlayerName.textContent = meta.name;
    dbFrameLabel.textContent = t('loadingFrames');
    dbPlayer.hidden = false;
    const frames: WindField[] = [];
    for (let i = 0; i < meta.frames.length; i++) {
      const p = await window.windApi.dbGetFrame(id, i).catch(() => null);
      if (!p) continue;
      const field = WindField.fromArrays(p.grid, p.u, p.v, p.refTime, p.forecastHour);
      if (field) frames.push(field);
    }
    if (frames.length === 0) {
      dbFrameLabel.textContent = t('loadFailed');
      return;
    }
    player.id = id;
    player.frames = frames;
    player.times = frames.map(fieldValidMs);
    player.inPoint = 0;
    player.outPoint = frames.length - 1;
    player.playing = false;
    player.appliedIndex = -1;
    const max = String(frames.length - 1);
    for (const slider of [dbScrub, dbIn, dbOut, timeline]) slider.max = max;
    dbScrub.value = '0';
    dbIn.value = '0';
    dbOut.value = max;
    dbInValue.textContent = '0';
    dbOutValue.textContent = max;
    dbPlay.textContent = t('play');
    timeline.value = '0';
    timelineBar.hidden = false;
    curCollection = { name: meta.name, n: frames.length };
    curField = null;
    curSourceKey = null;
    refreshSourceLabel();
    setFrame(0);
    void refreshDbList();
  }

  // 再生の前進。アニメーションループから dt(秒) を渡して呼ぶ
  function advancePlayback(dt: number): void {
    if (!player.playing || player.frames.length < 2) return;
    const span = player.outPoint - player.inPoint;
    player.pos += dt / Math.max(0.01, player.frameDuration);
    if (player.pos > player.outPoint) {
      if (dbLoop.checked && span > 0) {
        // 端数を持ち越して滑らかにループ(範囲を超えたら先頭へ丸める)
        player.pos = player.inPoint + ((player.pos - player.inPoint) % span);
      } else if (dbLoop.checked) {
        player.pos = player.inPoint;
      } else {
        player.pos = player.outPoint;
        applyAtPos();
        setPlaying(false);
        return;
      }
    }
    applyAtPos();
  }

  // 出自に応じて入力欄を切り替える
  function syncDbSource(): void {
    const forecast = dbSource.value === 'forecast';
    dbForecastFields.hidden = !forecast;
    dbArchiveFields.hidden = forecast;
  }
  syncDbSource();
  dbSource.addEventListener('change', syncDbSource);

  // アーカイブ日時の既定値: 1 年前の 0 時から 24 時間(選択中タイムゾーンで表示)
  {
    const now = new Date();
    const startMs = Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate());
    dbStart.value = tzInputValue(startMs);
    dbEnd.value = tzInputValue(startMs + 24 * 3600_000);
  }

  dbFcstStart.addEventListener('input', () => {
    dbFcstStartValue.textContent = `+${dbFcstStart.value}h`;
  });
  dbFcstEnd.addEventListener('input', () => {
    dbFcstEndValue.textContent = `+${dbFcstEnd.value}h`;
  });
  dbStep.addEventListener('input', () => {
    dbStepValue.textContent = `${dbStep.value}h`;
  });

  window.windApi.onBuildProgress((p) => {
    if (p.phase === 'running') {
      dbBuildStatus.textContent = tBuildRunning(p.current, p.total, p.saved);
    } else if (p.phase === 'done') {
      dbBuildStatus.textContent = p.message ?? tBuildDone(p.saved);
    }
  });

  dbBuildBtn.addEventListener('click', () => {
    const source = dbSource.value === 'forecast' ? 'forecast' : 'archive';
    const name =
      dbName.value.trim() ||
      `${listSourceLabel(source)} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    let opts: BuildOptions;
    if (source === 'forecast') {
      opts = {
        kind: 'forecast',
        name,
        startHour: Number(dbFcstStart.value),
        endHour: Number(dbFcstEnd.value),
        stepHours: Number(dbStep.value),
      };
    } else {
      if (!dbStart.value || !dbEnd.value) {
        dbBuildStatus.textContent = t('enterStartEnd');
        return;
      }
      opts = {
        kind: 'archive',
        name,
        start: tzInputToUtcIso(dbStart.value),
        end: tzInputToUtcIso(dbEnd.value),
        stepHours: Number(dbStep.value),
      };
    }
    dbBuildBtn.disabled = true;
    dbBuildStatus.textContent = t('buildPreparing');
    window.windApi
      .dbBuild(opts)
      .then((summary) => {
        void refreshDbList();
        if (summary) void loadCollection(summary.id);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        dbBuildStatus.textContent = `${t('buildFail')}${message.replace(/^Error invoking remote method '[^']+': Error: /, '')}`;
      })
      .finally(() => {
        dbBuildBtn.disabled = false;
      });
  });

  dbPlay.addEventListener('click', () => setPlaying(!player.playing));
  dbScrub.addEventListener('input', () => {
    setPlaying(false);
    setFrame(Number(dbScrub.value));
  });
  // 右下の時間操作スライダー(連続位置でスクラブ)
  timeline.addEventListener('input', () => {
    setPlaying(false);
    player.pos = Number(timeline.value);
    applyAtPos();
  });
  dbInterp.addEventListener('change', () => {
    player.appliedIndex = -1;
    applyAtPos();
  });
  if (!gpuSupported) {
    dbInterp.checked = false;
    dbInterp.disabled = true;
    dbInterp.closest('label')?.setAttribute('title', 'GPU パーティクル非対応環境では補間できません');
  }
  dbSpeed.addEventListener('input', () => {
    player.frameDuration = Number(dbSpeed.value);
    dbSpeedValue.textContent = player.frameDuration.toFixed(2);
  });
  dbIn.addEventListener('input', () => {
    player.inPoint = Number(dbIn.value);
    if (player.inPoint > player.outPoint) {
      player.outPoint = player.inPoint;
      dbOut.value = String(player.outPoint);
      dbOutValue.textContent = dbOut.value;
    }
    dbInValue.textContent = dbIn.value;
  });
  dbOut.addEventListener('input', () => {
    player.outPoint = Number(dbOut.value);
    if (player.outPoint < player.inPoint) {
      player.inPoint = player.outPoint;
      dbIn.value = String(player.inPoint);
      dbInValue.textContent = dbIn.value;
    }
    dbOutValue.textContent = dbOut.value;
  });

  // タイムゾーン: ラベル・入力欄の範囲・表示中の時刻をまとめて更新する
  const histTimeLabel = document.getElementById('hist-time-label')!;
  const dbStartLabel = document.getElementById('db-start-label')!;
  const dbEndLabel = document.getElementById('db-end-label')!;
  function syncTz(): void {
    const label = tzLabel();
    tzValue.textContent = label;
    histTimeLabel.textContent = `${t('histTime')} (${label})`;
    dbStartLabel.textContent = `${t('startLabel')} (${label})`;
    dbEndLabel.textContent = `${t('endLabel')} (${label})`;
    // アーカイブ下限 (2021-01-01 UTC) と現在を、選択中タイムゾーンの壁時計へ直す
    const minVal = tzInputValue(Date.UTC(2021, 0, 1));
    const maxVal = tzInputValue(Date.now());
    for (const el of [histTime, dbStart, dbEnd]) {
      el.min = minVal;
      el.max = maxVal;
    }
    // 表示中の時刻・ラベルを再描画する
    if (player.frames.length) applyAtPos();
    else if (windField) updateDateDisplay(windField);
    refreshSourceLabel();
    void refreshDbList();
  }
  tzSlider.addEventListener('input', () => {
    displayTz = Number(tzSlider.value);
    syncTz();
    scheduleSave();
  });

  // 言語の適用。静的ラベル(data-i18n)と、JS で組み立てる動的ラベルをまとめて更新する。
  function applyLanguage(lang: Lang): void {
    setLang(lang);
    langSelect.value = lang;
    applyStaticI18n();
    dbPlay.textContent = t(player.playing ? 'pause' : 'play');
    syncTz(); // hist/start/end ラベル・一覧・データラベル・表示中の時刻を再描画
  }
  applyLanguage(getLang());
  langSelect.addEventListener('change', () => {
    applyLanguage(langSelect.value === 'en' ? 'en' : 'ja');
    scheduleSave();
  });

  // スペースキーで再生/停止をトグルする。文字入力やボタン・選択肢・チェックボックス等に
  // フォーカスがあるときは、その既定動作(入力・クリック等)を優先する。
  function spaceShouldToggle(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return true;
    if (el.isContentEditable) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return false;
    // range スライダーはスペースを使わないのでトグル対象に含める
    if (tag === 'INPUT') return (el as HTMLInputElement).type.toLowerCase() === 'range';
    return true;
  }
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (!spaceShouldToggle(e.target)) return;
    if (player.frames.length < 2) return; // 再生対象がないときは何もしない
    e.preventDefault();
    setPlaying(!player.playing);
  });

  // 画面下中央の一時通知トースト
  const toastEl = document.getElementById('toast')!;
  let toastTimer: number | undefined;
  function showToast(msg: string): void {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), 2800);
  }

  // 文字入力中(テキスト入力欄・テキストエリア・選択肢・編集可能領域)かどうか
  function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = (el as HTMLInputElement).type.toLowerCase();
      return !['range', 'checkbox', 'radio', 'button', 'color'].includes(type);
    }
    return false;
  }

  // M キーで左上メニューの表示/非表示をトグルする
  const panelEl = document.getElementById('panel')!;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'm' && e.key !== 'M') return;
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    panelEl.classList.toggle('hidden');
  });

  // F12 でスクリーンショットを保存する(既定の DevTools 起動は抑止)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F12') return;
    e.preventDefault();
    window.windApi
      .captureScreenshot()
      .then((file) => {
        const name = file.split(/[\\/]/).pop() ?? file;
        showToast(t('screenshotSaved') + name);
      })
      .catch((err) => {
        console.error('screenshot failed', err);
        showToast(t('screenshotFailed'));
      });
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    gpuParticles?.resize();
  });

  // 起動時に最新データ(最新ランの解析 f000、現在時刻に最も近い実データ)を
  // 自動取得して差し替える。手動取得と違いボタンは無効化せず、失敗時は静かに継続。
  async function autoFetchLatest(): Promise<void> {
    fetchStatus.textContent = t('startupFetching');
    try {
      const result = await window.windApi.fetchWind(0);
      const field = WindField.fromGfsJson(result.records);
      // 取得中にユーザーが保存データを開いていたら上書きしない
      if (!field || curCollection !== null) {
        fetchStatus.textContent = '';
        return;
      }
      applyWind(field);
      curField = field;
      curSourceKey = result.source;
      refreshSourceLabel();
      fetchStatus.textContent = t('updatedLatest');
    } catch (err) {
      console.error('startup fetch failed', err);
      fetchStatus.textContent = ''; // 失敗時はキャッシュ表示のまま
    }
  }

  loadWindField().then(({ field, source }) => {
    curField = field;
    curSourceKey = source;
    curCollection = null;
    refreshSourceLabel();
    applyWind(field);
    if (autoFetchCheck.checked) void autoFetchLatest();
  });

  // 動作検証用 (WINDMAP_SCREENSHOT) にカメラ状態を覗けるようにしておく
  (window as unknown as Record<string, unknown>).__windmapDebug = () => ({
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
    dist: controls.getDistance(),
    morph: proj.value,
    camPos: camera.position.toArray(),
    camTarget: controls.target.toArray(),
  });

  let frames = 0;
  let lastFpsTime = performance.now();
  let lastFrameTime = 0;

  renderer.setAnimationLoop((time: number) => {
    const dtSec = lastFrameTime === 0 ? 0.016 : Math.min(0.1, (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    if (player.playing) {
      if (lastPlayTime === 0) lastPlayTime = time;
      advancePlayback((time - lastPlayTime) / 1000);
      lastPlayTime = time;
    }

    // 投影モーフの遷移。遷移中は OrbitControls を止めて手動でカメラを寄せる
    // (OrbitControls.update は内部の球面座標からカメラ位置を毎回設定し直すため)
    if (proj.value !== proj.target || camAnim) {
      const step = dtSec / MORPH_DURATION;
      proj.value += Math.max(-step, Math.min(step, proj.target - proj.value));
      if (Math.abs(proj.value - proj.target) < 1e-3) proj.value = proj.target;
      applyMorph();
      if (camAnim) {
        const k = 1 - Math.exp(-dtSec * 3);
        camera.position.lerp(camAnim.pos, k);
        controls.target.lerp(camAnim.tgt, k);
        camera.lookAt(controls.target);
        if (proj.value === proj.target && camera.position.distanceTo(camAnim.pos) < 0.01) {
          camera.position.copy(camAnim.pos);
          controls.target.copy(camAnim.tgt);
          camera.lookAt(controls.target);
          camAnim = null;
          applyProjControls();
        }
      }
    } else {
      controls.update();
    }
    coastlines.update(controls.getDistance());
    borders.update(controls.getDistance());
    if (gpuParticles) gpuParticles.update(camera);
    if (cpuParticles) cpuParticles.update();
    renderer.render(scene, camera);
    if (gpuParticles) gpuParticles.composite();

    frames++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      fpsEl.textContent = `${Math.round((frames * 1000) / (now - lastFpsTime))} fps`;
      frames = 0;
      lastFpsTime = now;
    }
  });
}

void init();
