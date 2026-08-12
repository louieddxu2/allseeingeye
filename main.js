import * as THREE from 'three';
import { MindARThree } from './vendor/mindar-image-three.prod.js';

// ---------------------------------------------------------------------------
// Parameters & Configurations
// ---------------------------------------------------------------------------
const CONFIG = {
  TRIGGER_MIN_FRACTION: 0.4,
  TRIGGER_SOLID_MS: 1000,
  LOST_GRACE_MS: 1000,
  ALL_CLEAR_MS: 500,
  MAX_TRACK: 3,
  START_MUTED: false,
  FILTER_MIN_CF: null,
  FILTER_BETA: null,
  WARMUP_TOLERANCE: null,
  MISS_TOLERANCE: null,
};

const TARGET_META = [
  { card: 'A', anim: 1, video: 'anim01' },
  { card: 'B', anim: 1, video: 'anim01' },
  { card: 'C', anim: 1, video: 'anim01' },
  { card: 'D', anim: 1, video: 'anim01' },
  { card: 'E', anim: 1, video: 'anim01' },
  { card: 'F', anim: 2, video: 'anim02' },
  { card: 'G', anim: 3, video: 'anim03' },
  { card: 'H', anim: 4, video: 'anim04' },
];

const VIDEO_FILES = {
  anim01: 'assets/anim01.mp4',
  anim02: 'assets/anim02.mp4',
  anim03: 'assets/anim03.mp4',
  anim04: 'assets/anim04.mp4',
};

// Critical assets required for true offline gameplay
const CRITICAL_OFFLINE_FILES = [
  'assets/targets.mind',
  'assets/anim01.mp4',
  'assets/anim02.mp4',
  'assets/anim03.mp4',
  'assets/anim04.mp4',
  'vendor/three.module.js',
  'vendor/mindar-image-three.prod.js'
];

// Global Mute State
let isMuted = CONFIG.START_MUTED;

// Sync Mute State with UI Button & Audio Elements
function setMuteState(muted) {
  isMuted = muted;
  const soundBtn = document.getElementById('btn-sound');
  if (soundBtn) {
    soundBtn.textContent = isMuted ? '🔇' : '🔊';
    soundBtn.title = isMuted ? 'Unmute Sound' : 'Mute Sound';
  }
  for (const v of Object.values(videos)) {
    v.muted = isMuted;
  }
}

// ---------------------------------------------------------------------------
// Strict Offline Cache Verification (No Fake Positives)
// ---------------------------------------------------------------------------
async function verifyOfflineAssetsCached() {
  if (!('caches' in window)) return false;
  try {
    const cache = await caches.open('all-seeing-eye-v1');
    for (const file of CRITICAL_OFFLINE_FILES) {
      const match = await cache.match(file, { ignoreSearch: true });
      if (!match || !match.ok) {
        return false;
      }
    }
    return true;
  } catch (err) {
    return false;
  }
}

async function updateCacheStatusUI(forcedMessage = null, isReady = false) {
  const el = document.getElementById('cache-status');
  if (!el) return;

  if (forcedMessage) {
    el.textContent = forcedMessage;
    el.style.color = isReady ? '#7ef07e' : '#e2b763';
    return;
  }

  const fullyCached = await verifyOfflineAssetsCached();
  if (fullyCached) {
    el.textContent = 'Offline Mode Ready ✔';
    el.style.color = '#7ef07e';
  } else {
    el.textContent = 'Downloading offline assets...';
    el.style.color = '#e2b763';
  }
}

// Register SW & Listen for Caching Events
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' })
    .then((reg) => {
      console.log('[App] SW registered with scope:', reg.scope);
      updateCacheStatusUI();
    })
    .catch((err) => {
      console.warn('[App] SW registration failed:', err);
      updateCacheStatusUI('Online Mode (SW Disabled)', false);
    });

  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (!event.data) return;
    if (event.data.type === 'CACHE_PROGRESS') {
      const el = document.getElementById('cache-status');
      if (el) {
        el.textContent = `Downloading offline assets: ${event.data.progress}%`;
        el.style.color = '#e2b763';
      }
      if (event.data.progress >= 100) {
        updateCacheStatusUI();
      }
    } else if (event.data.type === 'CACHE_COMPLETE') {
      updateCacheStatusUI();
    }
  });

  navigator.serviceWorker.ready.then(() => {
    updateCacheStatusUI();
  });
} else {
  updateCacheStatusUI('Online Mode (No SW)', false);
}

// Check initial cache status on page load
updateCacheStatusUI();

// ---------------------------------------------------------------------------
// Video elements + Masked-video material (2:1 RGB + Alpha mask)
// ---------------------------------------------------------------------------
const videos = {};
const videoTextures = {};
for (const [id, url] of Object.entries(VIDEO_FILES)) {
  const v = document.createElement('video');
  v.src = url;
  v.preload = 'none';
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.crossOrigin = 'anonymous';
  videos[id] = v;
}

const warmed = new Set();
function warmVideo(videoId) {
  if (warmed.has(videoId)) return;
  warmed.add(videoId);
  const v = videos[videoId];
  v.preload = 'auto';
  v.load();
}

const maskMaterial = new THREE.ShaderMaterial({
  transparent: true,
  side: THREE.DoubleSide,
  uniforms: { map: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    varying vec2 vUv;
    void main() {
      vec3 color = texture2D(map, vec2(vUv.x * 0.5, vUv.y)).rgb;
      vec3 mask  = texture2D(map, vec2(0.5 + vUv.x * 0.5, vUv.y)).rgb;
      float alpha = dot(mask, vec3(0.299, 0.587, 0.114));
      gl_FragColor = vec4(color, alpha);
    }
  `,
});

const videoPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), maskMaterial);

function textureFor(videoId) {
  if (!videoTextures[videoId]) {
    videoTextures[videoId] = new THREE.VideoTexture(videos[videoId]);
  }
  return videoTextures[videoId];
}

// ---------------------------------------------------------------------------
// AR Setup
// ---------------------------------------------------------------------------
const mindarThree = new MindARThree({
  container: document.getElementById('container'),
  imageTargetSrc: 'assets/targets.mind',
  maxTrack: CONFIG.MAX_TRACK,
  uiLoading: 'no',
  uiScanning: 'no',
  uiError: 'no',
  filterMinCF: CONFIG.FILTER_MIN_CF,
  filterBeta: CONFIG.FILTER_BETA,
  warmupTolerance: CONFIG.WARMUP_TOLERANCE,
  missTolerance: CONFIG.MISS_TOLERANCE,
});
const { renderer, scene, camera } = mindarThree;

const anchors = TARGET_META.map((meta, i) => {
  const anchor = mindarThree.addAnchor(i);
  const state = { visible: false, foundAt: 0, lostAt: 0 };
  anchor.onTargetFound = () => {
    state.visible = true;
    state.foundAt = performance.now();
    warmVideo(meta.video);
  };
  anchor.onTargetLost = () => {
    state.visible = false;
    state.lostAt = performance.now();
  };
  return { anchor, meta, state };
});

// ---------------------------------------------------------------------------
// Projected card size calculation
// ---------------------------------------------------------------------------
const CORNERS = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const cornerVec = new THREE.Vector3();

function projectedSidePx(group) {
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  const pts = CORNERS.map(([x, y]) => {
    cornerVec.set(x, y, 0).applyMatrix4(group.matrixWorld).project(camera);
    return [(cornerVec.x * 0.5 + 0.5) * w, (-cornerVec.y * 0.5 + 0.5) * h];
  });
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    sum += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return sum / 4;
}

function meetsSizeCriterion(group) {
  const minAxis = Math.min(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
  return projectedSidePx(group) >= CONFIG.TRIGGER_MIN_FRACTION * minAxis;
}

// ---------------------------------------------------------------------------
// State Machine: IDLE -> PLAYING -> COOLDOWN -> IDLE
// ---------------------------------------------------------------------------
let mode = 'IDLE';
let active = null;
let videoEnded = false;
let clearSince = null;

for (const v of Object.values(videos)) {
  v.addEventListener('ended', () => { videoEnded = true; });
}

function startPlayback(entry) {
  active = entry;
  videoEnded = false;
  warmVideo(entry.meta.video);
  const video = videos[entry.meta.video];
  maskMaterial.uniforms.map.value = textureFor(entry.meta.video);
  entry.anchor.group.add(videoPlane);
  video.currentTime = 0;
  video.muted = isMuted;

  video.play().catch(() => {
    // Autoplay with sound blocked -> fallback to muted playback & sync UI state!
    setMuteState(true);
    video.play().catch((err) => console.error('Video playback failed:', err));
  });
  mode = 'PLAYING';
}

function stopPlayback() {
  if (active) {
    const video = videos[active.meta.video];
    video.pause();
    video.currentTime = 0;
    active.anchor.group.remove(videoPlane);
    active = null;
  }
  clearSince = null;
  mode = 'COOLDOWN';
}

function update(now) {
  const anyVisible = anchors.some((e) => e.state.visible);

  if (mode === 'IDLE') {
    let best = null;
    for (const entry of anchors) {
      const s = entry.state;
      if (!s.visible) continue;
      if (now - s.foundAt < CONFIG.TRIGGER_SOLID_MS) continue;
      if (!meetsSizeCriterion(entry.anchor.group)) continue;
      if (!best || entry.meta.anim > best.meta.anim) best = entry;
    }
    if (best) startPlayback(best);

  } else if (mode === 'PLAYING') {
    if (videoEnded) {
      stopPlayback();
    } else if (!active.state.visible && now - active.state.lostAt > CONFIG.LOST_GRACE_MS) {
      stopPlayback();
    }

  } else if (mode === 'COOLDOWN') {
    if (anyVisible) {
      clearSince = null;
    } else {
      if (clearSince === null) clearSince = now;
      if (now - clearSince >= CONFIG.ALL_CLEAR_MS) mode = 'IDLE';
    }
  }
}

// ---------------------------------------------------------------------------
// HUD & Main Loop
// ---------------------------------------------------------------------------
const hud = document.getElementById('hud');
let lastHud = '';

function updateHud() {
  const visible = anchors.filter((e) => e.state.visible).map((e) => e.meta.card);
  const text = `${mode}${active ? ' ' + active.meta.card + ' -> ' + active.meta.video : ''}`
    + (visible.length ? `\nvisible: ${visible.join(', ')}` : '');
  if (text !== lastHud) { hud.textContent = text; lastHud = text; }
}

// ---------------------------------------------------------------------------
// UI Event Handlers & Control Bar
// ---------------------------------------------------------------------------
const soundBtn = document.getElementById('btn-sound');
if (soundBtn) {
  soundBtn.addEventListener('click', () => {
    setMuteState(!isMuted);
  });
}

const fsBtn = document.getElementById('btn-fullscreen');
if (fsBtn) {
  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
}

const hudBtn = document.getElementById('btn-hud');
let hudVisible = false;
if (hudBtn) {
  hudBtn.addEventListener('click', () => {
    hudVisible = !hudVisible;
    hud.style.visibility = hudVisible ? 'visible' : 'hidden';
    hudBtn.style.background = hudVisible ? 'rgba(226, 183, 99, 0.6)' : 'rgba(27, 30, 34, 0.75)';
  });
}

// iOS Installation Banner Detection
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
if (isIOS && !isStandalone) {
  const iosBanner = document.getElementById('ios-install-banner');
  if (iosBanner) iosBanner.style.display = 'block';
  document.getElementById('close-ios-banner')?.addEventListener('click', () => {
    iosBanner.style.display = 'none';
  });
}

// Camera Error Modal Handler
function showCameraError(err) {
  const modal = document.getElementById('camera-modal');
  const msgEl = document.getElementById('camera-error-msg');
  if (msgEl) {
    msgEl.textContent = 'Could not start camera: ' + (err.message || err) + '. Please check camera permissions.';
  }
  if (modal) modal.classList.add('active');
}

document.getElementById('modal-close-btn')?.addEventListener('click', () => {
  document.getElementById('camera-modal')?.classList.remove('active');
});

// ---------------------------------------------------------------------------
// App Startup Function
// ---------------------------------------------------------------------------
async function start() {
  const errorEl = document.getElementById('error');
  if (errorEl) errorEl.textContent = '';

  // iOS Safari User Gesture Unlock: Unlock all video elements
  for (const v of Object.values(videos)) {
    v.muted = isMuted;
    const p = v.play();
    v.pause();
    v.currentTime = 0;
    if (p) p.catch(() => {});
  }

  try {
    await mindarThree.start();
  } catch (err) {
    console.error('MindAR start error:', err);
    if (errorEl) errorEl.textContent = 'Could not start camera: ' + (err.message || err);
    showCameraError(err);
    return;
  }

  document.getElementById('overlay')?.classList.add('hidden');

  renderer.setAnimationLoop(() => {
    scene.updateMatrixWorld(true);
    update(performance.now());
    updateHud();
    renderer.render(scene, camera);
  });
}

document.getElementById('start')?.addEventListener('click', start);
