import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGlobe } from './globe';
import { WindField, makeSyntheticWind } from './wind';
import { ParticleSystem } from './particles';

const GLOBE_RADIUS = 1;
const PARTICLE_RADIUS = 1.004; // 地表より少し浮かせて Z ファイティングを避ける

const SOURCE_NAMES: Record<string, string> = {
  cache: 'GFS キャッシュ',
  sample: 'GFS 同梱サンプル',
  nomads: 'GFS NOMADS',
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

function init(): void {
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

  let particles: ParticleSystem | null = null;
  let windField: WindField | null = null;

  const countSlider = document.getElementById('count') as HTMLInputElement;
  const countValue = document.getElementById('count-value')!;
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

  function rebuildParticles(count: number): void {
    if (!windField) return;
    if (particles) {
      scene.remove(particles.object3d);
      particles.dispose();
    }
    particles = new ParticleSystem(
      count,
      PARTICLE_RADIUS,
      windField,
      Number(trailSlider.value),
    );
    particles.speedFactor = Number(speedSlider.value);
    scene.add(particles.object3d);
  }

  countSlider.addEventListener('input', () => {
    countValue.textContent = countSlider.value;
  });
  countSlider.addEventListener('change', () => {
    rebuildParticles(Number(countSlider.value));
  });
  speedSlider.addEventListener('input', () => {
    speedValue.textContent = Number(speedSlider.value).toFixed(1);
    if (particles) particles.speedFactor = Number(speedSlider.value);
  });
  trailSlider.addEventListener('input', () => {
    trailValue.textContent = trailSlider.value;
  });
  trailSlider.addEventListener('change', () => {
    rebuildParticles(Number(countSlider.value));
  });
  fcstSlider.addEventListener('input', () => {
    fcstValue.textContent = `+${fcstSlider.value}h`;
  });
  fetchBtn.addEventListener('click', async () => {
    fetchBtn.disabled = true;
    fetchStatus.textContent = '取得中…';
    try {
      const result = await window.windApi.fetchWind(Number(fcstSlider.value));
      const field = WindField.fromGfsJson(result.records);
      if (!field) throw new Error('データを解釈できませんでした');
      windField = field;
      dataSourceEl.textContent = `データ: ${describeField(field, SOURCE_NAMES.nomads)}`;
      rebuildParticles(Number(countSlider.value));
      fetchStatus.textContent = '取得完了';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // IPC 経由のエラーは定型の前置きが付くので除去する
      fetchStatus.textContent = `取得失敗: ${message.replace(/^Error invoking remote method '[^']+': Error: /, '')}`;
    } finally {
      fetchBtn.disabled = false;
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  loadWindField().then(({ field, label }) => {
    windField = field;
    dataSourceEl.textContent = `データ: ${label}`;
    rebuildParticles(Number(countSlider.value));
  });

  let frames = 0;
  let lastFpsTime = performance.now();

  renderer.setAnimationLoop(() => {
    controls.update();
    if (particles) particles.update();
    renderer.render(scene, camera);

    frames++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      fpsEl.textContent = `${Math.round((frames * 1000) / (now - lastFpsTime))} fps`;
      frames = 0;
      lastFpsTime = now;
    }
  });
}

init();
