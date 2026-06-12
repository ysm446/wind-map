import * as THREE from 'three';
import landGeo from './data/land-50m.json';
import coast110 from './data/coastline-110m.json';
import coast50 from './data/coastline-50m.json';
import border110 from './data/border-110m.json';
import border50 from './data/border-50m.json';

// SphereGeometry の UV 配置に合わせた経緯度 → 3D 座標変換。
// テクスチャ左端 (u=0) が lon=-180 に対応する。
export function lonLatToVector3(
  lon: number,
  lat: number,
  radius: number,
  target: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const theta = ((90 - lat) * Math.PI) / 180;
  return target.set(
    -radius * Math.cos(phi) * Math.sin(theta),
    radius * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

interface GeoJsonGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

interface GeoJsonFeature {
  geometry: GeoJsonGeometry;
}

// Natural Earth の陸地 GeoJSON を等距円筒図法でキャンバスに描き、テクスチャにする。
// 画像ファイルを使わないので file:// 環境でも CORS/taint の問題が出ない。
// 海岸線の輪郭は別途ベクターライン (Coastlines) で重ねるため、ここは塗りのみ。
function createEarthTexture(): THREE.CanvasTexture {
  const w = 4096;
  const h = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // 海
  ctx.fillStyle = '#0c1422';
  ctx.fillRect(0, 0, w, h);

  // 経緯線(30°ごと)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = ((lon + 180) / 360) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const projectRing = (ring: number[][]) => {
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const x = ((ring[i][0] + 180) / 360) * w;
      const y = ((90 - ring[i][1]) / 180) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  ctx.fillStyle = '#1d2939';

  const features = (landGeo as { features: GeoJsonFeature[] }).features;
  for (const feature of features) {
    const geom = feature.geometry;
    const polygons =
      geom.type === 'Polygon'
        ? [geom.coordinates as number[][][]]
        : (geom.coordinates as number[][][][]);
    for (const polygon of polygons) {
      for (const ring of polygon) {
        projectRing(ring);
        ctx.fill();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

type LineCoords = number[][]; // [lon, lat] の列

// GeoJSON から折れ線の座標列を取り出す (LineString / MultiLineString / Polygon 対応)
function collectLines(geo: unknown): LineCoords[] {
  const features = (geo as { features: Array<{ geometry: GeoJsonGeometry }> }).features;
  const lines: LineCoords[] = [];
  for (const f of features) {
    const g = f.geometry as { type: string; coordinates: unknown };
    if (g.type === 'LineString') lines.push(g.coordinates as LineCoords);
    else if (g.type === 'MultiLineString' || g.type === 'Polygon')
      lines.push(...(g.coordinates as LineCoords[]));
    else if (g.type === 'MultiPolygon')
      for (const poly of g.coordinates as LineCoords[][]) lines.push(...poly);
  }
  return lines;
}

// 折れ線を球面上のラインセグメント群に変換する。
// 長い線分は弦が球面の下に沈むため、一定角度以下に分割する
function buildCoastGeometry(geo: unknown, radius: number): THREE.BufferGeometry {
  const MAX_SEG_DEG = 1.5;
  const positions: number[] = [];
  const v = new THREE.Vector3();
  const push = (lon: number, lat: number) => {
    lonLatToVector3(lon, lat, radius, v);
    positions.push(v.x, v.y, v.z);
  };

  for (const line of collectLines(geo)) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [lon0, lat0] = line[i];
      const [lon1, lat1] = line[i + 1];
      const dlon = lon1 - lon0;
      if (Math.abs(dlon) > 180) continue; // 日付変更線をまたぐ稀な線分はスキップ
      const dlat = lat1 - lat0;
      const midLat = (((lat0 + lat1) / 2) * Math.PI) / 180;
      const dist = Math.hypot(dlat, dlon * Math.cos(midLat));
      const steps = Math.max(1, Math.ceil(dist / MAX_SEG_DEG));
      for (let s = 0; s < steps; s++) {
        push(lon0 + (dlon * s) / steps, lat0 + (dlat * s) / steps);
        push(lon0 + (dlon * (s + 1)) / steps, lat0 + (dlat * (s + 1)) / steps);
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geom;
}

interface LodLinesOptions {
  radius: number;
  color: number;
  opacity: number;
  geo110: unknown;
  geo50: unknown;
  load10: () => Promise<{ default: unknown }>;
}

// ベクターライン (海岸線・国境線など)。カメラ距離に応じて 110m / 50m / 10m を
// 切り替える LOD 付き。テクスチャと違い解像度非依存なので、ズームしても
// 輪郭が常にシャープに保たれる。
export class LodLines {
  readonly group = new THREE.Group();
  private readonly material: THREE.LineBasicMaterial;
  private readonly opts: LodLinesOptions;
  private readonly lod110: THREE.LineSegments;
  private readonly lod50: THREE.LineSegments;
  private lod10: THREE.LineSegments | null = null;
  private lod10Requested = false;

  constructor(opts: LodLinesOptions) {
    this.opts = opts;
    // 加算合成で発光風にし、粒子のグローと馴染ませる
    this.material = new THREE.LineBasicMaterial({
      color: opts.color,
      transparent: true,
      opacity: opts.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lod110 = new THREE.LineSegments(
      buildCoastGeometry(opts.geo110, opts.radius),
      this.material,
    );
    this.lod50 = new THREE.LineSegments(
      buildCoastGeometry(opts.geo50, opts.radius),
      this.material,
    );
    this.lod50.visible = false;
    this.group.add(this.lod110, this.lod50);
  }

  // 毎フレーム呼ぶ。10m は初回要求時に動的 import で遅延ロードする
  update(cameraDistance: number): void {
    const want = cameraDistance > 4.5 ? 110 : cameraDistance > 2.5 ? 50 : 10;

    if (want === 10 && !this.lod10Requested) {
      this.lod10Requested = true;
      this.opts
        .load10()
        .then((mod) => {
          this.lod10 = new THREE.LineSegments(
            buildCoastGeometry(mod.default, this.opts.radius),
            this.material,
          );
          this.lod10.visible = false;
          this.group.add(this.lod10);
        })
        .catch((err) => console.error('10m line data load failed', err));
    }

    const active =
      want === 110
        ? this.lod110
        : want === 50 || !this.lod10
          ? this.lod50 // 10m 未ロードの間は 50m で代用
          : this.lod10;
    for (const obj of [this.lod110, this.lod50, this.lod10]) {
      if (obj) obj.visible = obj === active;
    }
  }
}

export function createCoastlines(radius: number): LodLines {
  return new LodLines({
    radius,
    color: 0x9db4d6,
    opacity: 0.5,
    geo110: coast110,
    geo50: coast50,
    load10: () => import('./data/coastline-10m.json'),
  });
}

export function createBorders(radius: number): LodLines {
  return new LodLines({
    radius,
    color: 0x8593a8,
    opacity: 0.3, // 海岸線より控えめにする
    geo110: border110,
    geo50: border50,
    load10: () => import('./data/border-10m.json'),
  });
}

export function createGlobe(radius: number): THREE.Group {
  const group = new THREE.Group();

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 48),
    new THREE.MeshBasicMaterial({ map: createEarthTexture() }),
  );
  group.add(sphere);

  // ふちの淡い大気光
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.015, 96, 48),
    new THREE.MeshBasicMaterial({
      color: 0x4a7fc9,
      transparent: true,
      opacity: 0.07,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  group.add(halo);

  return group;
}
