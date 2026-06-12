import * as THREE from 'three';
import { WindField } from './wind';
import { lonLatToVector3 } from './globe';

const TRAIL = 16; // 1 粒子あたりの軌跡点数
const BASE_DEG_PER_FRAME = 0.03; // 風速 1 m/s あたりの 1 フレーム移動量(度)
const MAX_LAT = 85; // 極近傍は移流が破綻するためリセットする

// 風速 (m/s) → 色のグラデーション
const COLOR_STOPS: Array<[number, [number, number, number]]> = [
  [0, [70, 110, 215]],
  [5, [80, 195, 205]],
  [10, [125, 215, 125]],
  [15, [235, 215, 100]],
  [25, [255, 140, 85]],
  [35, [255, 90, 170]],
];

function speedColor(speed: number): [number, number, number] {
  if (speed <= COLOR_STOPS[0][0]) {
    const c = COLOR_STOPS[0][1];
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    if (speed <= COLOR_STOPS[i][0]) {
      const [s0, c0] = COLOR_STOPS[i - 1];
      const [s1, c1] = COLOR_STOPS[i];
      const t = (speed - s0) / (s1 - s0);
      return [
        (c0[0] + (c1[0] - c0[0]) * t) / 255,
        (c0[1] + (c1[1] - c0[1]) * t) / 255,
        (c0[2] + (c1[2] - c0[2]) * t) / 255,
      ];
    }
  }
  const c = COLOR_STOPS[COLOR_STOPS.length - 1][1];
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}

export class ParticleSystem {
  readonly object3d: THREE.LineSegments;
  speedFactor = 1.0;

  private readonly count: number;
  private readonly radius: number;
  private wind: WindField;
  private readonly lons: Float32Array;
  private readonly lats: Float32Array;
  private readonly ages: Float32Array;
  private readonly maxAges: Float32Array;
  private readonly speeds: Float32Array;
  private readonly trails: Float32Array; // count * TRAIL * 3
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly tmpVec = new THREE.Vector3();

  constructor(count: number, radius: number, wind: WindField) {
    this.count = count;
    this.radius = radius;
    this.wind = wind;
    this.lons = new Float32Array(count);
    this.lats = new Float32Array(count);
    this.ages = new Float32Array(count);
    this.maxAges = new Float32Array(count);
    this.speeds = new Float32Array(count);
    this.trails = new Float32Array(count * TRAIL * 3);

    const segments = count * (TRAIL - 1);
    const positions = new Float32Array(segments * 2 * 3);
    const colors = new Float32Array(segments * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('color', this.colorAttr);

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.object3d = new THREE.LineSegments(geometry, material);
    this.object3d.frustumCulled = false;

    for (let i = 0; i < count; i++) this.respawn(i);
  }

  setWind(wind: WindField): void {
    this.wind = wind;
    for (let i = 0; i < this.count; i++) this.respawn(i);
  }

  private respawn(i: number): void {
    // 球面上で一様になるよう sin(lat) を一様サンプリングする
    const lat = (Math.asin(Math.random() * 2 - 1) * 180) / Math.PI;
    const lon = Math.random() * 360 - 180;
    this.lons[i] = lon;
    this.lats[i] = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    this.ages[i] = 0;
    this.maxAges[i] = 80 + Math.random() * 120;
    this.speeds[i] = 0;
    lonLatToVector3(this.lons[i], this.lats[i], this.radius, this.tmpVec);
    for (let k = 0; k < TRAIL; k++) {
      const base = (i * TRAIL + k) * 3;
      this.trails[base] = this.tmpVec.x;
      this.trails[base + 1] = this.tmpVec.y;
      this.trails[base + 2] = this.tmpVec.z;
    }
  }

  update(): void {
    const positions = this.positionAttr.array as Float32Array;
    const colors = this.colorAttr.array as Float32Array;

    for (let i = 0; i < this.count; i++) {
      const w = this.wind.sample(this.lons[i], this.lats[i]);
      if (!w || this.ages[i] > this.maxAges[i] || Math.abs(this.lats[i]) > MAX_LAT) {
        this.respawn(i);
      } else {
        const k = BASE_DEG_PER_FRAME * this.speedFactor;
        const cosLat = Math.max(
          0.05,
          Math.cos((this.lats[i] * Math.PI) / 180),
        );
        let lon = this.lons[i] + (w.u * k) / cosLat;
        if (lon > 180) lon -= 360;
        else if (lon < -180) lon += 360;
        this.lons[i] = lon;
        this.lats[i] += w.v * k;
        this.ages[i] += 1;
        this.speeds[i] = w.speed;

        // 軌跡を 1 つずらして先頭に現在位置を入れる
        const trailBase = i * TRAIL * 3;
        this.trails.copyWithin(trailBase, trailBase + 3, trailBase + TRAIL * 3);
        lonLatToVector3(this.lons[i], this.lats[i], this.radius, this.tmpVec);
        const head = trailBase + (TRAIL - 1) * 3;
        this.trails[head] = this.tmpVec.x;
        this.trails[head + 1] = this.tmpVec.y;
        this.trails[head + 2] = this.tmpVec.z;
      }

      // 軌跡をラインセグメント列として書き出す(古いほど暗く)
      const [r, g, b] = speedColor(this.speeds[i]);
      const trailBase = i * TRAIL * 3;
      for (let k = 0; k < TRAIL - 1; k++) {
        const seg = (i * (TRAIL - 1) + k) * 6;
        const p0 = trailBase + k * 3;
        const p1 = p0 + 3;
        positions[seg] = this.trails[p0];
        positions[seg + 1] = this.trails[p0 + 1];
        positions[seg + 2] = this.trails[p0 + 2];
        positions[seg + 3] = this.trails[p1];
        positions[seg + 4] = this.trails[p1 + 1];
        positions[seg + 5] = this.trails[p1 + 2];

        const f0 = k / (TRAIL - 1);
        const f1 = (k + 1) / (TRAIL - 1);
        colors[seg] = r * f0;
        colors[seg + 1] = g * f0;
        colors[seg + 2] = b * f0;
        colors[seg + 3] = r * f1;
        colors[seg + 4] = g * f1;
        colors[seg + 5] = b * f1;
      }
    }

    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  dispose(): void {
    this.object3d.geometry.dispose();
    (this.object3d.material as THREE.Material).dispose();
  }
}
