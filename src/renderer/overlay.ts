// 風速カラーオーバーレイ: 地表を風速に応じた色の半透明球で覆う (nullschool の Overlay 相当)。
//
// 風場テクスチャをフラグメントシェーダーで直接サンプリングするため、
// 画面解像度に依存せず滑らかなグラデーションになり、
// 風データの差し替え (setWind) も即座に反映される。

import * as THREE from 'three';
import { WindField } from './wind';
import { type ColorStops } from './particles';
import { createWindDataTexture, createSpeedRampTexture, RAMP_MAX_SPEED } from './wind-texture';

const VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FS = /* glsl */ `
precision highp float;
uniform sampler2D uWind;
uniform sampler2D uRamp;
uniform vec4 uGrid;     // lo1, la1, dx, dy
uniform vec2 uGridSize; // nx, ny
uniform float uOpacity;
varying vec2 vUv;

void main() {
  // SphereGeometry の UV (u=0 が lon=-180、v=1 が lat=90) を経緯度へ戻す
  float lon = vUv.x * 360.0 - 180.0;
  float lat = vUv.y * 180.0 - 90.0;
  float c = mod(lon - uGrid.x, 360.0) / uGrid.z;
  float r = (uGrid.y - lat) / uGrid.w;
  vec2 w = texture2D(uWind, vec2((c + 0.5) / uGridSize.x, (r + 0.5) / uGridSize.y)).xy;
  float speed = length(w);
  vec3 color = texture2D(uRamp, vec2(clamp(speed / ${RAMP_MAX_SPEED.toFixed(1)}, 0.0, 1.0), 0.5)).rgb;
  gl_FragColor = vec4(color, uOpacity);
}
`;

export class SpeedOverlay {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private rampTexture: THREE.DataTexture;
  private windTexture: THREE.DataTexture | null = null;
  private enabled = false;

  constructor(radius: number) {
    this.rampTexture = createSpeedRampTexture();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uWind: { value: null },
        uRamp: { value: this.rampTexture },
        uGrid: { value: new THREE.Vector4(0, 90, 1, 1) },
        uGridSize: { value: new THREE.Vector2(1, 1) },
        uOpacity: { value: 0.3 },
      },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), this.material);
    this.mesh.visible = false;
  }

  setWind(wind: WindField): void {
    const tex = createWindDataTexture(wind);
    this.windTexture?.dispose();
    this.windTexture = tex;
    this.material.uniforms.uWind.value = tex;
    this.material.uniforms.uGrid.value.set(wind.lo1, wind.la1, wind.dx, wind.dy);
    this.material.uniforms.uGridSize.value.set(wind.nx, wind.ny);
    this.syncVisible();
  }

  setColorStops(stops: ColorStops): void {
    const tex = createSpeedRampTexture(stops);
    this.rampTexture.dispose();
    this.rampTexture = tex;
    this.material.uniforms.uRamp.value = tex;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.syncVisible();
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity.value = opacity;
  }

  // 風データ未着のうちは真っ黒な球になるので、テクスチャが揃うまで隠す
  private syncVisible(): void {
    this.mesh.visible = this.enabled && this.windTexture !== null;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.rampTexture.dispose();
    this.windTexture?.dispose();
  }
}
