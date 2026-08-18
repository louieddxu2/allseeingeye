import * as THREE from 'three';
import { MindARThree } from './vendor/mindar-image-three.prod.js';

// ---------------------------------------------------------------------------
// Parameters & Configurations
// ---------------------------------------------------------------------------
const CONFIG = {
  TRIGGER_MIN_FRACTION: 0.2,
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
  'targets.mind',
  'anim01.mp4',
  'anim02.mp4',
  'anim03.mp4',
  'anim04.mp4',
  'three.module.js',
  'mindar-image-three.prod.js'
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
// Strict & Reliable Offline Cache Verification
// ---------------------------------------------------------------------------
async function verifyOfflineAssetsCached() {
  if (!('caches' in window)) return false;
  try {
    const cache = await caches.open('all-seeing-eye-v8');
    const flag = await cache.match('./offline-ready-flag');
    if (flag) {
      return true;
    }
    const keys = await cache.keys();
    if (keys.length === 0) return false;

    let foundCount = 0;
    for (const file of CRITICAL_OFFLINE_FILES) {
      const match = await cache.match(file, { ignoreSearch: true });
      if (match && match.ok) {
        foundCount++;
      } else {
        const foundInKeys = keys.some(req => req.url.includes(file));
        if (foundInKeys) foundCount++;
      }
    }
    return foundCount >= CRITICAL_OFFLINE_FILES.length - 1;
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
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then((reg) => {
      console.log('[App] SW registered with scope:', reg.scope);
      reg.update().catch(() => {});
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
        if (event.data.progress >= 100) {
          el.textContent = 'Offline Mode Ready ✔';
          el.style.color = '#7ef07e';
        } else {
          el.textContent = `Downloading offline assets: ${event.data.progress}%`;
          el.style.color = '#e2b763';
        }
      }
    } else if (event.data.type === 'CACHE_COMPLETE') {
      updateCacheStatusUI('Offline Mode Ready ✔', true);
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
  v.preload = 'auto';
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.crossOrigin = 'anonymous';
  videos[id] = v;
}

const warmed = new Set();
function warmVideo(videoId) {
  const v = videos[videoId];
  if (!v) return;
  if (!warmed.has(videoId)) {
    warmed.add(videoId);
    v.preload = 'auto';
    v.load();
  }
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
    videoTextures[videoId].minFilter = THREE.LinearFilter;
    videoTextures[videoId].magFilter = THREE.LinearFilter;
    videoTextures[videoId].generateMipmaps = false;
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
let cooldownStart = 0;

for (const [id, v] of Object.entries(videos)) {
  v.addEventListener('ended', () => {
    if (active && active.meta.video === id) {
      videoEnded = true;
    }
  });
}

function startPlayback(entry) {
  active = entry;
  videoEnded = false;
  warmVideo(entry.meta.video);

  const video = videos[entry.meta.video];
  const tex = textureFor(entry.meta.video);
  tex.needsUpdate = true;
  maskMaterial.uniforms.map.value = tex;
  maskMaterial.needsUpdate = true;

  if (videoPlane.parent) {
    videoPlane.parent.remove(videoPlane);
  }
  entry.anchor.group.add(videoPlane);

  video.currentTime = 0;
  video.muted = isMuted;

  const playVideo = () => {
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        setMuteState(true);
        video.play().catch((e) => console.error('Muted video play failed:', e));
      });
    }
  };

  if (video.readyState >= 2) {
    playVideo();
  } else {
    video.load();
    const onCanPlay = () => {
      video.removeEventListener('canplay', onCanPlay);
      playVideo();
    };
    video.addEventListener('canplay', onCanPlay);
    playVideo();
  }

  mode = 'PLAYING';
}

function stopPlayback() {
  if (active) {
    const video = videos[active.meta.video];
    video.pause();
    video.currentTime = 0;
    if (videoPlane.parent === active.anchor.group) {
      active.anchor.group.remove(videoPlane);
    }
    active = null;
  }
  mode = 'COOLDOWN';
  cooldownStart = performance.now();
}

function forceResetScan() {
  stopPlayback();
  mode = 'IDLE';
  cooldownStart = 0;
  for (const entry of anchors) {
    if (entry.state.visible) {
      entry.state.foundAt = performance.now();
    } else {
      entry.state.foundAt = 0;
    }
    entry.state.lostAt = 0;
  }

  const resetBtn = document.getElementById('btn-reset-scan');
  if (resetBtn) {
    resetBtn.style.opacity = '0.5';
    setTimeout(() => { resetBtn.style.opacity = '1'; }, 300);
  }
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
    if (active) {
      const tex = videoTextures[active.meta.video];
      if (tex) tex.needsUpdate = true;
    }

    if (videoEnded) {
      stopPlayback();
    } else if (!active.state.visible && now - active.state.lostAt > CONFIG.LOST_GRACE_MS) {
      stopPlayback();
    }

  } else if (mode === 'COOLDOWN') {
    if (now - cooldownStart >= CONFIG.ALL_CLEAR_MS) {
      mode = 'IDLE';
      for (const entry of anchors) {
        if (entry.state.visible) {
          entry.state.foundAt = now;
        }
      }
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
    if (active) {
      const v = videos[active.meta.video];
      if (v) v.play().catch(() => {});
    }
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

// Return to Menu / Stop Camera Handler
const stopBtn = document.getElementById('btn-stop');
if (stopBtn) {
  stopBtn.addEventListener('click', () => stopCamera(false));
}

// Force Reset Scan Handler
const resetBtn = document.getElementById('btn-reset-scan');
if (resetBtn) {
  resetBtn.addEventListener('click', forceResetScan);
}

// Mobile Hardware/Gesture Back Button Interception
window.addEventListener('popstate', () => {
  const overlay = document.getElementById('overlay');
  const isCameraActive = overlay && overlay.classList.contains('hidden');
  if (isCameraActive) {
    // Intercept back gesture: Return to menu instead of closing/navigating away
    stopCamera(true);
  }
});

async function stopCamera(fromPopState = false) {
  stopPlayback();
  mode = 'IDLE';

  for (const e of anchors) {
    e.state.visible = false;
    e.state.foundAt = 0;
    e.state.lostAt = 0;
  }

  try {
    renderer.setAnimationLoop(null);
    await mindarThree.stop();
  } catch (err) {
    console.warn('MindAR stop warning:', err);
  }

  // Release raw video tracks to completely turn off camera hardware light
  if (mindarThree.video) {
    const stream = mindarThree.video.srcObject;
    if (stream && stream.getTracks) {
      stream.getTracks().forEach((track) => track.stop());
    }
    mindarThree.video.srcObject = null;
  }

  // Hide AR-mode UI elements
  document.getElementById('control-bar')?.classList.remove('active');
  document.getElementById('btn-reset-scan')?.classList.remove('active');
  hud.style.visibility = 'hidden';
  hudVisible = false;
  if (hudBtn) hudBtn.style.background = 'rgba(27, 30, 34, 0.75)';

  document.getElementById('overlay')?.classList.remove('hidden');

  // If stopped via UI button (not popstate), pop the history entry
  if (!fromPopState && history.state && history.state.page === 'camera') {
    history.back();
  }
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

  for (const [id, v] of Object.entries(VIDEO_FILES)) {
    warmVideo(id);
  }

  try {
    await mindarThree.start();
  } catch (err) {
    console.error('MindAR start error:', err);
    if (errorEl) errorEl.textContent = 'Could not start camera: ' + (err.message || err);
    showCameraError(err);
    return;
  }

  // Push history state to intercept mobile back gesture
  if (!history.state || history.state.page !== 'camera') {
    history.pushState({ page: 'camera' }, '', '#camera');
  }

  document.getElementById('overlay')?.classList.add('hidden');
  document.getElementById('control-bar')?.classList.add('active');
  document.getElementById('btn-reset-scan')?.classList.add('active');

  renderer.setAnimationLoop(() => {
    scene.updateMatrixWorld(true);
    update(performance.now());
    updateHud();
    renderer.render(scene, camera);
  });
}

document.getElementById('start')?.addEventListener('click', start);
