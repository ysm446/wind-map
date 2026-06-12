// GPU パーティクルによる風の流線描画。
//
// 仕組み (Mapbox webgl-wind / nullschool と同系統):
//  1. 粒子の状態 (lon, lat, age, maxAge) を浮動小数点テクスチャに持ち、
//     フラグメントシェーダーで毎フレーム移流する (ping-pong FBO)
//  2. 風場 (u, v) はテクスチャに焼き、補間は GPU のバイリニアフィルタに任せる
//  3. 軌跡は画面スペースの蓄積バッファで表現する:
//     前フレームの蓄積画像を少し減衰させて描き、その上に現在の粒子を点で重ねる
//  4. 蓄積画像をメインシーンの上に加算合成する
//
// 蓄積バッファ内では毎フレーム地球を深度のみ描画してから点を打つため、
// 地球の裏側の粒子は深度テストで落ちる。

import * as THREE from 'three';
import { WindField } from './wind';
import { speedColor } from './particles';

const BASE_DEG_PER_FRAME = 0.03; // 風速 1 m/s あたりの 1 フレーム移動量(度)
const RAMP_MAX_SPEED = 35; // 配色の上限風速 (m/s)
const MOVING_FADE = 0.82; // カメラ操作中は軌跡を速く消してスミアを抑える

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// 粒子状態の更新。state = (lon, lat, age, maxAge)
const UPDATE_FS = /* glsl */ `
precision highp float;
uniform sampler2D uState;
uniform sampler2D uWind;
uniform vec4 uGrid;     // lo1, la1, dx, dy
uniform vec2 uGridSize; // nx, ny
uniform float uK;       // 度/フレーム per m/s
uniform float uTime;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 windAt(vec2 lonlat) {
  float c = mod(lonlat.x - uGrid.x, 360.0) / uGrid.z;
  float r = (uGrid.y - lonlat.y) / uGrid.w;
  return texture2D(uWind, vec2((c + 0.5) / uGridSize.x, (r + 0.5) / uGridSize.y)).xy;
}

void main() {
  vec4 st = texture2D(uState, vUv);
  vec2 lonlat = st.xy;
  float age = st.z + 1.0;
  float maxAge = st.w;

  vec2 w = windAt(lonlat);
  float cosLat = max(cos(radians(lonlat.y)), 0.05);
  lonlat.x += w.x * uK / cosLat;
  lonlat.y += w.y * uK;
  lonlat.x = mod(lonlat.x + 180.0, 360.0) - 180.0;

  if (age >= maxAge || abs(lonlat.y) > 85.0) {
    vec2 seed = vUv * 1.37 + fract(vec2(uTime * 0.1031, uTime * 0.0973));
    float r1 = hash(seed);
    float r2 = hash(seed + 19.19);
    float r3 = hash(seed + 47.47);
    // 球面上で一様になるよう sin(lat) を一様サンプリングする
    lonlat = vec2(r1 * 360.0 - 180.0, clamp(degrees(asin(r2 * 2.0 - 1.0)), -85.0, 85.0));
    age = 0.0;
    maxAge = 120.0 + 360.0 * r3;
  }

  gl_FragColor = vec4(lonlat, age, maxAge);
}
`;

// 前フレームの蓄積画像を減衰させてコピーする。
// floor() で量子化することで、8bit バッファでも確実に 0 まで減衰させる
const FADE_FS = /* glsl */ `
precision highp float;
uniform sampler2D uPrev;
uniform float uFade;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uPrev, vUv).rgb;
  gl_FragColor = vec4(floor(c * 255.0 * uFade) / 255.0, 1.0);
}
`;

const COMPOSITE_FS = /* glsl */ `
precision highp float;
uniform sampler2D uTrail;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uTrail, vUv).rgb, 1.0);
}
`;

// 各頂点 = 1 粒子。position.xy に状態テクスチャの UV を入れてある
const POINT_VS = /* glsl */ `
uniform sampler2D uState;
uniform sampler2D uWind;
uniform vec4 uGrid;
uniform vec2 uGridSize;
uniform float uPointSize;
uniform float uRadius;
varying float vSpeed;
varying float vLife;

vec2 windAt(vec2 lonlat) {
  float c = mod(lonlat.x - uGrid.x, 360.0) / uGrid.z;
  float r = (uGrid.y - lonlat.y) / uGrid.w;
  return texture2D(uWind, vec2((c + 0.5) / uGridSize.x, (r + 0.5) / uGridSize.y)).xy;
}

void main() {
  vec4 st = texture2D(uState, position.xy);
  vSpeed = length(windAt(st.xy));
  // 出現・消滅が急に見えないよう、寿命の出入りで明るさを絞る
  vLife = clamp(min(st.z / 8.0, (st.w - st.z) / 24.0), 0.0, 1.0);

  float phi = (st.x + 180.0) * 0.017453292519943295;
  float theta = (90.0 - st.y) * 0.017453292519943295;
  vec3 p = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta)) * uRadius;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uPointSize;
}
`;

// 注意: 蓄積バッファへの点描は加算ではなくアルファ合成にする。
// 加算だと同じ画素に毎フレーム光が足されて飽和し、時間とともに白化する。
const POINT_FS = /* glsl */ `
precision highp float;
uniform sampler2D uRamp;
varying float vSpeed;
varying float vLife;
void main() {
  vec3 color = texture2D(uRamp, vec2(clamp(vSpeed / ${RAMP_MAX_SPEED.toFixed(1)}, 0.0, 1.0), 0.5)).rgb;
  gl_FragColor = vec4(color, vLife);
}
`;

function makeRampTexture(): THREE.DataTexture {
  const width = 256;
  const data = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const [r, g, b] = speedColor((i / (width - 1)) * RAMP_MAX_SPEED);
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

function makeStateTarget(size: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

function makeQuadScene(material: THREE.ShaderMaterial): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return scene;
}

export class GpuParticleSystem {
  speedFactor = 1.0;
  trailFade = 0.95; // 静止時の軌跡の減衰率 (1 に近いほど長い)

  private readonly renderer: THREE.WebGLRenderer;
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly startTime = performance.now();

  // 共有 uniform (update と points の両方から参照する)
  private readonly uState = { value: null as THREE.Texture | null };
  private readonly uWind = { value: null as THREE.Texture | null };
  private readonly uGrid = { value: new THREE.Vector4() };
  private readonly uGridSize = { value: new THREE.Vector2() };

  private stateRead: THREE.WebGLRenderTarget;
  private stateWrite: THREE.WebGLRenderTarget;
  private initTexture: THREE.DataTexture | null;
  private windTexture: THREE.DataTexture | null = null;
  private rampTexture: THREE.DataTexture;

  private updateMat: THREE.ShaderMaterial;
  private fadeMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private pointsMat: THREE.ShaderMaterial;
  private updateScene: THREE.Scene;
  private fadeScene: THREE.Scene;
  private compositeScene: THREE.Scene;
  private pointsScene: THREE.Scene;

  private trailRead: THREE.WebGLRenderTarget;
  private trailWrite: THREE.WebGLRenderTarget;
  private prevCamMatrix = new THREE.Matrix4();

  static isSupported(renderer: THREE.WebGLRenderer): boolean {
    return renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  }

  constructor(
    renderer: THREE.WebGLRenderer,
    wind: WindField,
    stateSize: number, // 粒子数 = stateSize^2
    particleRadius: number,
    globeRadius: number,
  ) {
    this.renderer = renderer;
    this.rampTexture = makeRampTexture();

    // 初期状態: 一様分布 + 寿命をばらけさせる
    const count = stateSize * stateSize;
    const init = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const maxAge = 120 + Math.random() * 360;
      init[i * 4] = Math.random() * 360 - 180;
      init[i * 4 + 1] = Math.max(
        -85,
        Math.min(85, (Math.asin(Math.random() * 2 - 1) * 180) / Math.PI),
      );
      init[i * 4 + 2] = Math.random() * maxAge;
      init[i * 4 + 3] = maxAge;
    }
    this.initTexture = new THREE.DataTexture(
      init,
      stateSize,
      stateSize,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.initTexture.minFilter = THREE.NearestFilter;
    this.initTexture.magFilter = THREE.NearestFilter;
    this.initTexture.needsUpdate = true;
    this.uState.value = this.initTexture;

    this.stateRead = makeStateTarget(stateSize);
    this.stateWrite = makeStateTarget(stateSize);

    this.setWind(wind);

    this.updateMat = new THREE.ShaderMaterial({
      uniforms: {
        uState: this.uState,
        uWind: this.uWind,
        uGrid: this.uGrid,
        uGridSize: this.uGridSize,
        uK: { value: BASE_DEG_PER_FRAME },
        uTime: { value: 0 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: UPDATE_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.updateScene = makeQuadScene(this.updateMat);

    this.fadeMat = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: null },
        uFade: { value: this.trailFade },
      },
      vertexShader: QUAD_VS,
      fragmentShader: FADE_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.fadeScene = makeQuadScene(this.fadeMat);

    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: { uTrail: { value: null } },
      vertexShader: QUAD_VS,
      fragmentShader: COMPOSITE_FS,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeScene = makeQuadScene(this.compositeMat);

    // 粒子 (1 頂点 = 1 粒子、position.xy = 状態テクスチャの UV)
    const refs = new Float32Array(count * 3);
    for (let j = 0; j < stateSize; j++) {
      for (let i = 0; i < stateSize; i++) {
        const idx = (j * stateSize + i) * 3;
        refs[idx] = (i + 0.5) / stateSize;
        refs[idx + 1] = (j + 0.5) / stateSize;
      }
    }
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(refs, 3));
    this.pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uState: this.uState,
        uWind: this.uWind,
        uGrid: this.uGrid,
        uGridSize: this.uGridSize,
        uRamp: { value: this.rampTexture },
        uPointSize: { value: Math.max(1, renderer.getPixelRatio()) },
        uRadius: { value: particleRadius },
      },
      vertexShader: POINT_VS,
      fragmentShader: POINT_FS,
      transparent: true,
      blending: THREE.NormalBlending,
      depthTest: true,
      depthWrite: false,
    });
    const points = new THREE.Points(pointsGeo, this.pointsMat);
    points.frustumCulled = false;
    points.renderOrder = 1;

    // 蓄積バッファ内で裏側を隠すための深度専用の地球
    const depthGlobe = new THREE.Mesh(
      new THREE.SphereGeometry(globeRadius, 64, 32),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
    );
    depthGlobe.renderOrder = 0;

    this.pointsScene = new THREE.Scene();
    this.pointsScene.add(depthGlobe);
    this.pointsScene.add(points);

    const { trailA, trailB } = this.makeTrailTargets();
    this.trailRead = trailA;
    this.trailWrite = trailB;
  }

  private makeTrailTargets(): { trailA: THREE.WebGLRenderTarget; trailB: THREE.WebGLRenderTarget } {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const make = () => {
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
      });
      rt.texture.generateMipmaps = false;
      return rt;
    };
    const trailA = make();
    const trailB = make();
    // 未初期化のテクスチャを読まないよう明示的にクリアしておく
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(trailA);
    this.renderer.clear(true, true, false);
    this.renderer.setRenderTarget(trailB);
    this.renderer.clear(true, true, false);
    this.renderer.setRenderTarget(prev);
    return { trailA, trailB };
  }

  setWind(wind: WindField): void {
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

    this.windTexture?.dispose();
    this.windTexture = tex;
    this.uWind.value = tex;
    this.uGrid.value.set(wind.lo1, wind.la1, wind.dx, wind.dy);
    this.uGridSize.value.set(nx, ny);
  }

  // 毎フレーム、メインシーンの描画前に呼ぶ
  update(camera: THREE.PerspectiveCamera): void {
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // 1) 粒子状態の更新 (ping-pong)
    this.updateMat.uniforms.uK.value = BASE_DEG_PER_FRAME * this.speedFactor;
    this.updateMat.uniforms.uTime.value = (performance.now() - this.startTime) / 1000;
    renderer.setRenderTarget(this.stateWrite);
    renderer.render(this.updateScene, this.quadCam);
    [this.stateRead, this.stateWrite] = [this.stateWrite, this.stateRead];
    this.uState.value = this.stateRead.texture;
    if (this.initTexture) {
      this.initTexture.dispose();
      this.initTexture = null;
    }

    // 2) 軌跡の蓄積: 前フレームを減衰コピー → 地球の深度 → 粒子を点描
    camera.updateMatrixWorld();
    const moving = !this.prevCamMatrix.equals(camera.matrixWorld);
    this.prevCamMatrix.copy(camera.matrixWorld);
    this.fadeMat.uniforms.uFade.value = moving
      ? Math.min(this.trailFade, MOVING_FADE)
      : this.trailFade;
    this.fadeMat.uniforms.uPrev.value = this.trailRead.texture;

    renderer.setRenderTarget(this.trailWrite);
    renderer.clear(true, true, false);
    renderer.render(this.fadeScene, this.quadCam);
    renderer.render(this.pointsScene, camera);
    [this.trailRead, this.trailWrite] = [this.trailWrite, this.trailRead];

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  // メインシーンの描画後に呼び、蓄積した軌跡を画面に加算合成する
  composite(): void {
    const renderer = this.renderer;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.compositeMat.uniforms.uTrail.value = this.trailRead.texture;
    renderer.render(this.compositeScene, this.quadCam);
    renderer.autoClear = prevAutoClear;
  }

  resize(): void {
    this.trailRead.dispose();
    this.trailWrite.dispose();
    const { trailA, trailB } = this.makeTrailTargets();
    this.trailRead = trailA;
    this.trailWrite = trailB;
  }

  dispose(): void {
    this.stateRead.dispose();
    this.stateWrite.dispose();
    this.trailRead.dispose();
    this.trailWrite.dispose();
    this.initTexture?.dispose();
    this.windTexture?.dispose();
    this.rampTexture.dispose();
    for (const scene of [this.updateScene, this.fadeScene, this.compositeScene, this.pointsScene]) {
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    }
  }
}
