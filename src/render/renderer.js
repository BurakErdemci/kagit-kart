// game.renderer IS the THREE.WebGLRenderer, extended with: setTheme, sunTarget, sun, ambient, sky,
// theme, quality, setQuality, resize, updateWorld(camera). info.autoReset is off: core resets per frame
// so renderer.info.render covers the shadow pass, the scene and the post quad together.
import * as THREE from 'three';
import { BOOK_THEME } from '../core/config.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vDir = normalize( wp.xyz - cameraPosition );
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

// A painted paper backdrop: a two-tone wash laid in hard-edged brush bands whose edges wander around
// the horizon, with brush streaks and paper fibre. No sun disc: scenery hangs its own cut-paper sun/moon.
const SKY_FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uBottom;
uniform sampler2D uGrain;
uniform float uBands;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  float az = atan( d.z, d.x ) / 6.2831853 + 0.5;
  float h = clamp( d.y * 1.4 + 0.02, 0.0, 1.0 );
  float t = smoothstep( 0.0, 1.0, sqrt( h ) );
  float wob = 0.02 * sin( az * 18.85 + 1.3 ) + 0.013 * sin( az * 43.98 + 0.4 ) + 0.007 * sin( az * 106.8 + 2.1 );
  float tb = clamp( t + wob * ( 1.0 - t ), 0.0, 0.9999 ) * uBands;
  float bi = floor( tb ), bf = fract( tb );
  float up = smoothstep( 1.0 - max( fwidth( tb ), 1e-4 ), 1.0, bf );
  float tq = ( bi + up + 0.25 + 0.5 * bf * ( 1.0 - up ) ) / uBands;
  vec3 col = mix( uBottom, uTop, clamp( tq, 0.0, 1.0 ) );
  col *= 1.0 - 0.05 * ( 1.0 - smoothstep( 0.0, 0.07, bf ) ) * step( 0.5, bi );
  // lod 0: the azimuth wraps from 1 to 0 behind the viewer, and a derivative-picked mip would draw a seam
  float streak = textureLod( uGrain, vec2( az * 5.0, d.y * 26.0 ), 0.0 ).r;
  float fibre = textureLod( uGrain, vec2( az * 24.0, d.y * 20.0 ), 0.0 ).r;
  col *= 1.0 + ( streak - 0.92 ) * 0.5 + ( fibre - 0.92 ) * 0.35;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createRenderer(game, container) {
  const { config } = game;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  // Hard shadows all the same: paper materials cut this filtered lookup at 50 % (materials.js SHADOW_PARS),
  // which keeps a printed hard edge without BasicShadowMap's texel stair-steps.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  renderer.setClearColor(0xf3ead3, 1);

  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Kâğıt Kart oyun alanı');
  container.appendChild(canvas);

  // Count shadow-pass draw calls separately (the pass runs inside renderer.render()).
  renderer.shadowCalls = 0;
  const shadowRender = renderer.shadowMap.render;
  renderer.shadowMap.render = function (...args) {
    const before = renderer.info.render.calls;
    shadowRender.apply(this, args);
    renderer.shadowCalls += renderer.info.render.calls - before;
  };

  const scene = new THREE.Scene();
  scene.name = 'main';
  const camera = new THREE.PerspectiveCamera(60, 1, config.camera.near, config.camera.far);

  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.name = 'sun';
  sun.castShadow = true;
  const ext = config.render.shadowExtent;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: config.render.shadowDistance * 2 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 0;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);

  const ambient = new THREE.AmbientLight(0xffffff, 1);
  ambient.name = 'ambient';
  scene.add(ambient);

  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
      uGrain: { value: null }, uBands: { value: 7 },
    },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), skyMat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  scene.fog = new THREE.Fog(0xffffff, 100, 500);

  const sunDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
  const sunTarget = new THREE.Vector3();
  const lightRight = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const lead = new THREE.Vector3();

  function setTheme(theme) {
    const t = theme || BOOK_THEME;
    renderer.theme = t;
    scene.fog.color.set(t.fog.color);
    scene.fog.near = t.fog.near;
    scene.fog.far = t.fog.far;
    skyMat.uniforms.uTop.value.set(t.skyTop);
    skyMat.uniforms.uBottom.value.set(t.skyBottom);
    // materials are created after the renderer; the first themed call after that hands over the grain
    if (!skyMat.uniforms.uGrain.value && game.materials) skyMat.uniforms.uGrain.value = game.materials.textures.grain;
    sunDir.set(...t.sun.dir).normalize();
    sun.color.set(t.sun.color);
    sun.intensity = t.sun.intensity;
    ambient.color.set(t.ambient.color);
    ambient.intensity = t.ambient.intensity;
    renderer.setClearColor(t.fog.color, 1);
    game.materials?.setInk(t.ink);
    game.post?.setInk(t.ink);
    lightRight.crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
    if (lightRight.lengthSq() < 1e-6) lightRight.set(1, 0, 0);
    lightUp.crossVectors(sunDir, lightRight).normalize();
  }

  // Sun follows sunTarget pushed ahead along the view, snapped to shadow texels so hard edges do not crawl.
  function updateWorld(cam) {
    sky.position.copy(cam.position);
    const size = sun.shadow.mapSize.x || 1024;
    const texel = (2 * ext) / size;
    cam.getWorldDirection(lead).setY(0);
    if (lead.lengthSq() > 1e-6) lead.normalize().multiplyScalar(config.render.shadowLead);
    tmp.copy(sunTarget).add(lead);
    const u = tmp.dot(lightRight), v = tmp.dot(lightUp);
    tmp.addScaledVector(lightRight, Math.round(u / texel) * texel - u);
    tmp.addScaledVector(lightUp, Math.round(v / texel) * texel - v);
    sun.target.position.copy(tmp);
    sun.position.copy(tmp).addScaledVector(sunDir, config.render.shadowDistance);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  // Shadow-pass programs compile the first time a caster is drawn in the sun's frustum, which follows the
  // player, so a caster down the track, or one that is hidden until it pops up, would compile mid-race.
  // Race setup (after compileAsync) calls this once: every caster is shown for one draw with the frustum
  // over the whole box, then everything is put back. `draw` must render offscreen.
  // three.js shares one depth material and re-picks its program only when instancing or skinning
  // changes between draws, so the variant (side, uv) a caster needs compiles whenever the draw order
  // first puts it after such a switch. Bumping the material before every warm draw compiles them all.
  const bumpDepth = (r, o, cam, sc, geo, depthMaterial) => { depthMaterial.needsUpdate = true; };
  function warmShadows(box, draw) {
    if (!renderer.shadowMap.enabled || !sun.castShadow) return;
    const shown = [], counts = [], hooked = [];
    scene.traverse((o) => {
      if (!o.castShadow || !(o.isMesh || o.isLine || o.isPoints)) return;
      if (o.isInstancedMesh && o.count === 0) { counts.push(o); o.count = 1; }
      for (let p = o; p; p = p.parent) if (!p.visible) { p.visible = true; shown.push(p); }
      if (!Object.prototype.hasOwnProperty.call(o, 'onBeforeShadow')) { o.onBeforeShadow = bumpDepth; hooked.push(o); }
    });
    const sc = sun.shadow.camera;
    const saved = [sc.left, sc.right, sc.top, sc.bottom, sc.near, sc.far];
    const c = box.getCenter(tmp);
    const r = box.getSize(lead).length() / 2 + 10;
    Object.assign(sc, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 4 * r });
    sc.updateProjectionMatrix();
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(sunDir, 2 * r);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    try {
      draw();
    } finally {
      [sc.left, sc.right, sc.top, sc.bottom, sc.near, sc.far] = saved;
      sc.updateProjectionMatrix();
      for (const o of shown) o.visible = false;
      for (const o of counts) o.count = 0;
      for (const o of hooked) delete o.onBeforeShadow;
    }
  }

  let quality = 'high';
  function setQuality(level) {
    const prevShadows = renderer.shadowMap.enabled;
    quality = level;
    renderer.quality = level;
    const size = config.render.shadowSize[level] || 0;
    renderer.shadowMap.enabled = size > 0;
    sun.castShadow = size > 0;
    if (size > 0 && sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    if (prevShadows !== renderer.shadowMap.enabled) {
      scene.traverse((o) => {
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true; });
        else if (m) m.needsUpdate = true;
      });
    }
    resize();
  }

  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    const cap = config.render.pixelCap[quality] || config.render.pixelCap.high;
    const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, Math.sqrt(cap / (w * h))));
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    game.materials?.setDotPx(config.render.dotPx * pr);
    game.post?.setSize(w, h, pr);
    renderer.cssWidth = w;
    renderer.cssHeight = h;
  }

  Object.assign(renderer, {
    scene, camera, sun, ambient, sky, sunTarget, setTheme, setQuality, resize, updateWorld, warmShadows,
    theme: BOOK_THEME, quality,
  });
  setTheme(BOOK_THEME);
  return renderer;
}
