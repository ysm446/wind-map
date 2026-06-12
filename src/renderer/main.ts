import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGlobe } from './globe';
import { WindField, makeSyntheticWind } from './wind';
import { ParticleSystem } from './particles';

const GLOBE_RADIUS = 1;
const PARTICLE_RADIUS = 1.004; // 地表より少し浮かせて Z ファイティングを避ける

async function loadWindField(): Promise<{ field: WindField; label: string }> {
  try {
    const result = await window.windApi.getWindData();
    if (result) {
      const field = WindField.fromGfsJson(result.records);
      if (field) {
        const sourceName = result.source === 'cache' ? 'キャッシュ' : '同梱サンプル';
        const time = field.refTime
          ? new Date(field.refTime).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
          : '時刻不明';
        return { field, label: `GFS ${sourceName} / ${time}` };
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
  const dataSourceEl = document.getElementById('data-source')!;
  const fpsEl = document.getElementById('fps')!;

  function rebuildParticles(count: number): void {
    if (!windField) return;
    if (particles) {
      scene.remove(particles.object3d);
      particles.dispose();
    }
    particles = new ParticleSystem(count, PARTICLE_RADIUS, windField);
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
