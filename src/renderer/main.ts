import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGlobe, Coastlines } from './globe';
import { WindField, makeSyntheticWind } from './wind';
import { ParticleSystem } from './particles';
import { GpuParticleSystem } from './gpu-particles';

const GLOBE_RADIUS = 1;
const PARTICLE_RADIUS = 1.004; // 地表より少し浮かせて Z ファイティングを避ける

const SOURCE_NAMES: Record<string, string> = {
  cache: 'GFS キャッシュ',
  sample: 'GFS 同梱サンプル',
  nomads: 'GFS NOMADS',
  archive: 'GFS アーカイブ',
};

// 例: "GFS NOMADS / 2026-06-12 12:00 UTC (+6h)"
function describeField(field: WindField, sourceName: string): string {
  if (!field.refTime) return sourceName;
  const fh = field.forecastTime ?? 0;
  const valid = new Date(new Date(field.refTime).getTime() + fh * 3600_000);
  const time = valid.toISOString().slice(0, 16).replace('T', ' ');
  const fhLabel = fh > 0 ? ` (+${fh}h)` : '';
  return `${sourceName} / ${time} UTC${fhLabel}`;
}

async function loadWindField(): Promise<{ field: WindField; label: string }> {
  try {
    const result = await window.windApi.getWindData();
    if (result) {
      const field = WindField.fromGfsJson(result.records);
      if (field) {
        return { field, label: describeField(field, SOURCE_NAMES[result.source]) };
      }
    }
  } catch (err) {
    console.error('wind data load failed', err);
  }
  return { field: makeSyntheticWind(), label: '合成風場(フォールバック)' };
}

async function init(): Promise<void> {
  const container = document.getElementById('app')!;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);

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
  controls.minDistance = 1.4;
  controls.maxDistance = 8;
  controls.rotateSpeed = 0.5;

  scene.add(createGlobe(GLOBE_RADIUS));

  // ベクター海岸線 (LOD 付き)。地表より少し浮かせて Z ファイティングを避ける
  const coastlines = new Coastlines(GLOBE_RADIUS * 1.0015);
  scene.add(coastlines.group);

  // 薄い星空
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
    const stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0x5a6a82, size: 0.06, sizeAttenuation: true }),
    );
    scene.add(stars);
  }

  const gpuSupported = GpuParticleSystem.isSupported(renderer);
  let gpuParticles: GpuParticleSystem | null = null;
  let cpuParticles: ParticleSystem | null = null;
  let windField: WindField | null = null;

  const countSelect = document.getElementById('count') as HTMLSelectElement;
  const speedSlider = document.getElementById('speed') as HTMLInputElement;
  const speedValue = document.getElementById('speed-value')!;
  const trailSlider = document.getElementById('trail') as HTMLInputElement;
  const trailValue = document.getElementById('trail-value')!;
  const fcstSlider = document.getElementById('fcst') as HTMLInputElement;
  const fcstValue = document.getElementById('fcst-value')!;
  const fetchBtn = document.getElementById('fetch-btn') as HTMLButtonElement;
  const fetchStatus = document.getElementById('fetch-status')!;
  const dataSourceEl = document.getElementById('data-source')!;
  const fpsEl = document.getElementById('fps')!;

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
      speedSlider.value = String(Math.min(3, Math.max(0.1, s.speed)));
      speedValue.textContent = Number(speedSlider.value).toFixed(1);
    }
    if (typeof s.trail === 'number' && Number.isFinite(s.trail)) {
      trailSlider.value = String(Math.min(64, Math.max(4, Math.round(s.trail))));
      trailValue.textContent = trailSlider.value;
    }
    if (typeof s.forecastHour === 'number' && Number.isFinite(s.forecastHour)) {
      fcstSlider.value = String(Math.min(120, Math.max(0, Math.round(s.forecastHour / 3) * 3)));
      fcstValue.textContent = `+${fcstSlider.value}h`;
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
          trail: Number(trailSlider.value),
          forecastHour: Number(fcstSlider.value),
        })
        .catch((err) => console.error('settings save failed', err));
    }, 500);
  }

  applySettings(await window.windApi.getSettings().catch(() => null));

  // 軌跡スライダー値 (4〜64) を蓄積バッファの減衰率に変換する
  function trailFadeFromSlider(): number {
    const len = Number(trailSlider.value);
    return Math.min(0.985, Math.max(0.6, 1 - 1.5 / len));
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
      );
      gpuParticles.speedFactor = Number(speedSlider.value);
      gpuParticles.trailFade = trailFadeFromSlider();
    } else {
      // GPU 非対応環境では CPU 移流(粒子数固定)にフォールバック
      cpuParticles = new ParticleSystem(
        6000,
        PARTICLE_RADIUS,
        windField,
        Number(trailSlider.value),
      );
      cpuParticles.speedFactor = Number(speedSlider.value);
      scene.add(cpuParticles.object3d);
    }
  }

  // 新しい風場の適用。粒子と軌跡は保ったまま風だけ差し替える
  function applyWind(field: WindField): void {
    windField = field;
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
  trailSlider.addEventListener('input', () => {
    trailValue.textContent = trailSlider.value;
    if (gpuParticles) gpuParticles.trailFade = trailFadeFromSlider();
    scheduleSave();
  });
  trailSlider.addEventListener('change', () => {
    if (cpuParticles) rebuildParticles();
  });
  fcstSlider.addEventListener('input', () => {
    fcstValue.textContent = `+${fcstSlider.value}h`;
    scheduleSave();
  });
  const histTime = document.getElementById('hist-time') as HTMLInputElement;
  const histBtn = document.getElementById('hist-btn') as HTMLButtonElement;

  // 既定値: 1 年前の 00:00 UTC。上限は現在時刻
  {
    const now = new Date();
    const past = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()));
    histTime.value = past.toISOString().slice(0, 16);
    histTime.max = now.toISOString().slice(0, 16);
  }

  async function runFetch(fetcher: () => Promise<WindApiResult>): Promise<void> {
    fetchBtn.disabled = true;
    histBtn.disabled = true;
    fetchStatus.textContent = '取得中…';
    try {
      const result = await fetcher();
      const field = WindField.fromGfsJson(result.records);
      if (!field) throw new Error('データを解釈できませんでした');
      applyWind(field);
      dataSourceEl.textContent = `データ: ${describeField(field, SOURCE_NAMES[result.source])}`;
      fetchStatus.textContent = '取得完了';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // IPC 経由のエラーは定型の前置きが付くので除去する
      fetchStatus.textContent = `取得失敗: ${message.replace(/^Error invoking remote method '[^']+': Error: /, '')}`;
    } finally {
      fetchBtn.disabled = false;
      histBtn.disabled = false;
    }
  }

  fetchBtn.addEventListener('click', () => {
    void runFetch(() => window.windApi.fetchWind(Number(fcstSlider.value)));
  });
  histBtn.addEventListener('click', () => {
    if (!histTime.value) {
      fetchStatus.textContent = '日時を入力してください';
      return;
    }
    // datetime-local はタイムゾーンを持たないため UTC として解釈する
    void runFetch(() => window.windApi.fetchArchiveWind(`${histTime.value}:00Z`));
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    gpuParticles?.resize();
  });

  loadWindField().then(({ field, label }) => {
    windField = field;
    dataSourceEl.textContent = `データ: ${label}`;
    rebuildParticles();
  });

  let frames = 0;
  let lastFpsTime = performance.now();

  renderer.setAnimationLoop(() => {
    controls.update();
    coastlines.update(controls.getDistance());
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
