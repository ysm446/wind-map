import * as THREE from 'three';
import landGeo from './data/land-110m.json';

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
function createEarthTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 1024;
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
  ctx.strokeStyle = 'rgba(140, 165, 200, 0.5)';
  ctx.lineWidth = 1.2;

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
        ctx.stroke();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
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
