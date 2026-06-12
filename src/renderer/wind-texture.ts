// 風場テクスチャと配色ランプの生成。
// GPU パーティクル (gpu-particles.ts) と風速カラーオーバーレイ (overlay.ts) で共有する。

import * as THREE from 'three';
import { WindField } from './wind';
import { speedColor, COLOR_SCHEMES, type ColorStops } from './particles';

export const RAMP_MAX_SPEED = 35; // 配色の上限風速 (m/s)

// 風場 (u, v) を半精度浮動小数点テクスチャに焼く。補間は GPU のバイリニアフィルタに任せる
export function createWindDataTexture(wind: WindField): THREE.DataTexture {
  const { nx, ny } = wind;
  const data = new Uint16Array(nx * ny * 4);
  const u = wind.uValues;
  const v = wind.vValues;
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let k = 0; k < nx * ny; k++) {
    data[k * 4] = THREE.DataUtils.toHalfFloat(u[k]);
    data[k * 4 + 1] = THREE.DataUtils.toHalfFloat(v[k]);
    data[k * 4 + 2] = 0;
    data[k * 4 + 3] = one;
  }
  const tex = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.wrapS = THREE.RepeatWrapping; // 経度方向は日付変更線をまたいで補間する
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// 風速 0〜RAMP_MAX_SPEED m/s を横軸にした 1D カラーランプ
export function createSpeedRampTexture(
  stops: ColorStops = COLOR_SCHEMES.standard,
): THREE.DataTexture {
  const width = 256;
  const data = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const [r, g, b] = speedColor((i / (width - 1)) * RAMP_MAX_SPEED, stops);
    data[i * 4] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
