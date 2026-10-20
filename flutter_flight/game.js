// 훨훨 — three.js(전역 THREE)와 pose.js(전역 PoseTracker)를 먼저 불러온 뒤 실행된다.
// 새는 -z 방향으로 날아간다. x는 오른쪽, y는 위쪽.
(() => {
const T = THREE;

// ───────────── 상수 ─────────────
const LANE = 13;             // 좌우 비행 범위 ±
const CEIL = 30;             // 구름 천장
const GRAVITY = 8;
const GLIDE_GRAVITY = 3;
const GLIDE_MAX_FALL = 2.5;
const FLAP_V = 5.5;
const STEER = 11;            // 최대 좌우 속도
const BIRD_R = 0.55;
const START_SPEED = 14, MAX_SPEED = 27, ACCEL = 0.12;
const VIEW = 110;            // 앞쪽으로 미리 만들어 두는 거리
const BIOME_LEN = 600;
const HEARTS = 3;

const BIOMES = [
  { name: '초원', sky: 0xa9dcff, fog: 0xcdeaff, ground: 0x8fd16a, hint: '나무와 열기구를 피해 날아가세요' },
  { name: '협곡', sky: 0xffd9a8, fog: 0xffe6c4, ground: 0xd9a86a, hint: '바위벽의 구멍을 통과하세요!' },
  { name: '폭풍 구름', sky: 0x6f7896, fog: 0x8a92ad, ground: 0x5f8a62, hint: '⚡ 노란 기둥이 번쩍이면 옆으로 피하세요!' },
  { name: '바람개비 언덕', sky: 0xbfe8ff, fog: 0xdaf2ff, ground: 0x9ad97a, hint: '돌아가는 날개 사이를 지나 고리를 통과하세요' },
];

// ───────────── 유틸 ─────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ───────────── 사운드 ─────────────
const sfx = {
  ctx: null,
  ensure() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.45;
        this.out.connect(this.ctx.destination);
        const n = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, n, n);
        const ch = this.noise.getChannelData(0);
        for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  },
  env(node, vol, a, d, t) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    node.connect(g).connect(this.out);
  },
  tone(f, d, type = 'sine', vol = 0.2, delay = 0, to = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    this.env(o, vol, 0.005, d, t);
    o.start(t); o.stop(t + d + 0.05);
  },
  noiseHit(freq, d, vol, type = 'bandpass', q = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f);
    this.env(f, vol, 0.005, d, t);
    s.start(t, Math.random() * 0.5); s.stop(t + d + 0.05);
  },
  flap() { this.noiseHit(700, 0.18, 0.3, 'bandpass', 0.8); },
  seed() { this.tone(1200 + Math.random() * 300, 0.08, 'triangle', 0.12); },
  ring() { [880, 1320, 1760].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.12, i * 0.06)); },
  heart() { [660, 990].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.15, i * 0.1)); },
  hit() { this.tone(220, 0.35, 'sawtooth', 0.12, 0, 90); this.noiseHit(300, 0.3, 0.3, 'lowpass'); },
  zap() { this.noiseHit(4000, 0.4, 0.3, 'highpass'); this.tone(90, 0.5, 'sawtooth', 0.15, 0, 40); },
  warn() { this.tone(1046, 0.08, 'square', 0.05); },
  biome() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, i * 0.12)); },
  over() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.12, i * 0.2)); },
};

// ───────────── 3D 기본 ─────────────
const canvas = document.getElementById('scene');
const renderer = new T.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new T.Scene();
scene.background = new T.Color(BIOMES[0].sky);
scene.fog = new T.Fog(BIOMES[0].fog, 40, VIEW);
const camera = new T.PerspectiveCamera(70, 1, 0.05, 260);
scene.add(camera);
const hemi = new T.HemisphereLight(0xffffff, 0x88aa66, 0.8);
const sun = new T.DirectionalLight(0xffffff, 0.6);
sun.position.set(-20, 40, 10);
scene.add(hemi, sun);

const ramp = new T.DataTexture(new Uint8Array([100, 180, 255]), 3, 1, T.RedFormat);
ramp.minFilter = ramp.magFilter = T.NearestFilter;
ramp.needsUpdate = true;
const toon = (color, extra = {}) => new T.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
const basic = (color, extra = {}) => new T.MeshBasicMaterial({ color, ...extra });
const M = {
  trunk: toon(0x8a5a3a), leaf: toon(0x4fb35a), leaf2: toon(0x6cc86a), rock: toon(0xb88a5c), rock2: toon(0xa57a50),
  balloon: [toon(0xff6b6b), toon(0xffc94d), toon(0x6bb8ff), toon(0xb08cff)], basket: toon(0x9a6a3c),
  seed: toon(0xffd34d, { emissive: 0x664400 }), ring: toon(0xff8ad0, { emissive: 0x551133 }), heart: toon(0xff4d6d, { emissive: 0x550011 }),
  white: toon(0xffffff), mill: toon(0xf4efe6), blade: toon(0xe2483f), eagle: toon(0x5a3d2b), eagleHead: toon(0xf4efe6), beakY: toon(0xffb31a),
  cloud: basic(0xffffff, { transparent: true, opacity: 0.9 }), stormCloud: basic(0x6b7290, { transparent: true, opacity: 0.95 }),
};
const G = {
  trunk: new T.CylinderGeometry(0.35, 0.45, 1, 7),
  cone: new T.ConeGeometry(1, 1, 8),
  sphere: new T.SphereGeometry(1, 18, 12),
  box: new T.BoxGeometry(1, 1, 1),
  cyl: new T.CylinderGeometry(1, 1, 1, 10),
  seed: new T.SphereGeometry(0.32, 10, 8),
  ring: new T.TorusGeometry(2.2, 0.28, 8, 28),
  heart: new T.SphereGeometry(0.45, 12, 10),
  puff: new T.IcosahedronGeometry(1, 1),
};
const mesh = (geo, mat) => new T.Mesh(geo, mat);

// 1인칭 날개 (카메라에 붙인다)
const wings = [];
for (const side of [-1, 1]) {
  const pivot = new T.Group();
  pivot.position.set(side * 0.62, -0.58, -1.25);
  const wing = new T.Group();
  const feathers = [0xffc94d, 0xffb02e, 0xff9a1a];
  feathers.forEach((c, k) => {
    const f = mesh(G.sphere, toon(c));
    f.scale.set(0.34 - k * 0.05, 0.035, 0.13);
    f.position.set(side * (0.28 + k * 0.2), -k * 0.025, 0.03 + k * 0.05);
    wing.add(f);
  });
  pivot.add(wing);
  camera.add(pivot);
  wings.push({ pivot, side });
}

// 땅과 하늘 장식
const ground = mesh(new T.PlaneGeometry(1600, 1600), toon(BIOMES[0].ground));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const decor = new T.Group();
scene.add(decor);
const clouds = [];
function makeCloud(storm) {
  const g = new T.Group();
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const p = mesh(G.puff, storm ? M.stormCloud : M.cloud);
    const s = rand(1.6, 3);
    p.scale.set(s * 1.3, s * 0.8, s);
    p.position.set(i * 2.2 - n, rand(-0.5, 0.5), rand(-1, 1));
    g.add(p);
  }
  return g;
}

// ───────────── 상태 ─────────────
const bird = { x: 0, y: 8, z: 0, vx: 0, vy: 0, speed: START_SPEED, hearts: HEARTS, invuln: 0, flapAnim: 0, glide: false };
const game = {
  screen: 'title', mode: 'keyboard', phase: 'ready', readyT: 0, lostT: 0, time: 0, dist: 0, seeds: 0, rings: 0, biome: -1, nextZ: -40,
  obstacles: [], items: [], shake: 0, flash: 0, hint: '', hintT: 0, banner: 0, lastFlaps: 0, frozen: false,
  input: { flap: 0, flapStrength: 1, lean: 0, glide: false },
};
let tracker = null;
const keys = new Set();

// ───────────── 충돌 ─────────────
// 장애물마다 충돌체 목록을 가진다: sphere / cyl(세로 원기둥) / cone(원뿔) / box / seg(굵은 선분)
function colliderDist(c, p) {
  switch (c.type) {
    case 'sphere': return Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) - c.r;
    case 'cyl': {
      const dxz = Math.hypot(p.x - c.x, p.z - c.z) - c.r;
      const dy = Math.max(c.y0 - p.y, p.y - c.y1, 0);
      return dy > 0 ? Math.hypot(Math.max(dxz, 0), dy) : dxz;
    }
    case 'cone': {
      if (p.y < c.y0) return Math.hypot(Math.max(0, Math.hypot(p.x - c.x, p.z - c.z) - c.r), c.y0 - p.y);
      const k = clamp(1 - (p.y - c.y0) / c.h, 0, 1);
      const d = Math.hypot(p.x - c.x, p.z - c.z) - c.r * k;
      return p.y > c.y0 + c.h ? Math.hypot(Math.max(d, 0), p.y - c.y0 - c.h) : d * 0.85;
    }
    case 'box': {
      const dx = Math.max(c.x0 - p.x, 0, p.x - c.x1), dy = Math.max(c.y0 - p.y, 0, p.y - c.y1), dz = Math.max(c.z0 - p.z, 0, p.z - c.z1);
      return Math.hypot(dx, dy, dz);
    }
    case 'seg': {
      const ax = c.ax, ay = c.ay, bx = c.bx, by = c.by;
      const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
      const t = l2 ? clamp(((p.x - ax) * vx + (p.y - ay) * vy) / l2, 0, 1) : 0;
      return Math.hypot(p.x - (ax + vx * t), p.y - (ay + vy * t), p.z - c.z) - c.r;
    }
  }
  return Infinity;
}

// ───────────── 장애물 만들기 ─────────────
function addObstacle(o) { scene.add(o.group); game.obstacles.push(o); return o; }

function tree(x, z, h) {
  const g = new T.Group();
  const trunk = mesh(G.trunk, M.trunk);
  trunk.scale.y = h * 0.3;
  trunk.position.y = h * 0.15;
  const top = mesh(G.cone, Math.random() < 0.5 ? M.leaf : M.leaf2);
  const r = h * 0.28;
  top.scale.set(r, h * 0.8, r);
  top.position.y = h * 0.3 + h * 0.4;
  g.add(trunk, top);
  g.position.set(x, 0, z);
  return addObstacle({ kind: 'tree', group: g, z, colliders: [
    { type: 'cyl', x, z, r: 0.45, y0: 0, y1: h * 0.3 },
    { type: 'cone', x, z, r, y0: h * 0.3, h: h * 0.8 },
  ] });
}

function balloon(x, y, z) {
  const g = new T.Group();
  const env = mesh(G.sphere, pick(M.balloon));
  env.scale.set(2.3, 2.6, 2.3);
  const basket = mesh(G.box, M.basket);
  basket.scale.set(1.1, 0.8, 1.1);
  basket.position.y = -3.6;
  for (const sx of [-0.5, 0.5]) {
    const rope = mesh(G.cyl, M.basket);
    rope.scale.set(0.04, 1.4, 0.04);
    rope.position.set(sx, -2.7, 0);
    g.add(rope);
  }
  g.add(env, basket);
  g.position.set(x, y, z);
  const o = { kind: 'balloon', group: g, z, baseY: y, phase: rand(0, 6), colliders: [{ type: 'sphere', x, y, z, r: 2.4 }, { type: 'sphere', x, y: y - 3.6, z, r: 0.8 }] };
  o.update = (t) => {
    const yy = o.baseY + Math.sin(t * 0.9 + o.phase) * 1.5;
    g.position.y = yy;
    o.colliders[0].y = yy; o.colliders[1].y = yy - 3.6;
  };
  return addObstacle(o);
}

function pillar(x, z, r) {
  const g = new T.Group();
  const col = mesh(G.cyl, Math.random() < 0.5 ? M.rock : M.rock2);
  col.scale.set(r, CEIL + 6, r);
  col.position.y = (CEIL + 6) / 2;
  g.add(col);
  for (let k = 0; k < 3; k++) {
    const knob = mesh(G.puff, M.rock2);
    knob.scale.setScalar(r * 0.7);
    knob.position.set(rand(-r, r) * 0.6, rand(3, CEIL), rand(-r, r) * 0.6);
    g.add(knob);
  }
  g.position.set(x, 0, z);
  return addObstacle({ kind: 'pillar', group: g, z, colliders: [{ type: 'cyl', x, z, r: r + 0.1, y0: 0, y1: CEIL + 6 }] });
}

// 구멍 뚫린 바위벽: 구멍(hx, hy, w×h)만 통과할 수 있다
function archWall(z, hx, hy, w, h) {
  const g = new T.Group();
  const thick = 2;
  const x0 = -LANE - 3, x1 = LANE + 3, y0 = 0, y1 = CEIL + 4;
  const parts = [
    [x0, hx - w / 2, y0, y1], [hx + w / 2, x1, y0, y1],
    [hx - w / 2, hx + w / 2, y0, hy - h / 2], [hx - w / 2, hx + w / 2, hy + h / 2, y1],
  ];
  const colliders = [];
  for (const [ax, bx, ay, by] of parts) {
    if (bx - ax < 0.01 || by - ay < 0.01) continue;
    const b = mesh(G.box, Math.random() < 0.5 ? M.rock : M.rock2);
    b.scale.set(bx - ax, by - ay, thick);
    b.position.set((ax + bx) / 2, (ay + by) / 2, z);
    g.add(b);
    colliders.push({ type: 'box', x0: ax, x1: bx, y0: ay, y1: by, z0: z - thick / 2, z1: z + thick / 2 });
  }
  // 구멍 테두리를 밝게 표시해 멀리서도 보이게
  const rim = mesh(new T.TorusGeometry(Math.min(w, h) / 2 + 0.3, 0.18, 6, 24), basic(0xfff3a0));
  rim.position.set(hx, hy, z + thick / 2 + 0.05);
  rim.scale.set(w / Math.min(w, h), h / Math.min(w, h), 1);
  g.add(rim);
  return addObstacle({ kind: 'arch', group: g, z, hole: { x: hx, y: hy, w, h }, colliders });
}

function windmill(x, z) {
  const g = new T.Group();
  const hubY = 13;
  const tower = mesh(G.cyl, M.mill);
  tower.scale.set(0.9, hubY, 0.9);
  tower.position.y = hubY / 2;
  const hub = mesh(G.sphere, M.blade);
  hub.scale.setScalar(0.8);
  hub.position.set(0, hubY, 0.6);
  const rotor = new T.Group();
  rotor.position.set(0, hubY, 0.8);
  const L = 8.5;
  for (let k = 0; k < 3; k++) {
    const arm = new T.Group();
    arm.rotation.z = (k / 3) * Math.PI * 2;
    const blade = mesh(G.box, k === 0 ? M.blade : M.mill);
    blade.scale.set(1.1, L, 0.2);
    blade.position.y = L / 2;
    arm.add(blade);
    rotor.add(arm);
  }
  g.add(tower, hub, rotor);
  g.position.set(x, 0, z);
  const speed = rand(0.7, 1.1) * (Math.random() < 0.5 ? -1 : 1);
  const o = { kind: 'windmill', group: g, z, colliders: [{ type: 'cyl', x, z, r: 1.0, y0: 0, y1: hubY }, { type: 'sphere', x, y: hubY, z: z + 0.6, r: 1 }] };
  const blades = [0, 1, 2].map(() => ({ type: 'seg', ax: x, ay: hubY, bx: x, by: hubY + L, z: z + 0.8, r: 0.7 }));
  o.colliders.push(...blades);
  o.update = (t) => {
    rotor.rotation.z = t * speed;
    blades.forEach((b, k) => {
      const a = rotor.rotation.z + (k / 3) * Math.PI * 2;
      b.bx = x - Math.sin(a) * L;
      b.by = hubY + Math.cos(a) * L;
    });
  };
  return addObstacle(o);
}

function eagle(z) {
  const g = new T.Group();
  const body = mesh(G.sphere, M.eagle);
  body.scale.set(1.0, 0.8, 1.6);
  const head = mesh(G.sphere, M.eagleHead);
  head.scale.setScalar(0.6);
  head.position.set(0, 0.4, 1.4);
  const bk = mesh(G.cone, M.beakY);
  bk.scale.set(0.2, 0.5, 0.2);
  bk.rotation.x = Math.PI / 2;
  bk.position.set(0, 0.3, 2.0);
  const wl = [];
  for (const s of [-1, 1]) {
    const w = mesh(G.box, M.eagle);
    w.scale.set(3.2, 0.15, 1.2);
    w.position.set(s * 1.9, 0.1, 0);
    g.add(w);
    wl.push({ w, s });
  }
  g.add(body, head, bk);
  const y = rand(5, 20), dir = Math.random() < 0.5 ? -1 : 1;
  let x = -dir * LANE;
  g.position.set(x, y, z);
  g.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  const col = { type: 'sphere', x, y, z, r: 1.6 };
  const o = { kind: 'eagle', group: g, z, colliders: [col] };
  o.update = (t, dt) => {
    x += dir * 6 * dt;
    if (Math.abs(x) > LANE + 4) x = -Math.sign(x) * (LANE + 4);
    g.position.x = x;
    col.x = x;
    wl.forEach(({ w, s }) => { w.rotation.z = s * Math.sin(t * 8) * 0.5; });
  };
  return addObstacle(o);
}

// 번개: 새가 다가오면 노란 기둥으로 1.3초 예고한 뒤 0.35초 동안 내리친다
function lightning(z) {
  const g = new T.Group();
  const warn = mesh(G.cyl, basic(0xfff066, { transparent: true, opacity: 0.25, depthWrite: false }));
  warn.scale.set(2.2, CEIL + 10, 2.2);
  warn.position.y = (CEIL + 10) / 2;
  const bolt = mesh(G.cyl, basic(0xffffcc));
  bolt.scale.set(1.1, CEIL + 10, 1.1);
  bolt.position.y = (CEIL + 10) / 2;
  g.add(warn, bolt);
  warn.visible = bolt.visible = false;
  scene.add(g);
  const col = { type: 'cyl', x: 0, z, r: 1.6, y0: 0, y1: CEIL + 10, off: true };
  const o = { kind: 'lightning', group: g, z, colliders: [col], state: 'idle', t: 0 };
  o.update = (t, dt) => {
    if (o.state === 'idle') {
      const eta = (bird.z - z) / bird.speed;
      if (eta < 1.5 && eta > 0) {
        o.state = 'warn'; o.t = 0;
        const x = clamp(bird.x + rand(-1.2, 1.2), -LANE + 1, LANE - 1);
        g.position.set(x, 0, z);
        col.x = x;
        warn.visible = true;
        sfx.warn();
        showHint('⚡ 번개! 옆으로 피하세요!', 1.2);
      }
    } else if (o.state === 'warn') {
      o.t += dt;
      warn.material.opacity = 0.2 + 0.25 * Math.abs(Math.sin(o.t * 14));
      if (o.t > 1.3) { o.state = 'strike'; o.t = 0; warn.visible = false; bolt.visible = true; col.off = false; sfx.zap(); game.flash = 0.5; }
    } else if (o.state === 'strike') {
      o.t += dt;
      bolt.scale.x = bolt.scale.z = 1.1 + Math.random() * 0.6;
      if (o.t > 0.35) { o.state = 'done'; bolt.visible = false; col.off = true; }
    }
  };
  game.obstacles.push(o);
  return o;
}

function addItem(kind, x, y, z) {
  const m = mesh(kind === 'seed' ? G.seed : kind === 'ring' ? G.ring : G.heart, M[kind]);
  m.position.set(x, y, z);
  scene.add(m);
  game.items.push({ kind, mesh: m, x, y, z, taken: false });
}

function seedArc(z, x, y) {
  const dx = rand(-1, 1) * 0.6, dy = rand(-1, 1) * 0.5;
  for (let k = 0; k < 5; k++) addItem('seed', clamp(x + dx * k, -LANE + 1, LANE - 1), clamp(y + dy * k + Math.sin(k) * 0.4, 2, CEIL - 2), z - k * 3);
}

// 한 구간(약 25m)에 장애물 패턴 하나를 깐다
function spawnChunk(z) {
  const d = -z;
  const biome = Math.floor(d / BIOME_LEN) % BIOMES.length;
  const lap = Math.floor(d / (BIOME_LEN * BIOMES.length));
  if (d < 110) {
    // 연습 구간: 낮은 나무와 씨앗만
    if (d > 50) tree(rand(-10, 10), z, rand(4, 6));
    seedArc(z, rand(-6, 6), rand(5, 12));
    return;
  }
  const extra = Math.min(3, lap);
  switch (biome) {
    case 0: {
      const r = Math.random();
      if (r < 0.45) for (let k = 0; k < 4 + extra; k++) tree(rand(-LANE, LANE), z + rand(-4, 4), rand(5, 13));
      else if (r < 0.8) { balloon(rand(-9, 9), rand(7, 18), z); if (Math.random() < 0.6) balloon(rand(-9, 9), rand(7, 18), z - 9); }
      else { for (let k = 0; k < 3; k++) tree(rand(-LANE, LANE), z, rand(5, 9)); balloon(rand(-8, 8), rand(12, 20), z - 6); }
      break;
    }
    case 1: {
      if (Math.random() < 0.5) {
        const w = clamp(8.5 - lap * 0.7, 6, 8.5), h = clamp(7.5 - lap * 0.7, 5.5, 7.5);
        // 구멍은 가운데 높이대에 두고, 바로 앞 구멍과 높이 차이가 8m를 넘지 않게 한다
        const lastY = game.lastHoleY ?? 12;
        const hy = clamp(lastY + rand(-8, 8), 6, 18);
        game.lastHoleY = hy;
        archWall(z, rand(-LANE + w, LANE - w), hy, w, h);
      } else {
        // 기둥 사이는 최소 4.5m를 남긴다
        const n = 3 + Math.floor(Math.random() * 2) + (extra ? 1 : 0);
        const slot = (LANE * 2) / n;
        for (let k = 0; k < n; k++) {
          const r = rand(1.2, 1.8);
          const jitter = Math.max(0, (slot - 2 * r - 4.5) / 2);
          pillar(-LANE + (k + 0.5) * slot + rand(-jitter, jitter), z + rand(-3, 3), r);
        }
      }
      break;
    }
    case 2: {
      lightning(z);
      if (Math.random() < 0.55) eagle(z - 10);
      if (Math.random() < 0.4) tree(rand(-LANE, LANE), z - 5, rand(6, 11));
      break;
    }
    case 3: {
      windmill(rand(-8, 8), z);
      if (Math.random() < 0.5 + extra * 0.1) windmill(rand(-LANE, LANE), z - 12);
      addItem('ring', rand(-9, 9), rand(6, 20), z - 6);
      break;
    }
  }
  if (Math.random() < 0.7) seedArc(z - 12, rand(-9, 9), rand(4, 20));
  if (Math.random() < 0.06 && bird.hearts < HEARTS) addItem('heart', rand(-8, 8), rand(6, 18), z - 14);
}

function clearWorld() {
  for (const o of game.obstacles) scene.remove(o.group);
  for (const it of game.items) scene.remove(it.mesh);
  game.obstacles = [];
  game.items = [];
  decor.clear();
  for (const c of clouds) scene.remove(c);
  clouds.length = 0;
}

function resetRun() {
  clearWorld();
  Object.assign(bird, { x: 0, y: 8, z: 0, vx: 0, vy: 0, speed: START_SPEED, hearts: HEARTS, invuln: 0, flapAnim: 0, glide: false });
  Object.assign(game, { time: 0, dist: 0, seeds: 0, rings: 0, biome: -1, nextZ: -40, shake: 0, flash: 0, hint: '', hintT: 0, banner: 0, lastHoleY: 12 });
  game.lastFlaps = tracker ? tracker.gestures.flaps : 0;
  for (let i = 0; i < 18; i++) spawnCloud(-rand(0, VIEW));
  setBiome(0);
}

function spawnCloud(z) {
  const storm = game.biome === 2;
  const c = makeCloud(storm);
  c.position.set(rand(-40, 40), rand(CEIL - 2, CEIL + 10), bird.z + z);
  scene.add(c);
  clouds.push(c);
}

function setBiome(b) {
  if (b === game.biome) return;
  game.biome = b;
  const bm = BIOMES[b];
  scene.background.setHex(bm.sky);
  scene.fog.color.setHex(bm.fog);
  ground.material.color.setHex(bm.ground);
  hemi.intensity = b === 2 ? 0.55 : 0.8;
  game.banner = 3;
  showHint(bm.hint, 4);
  if (game.dist > 10) sfx.biome();
}

// ───────────── 입력 ─────────────
function readInput() {
  const inp = game.input;
  inp.flap = 0;
  let lean = 0, glide = false;
  if (game.mode === 'camera' && tracker) {
    tracker.update(performance.now());
    const gs = tracker.gestures;
    if (gs.flaps > game.lastFlaps) { inp.flap = gs.flaps - game.lastFlaps; inp.flapStrength = gs.lastStrength; game.lastFlaps = gs.flaps; }
    if (gs.present) { lean = gs.lean; glide = gs.glide; }
  }
  // 키보드는 어느 모드에서나 함께 쓸 수 있다
  if (game.keyFlap) { inp.flap += game.keyFlap; inp.flapStrength = 1; game.keyFlap = 0; }
  const kl = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  if (kl) lean = kl;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) glide = true;
  if (game.mode === 'bot') { lean = game.botInput.lean; glide = game.botInput.glide; if (game.botInput.flap) { inp.flap += 1; inp.flapStrength = 1; game.botInput.flap = 0; } }
  inp.lean = lean;
  inp.glide = glide;
}

// ───────────── 업데이트 ─────────────
function spawnAhead() {
  while (game.nextZ > bird.z - VIEW) {
    spawnChunk(game.nextZ);
    game.nextZ -= clamp(bird.speed * 1.55, 22, 34);
  }
}

const bodyVisible = () => game.mode !== 'camera' || (tracker && tracker.gestures.present);

// 출발 전 카운트다운, 몸이 화면에서 벗어났을 때의 일시정지: 새는 제자리에 떠 있다
function updateWaiting(dt) {
  game.readyT = bodyVisible() ? game.readyT + dt : 0;
  const need = game.phase === 'ready' ? 3 : 1;
  if (game.readyT >= need) {
    game.phase = 'fly';
    game.lostT = 0;
    if (need === 3) { showHint('출발!', 1); sfx.biome(); }
  }
  bird.vy = 0;
  bird.vx = 0;
  if (Math.floor(game.readyT * 2) !== Math.floor((game.readyT - dt) * 2) && game.phase === 'ready' && game.readyT > 0) sfx.warn();
  spawnAhead();
}

function update(dt) {
  readInput();
  if (game.phase !== 'fly') { updateWaiting(dt); return; }
  if (game.mode === 'camera') {
    game.lostT = bodyVisible() ? 0 : game.lostT + dt;
    if (game.lostT > 1) { game.phase = 'lost'; game.readyT = 0; return; }
  }
  game.time += dt;
  const inp = game.input;

  // 날갯짓은 위로 솟구치는 힘, 아니면 중력으로 떨어진다. 팔을 펴고 있으면 활공.
  if (inp.flap) {
    bird.vy = Math.min(8, Math.max(bird.vy, 0) * 0.4 + FLAP_V * inp.flapStrength);
    bird.flapAnim = 1;
    sfx.flap();
  }
  bird.glide = inp.glide && bird.vy <= 0;
  if (bird.glide) {
    bird.vy = Math.max(bird.vy - GLIDE_GRAVITY * dt, -GLIDE_MAX_FALL);
  } else {
    bird.vy -= GRAVITY * dt;
  }
  bird.vx += (inp.lean * STEER - bird.vx) * damp(4, dt);
  bird.speed = Math.min(MAX_SPEED, bird.speed + ACCEL * dt);
  bird.x = clamp(bird.x + bird.vx * dt, -LANE, LANE);
  bird.y += bird.vy * dt;
  bird.z -= bird.speed * dt;
  game.dist = -bird.z;
  if (bird.y > CEIL) { bird.y = CEIL; bird.vy = Math.min(bird.vy, 0); }
  bird.flapAnim = Math.max(0, bird.flapAnim - dt * 3);
  bird.invuln = Math.max(0, bird.invuln - dt);

  // 땅에 닿으면 다치고 튀어 오른다
  if (bird.y < 0.6) {
    bird.y = 0.6;
    if (bird.invuln <= 0) hurt('땅에 부딪혔어요! 날갯짓!');
    bird.vy = 7;
  }

  // 지역과 장애물 생성
  setBiome(Math.floor(game.dist / BIOME_LEN) % BIOMES.length);
  spawnAhead();
  for (const o of game.obstacles) o.update && o.update(game.time, dt);

  // 충돌
  const p = { x: bird.x, y: bird.y, z: bird.z };
  if (bird.invuln <= 0) {
    for (const o of game.obstacles) {
      if (Math.abs(o.z - bird.z) > 14) continue;
      if (o.colliders.some((c) => !c.off && colliderDist(c, p) < BIRD_R)) { hurt(o.kind === 'lightning' ? '찌릿! 번개에 맞았어요' : '쿵!'); break; }
    }
  }
  // 아이템
  for (const it of game.items) {
    if (it.taken) continue;
    if (it.kind === 'ring') {
      if (Math.abs(it.z - bird.z) < 0.8 && Math.hypot(it.x - bird.x, it.y - bird.y) < 2.0) {
        it.taken = true; game.rings++; sfx.ring(); showHint('고리 통과! +50', 1);
        it.mesh.material = basic(0xffffff, { transparent: true, opacity: 0.6 });
      }
    } else if (Math.hypot(it.x - bird.x, it.y - bird.y, it.z - bird.z) < 1.3) {
      it.taken = true;
      it.mesh.visible = false;
      if (it.kind === 'seed') { game.seeds++; sfx.seed(); }
      else { bird.hearts = Math.min(HEARTS, bird.hearts + 1); sfx.heart(); showHint('하트 회복!', 1); }
    }
    if (it.kind !== 'ring') it.mesh.rotation.y += dt * 3;
  }
  // 지나간 것 치우기
  game.obstacles = game.obstacles.filter((o) => { const keep = o.z < bird.z + 20; if (!keep) scene.remove(o.group); return keep; });
  game.items = game.items.filter((it) => { const keep = it.z < bird.z + 10; if (!keep) scene.remove(it.mesh); return keep; });
  for (const c of clouds) if (c.position.z > bird.z + 20) { c.position.z = bird.z - VIEW - rand(0, 30); c.position.x = rand(-40, 40); }

  // 튜토리얼 안내
  if (game.dist < 110) {
    if (game.dist < 50) showHint(game.mode === 'camera' ? '팔을 위로 들었다가 아래로 퍼덕! 하면 날아올라요' : 'Space로 날갯짓!', 0.2);
    else showHint(game.mode === 'camera' ? '몸을 왼쪽/오른쪽으로 기울여 방향을 바꿔요' : 'A/D로 방향 전환, Shift 누르면 활공', 0.2);
  } else if (bird.vy < -7 && !bird.glide && game.hintT <= 0) {
    showHint(game.mode === 'camera' ? '팔을 양옆으로 쭉 펴면 천천히 활공해요' : 'Shift를 누르면 활공해요', 1.5);
  }
  game.hintT = Math.max(0, game.hintT - dt);
  game.banner = Math.max(0, game.banner - dt);
  game.shake = Math.max(0, game.shake - dt * 2);
  game.flash = Math.max(0, game.flash - dt * 2);
}

function hurt(msg) {
  bird.hearts--;
  bird.invuln = 1.6;
  bird.speed = Math.max(START_SPEED, bird.speed * 0.85);
  game.shake = 0.6;
  game.flash = 0.8;
  sfx.hit();
  showHint(msg, 1.2);
  if (bird.hearts <= 0) gameOver();
}

function gameOver() {
  game.screen = 'over';
  sfx.over();
  const score = Math.round(game.dist + game.seeds * 10 + game.rings * 50);
  let best = 0;
  try { best = Number(localStorage.getItem('flutter_flight_best')) || 0; } catch { /* 저장소 없음 */ }
  const isBest = score > best;
  if (isBest) { try { localStorage.setItem('flutter_flight_best', String(score)); } catch { /* 무시 */ } }
  $('over-score').textContent = `${score.toLocaleString()}점${isBest ? ' · 최고 기록!' : ` (최고 ${best.toLocaleString()})`}`;
  $('over-detail').textContent = `비행 거리 ${Math.round(game.dist)}m · 씨앗 ${game.seeds}개 · 고리 ${game.rings}개 · ${BIOMES[game.biome].name}에서 추락`;
  setTimeout(() => showScreen('over'), 900);
}

function showHint(text, t) {
  if (game.hint !== text || game.hintT < t) { game.hint = text; game.hintT = t; }
}

// ───────────── 렌더 ─────────────
function updateCamera(dt) {
  camera.position.set(bird.x, bird.y, bird.z);
  if (game.shake > 0) camera.position.add(new T.Vector3(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(game.shake * 0.4));
  const roll = -bird.vx * 0.035;
  const pitch = clamp(bird.vy * 0.03, -0.35, 0.3);
  const yaw = -bird.vx * 0.012;
  camera.rotation.set(pitch, yaw, roll, 'YXZ');
  // 날개: 날갯짓하면 크게 위아래로, 활공하면 쫙 편다
  const flap = Math.sin((1 - bird.flapAnim) * Math.PI * 2) * bird.flapAnim;
  for (const w of wings) {
    const rest = bird.glide ? -0.05 : 0.25 + Math.sin(game.time * 3) * 0.05;
    w.pivot.rotation.z = w.side * (rest + flap * 0.9);
    w.pivot.rotation.y = -w.side * (bird.glide ? 0.05 : 0.2);
  }
  ground.position.set(bird.x, 0, bird.z - 100);
  sun.position.set(bird.x - 20, 40, bird.z + 10);
}

const hud = document.getElementById('hud');
const hctx = hud.getContext('2d');
const $ = (id) => document.getElementById(id);

function drawHud() {
  const w = hud.width, h = hud.height, s = h / 720;
  hctx.setTransform(1, 0, 0, 1, 0, 0);
  hctx.clearRect(0, 0, w, h);
  if (game.flash > 0) { hctx.fillStyle = `rgba(255,255,255,${game.flash * 0.4})`; hctx.fillRect(0, 0, w, h); }
  if (bird.invuln > 0 && game.screen === 'play') { hctx.fillStyle = `rgba(255,60,80,${0.15 * Math.abs(Math.sin(game.time * 12))})`; hctx.fillRect(0, 0, w, h); }
  if (game.screen !== 'play') return;
  hctx.setTransform(s, 0, 0, s, 0, 0);
  const W = w / s;
  // 왼쪽 위: 하트, 거리, 씨앗
  hctx.fillStyle = 'rgba(30,40,70,0.45)';
  rr(16, 16, 250, 104, 16); hctx.fill();
  hctx.font = '30px sans-serif';
  hctx.textAlign = 'left'; hctx.textBaseline = 'middle';
  for (let i = 0; i < HEARTS; i++) { hctx.globalAlpha = i < bird.hearts ? 1 : 0.25; hctx.fillText('❤️', 30 + i * 38, 46); }
  hctx.globalAlpha = 1;
  hctx.fillStyle = '#fff';
  hctx.font = '34px "Jua", sans-serif';
  hctx.fillText(`${Math.round(game.dist)}m`, 30, 86);
  hctx.font = '700 15px "Noto Sans KR", sans-serif';
  hctx.fillText(`🌻 ${game.seeds}  ⭕ ${game.rings}`, 160, 88);
  // 위 가운데: 안내
  if (game.hintT > 0 && game.hint) {
    hctx.font = '24px "Jua", sans-serif';
    hctx.textAlign = 'center';
    const tw = hctx.measureText(game.hint).width + 40;
    hctx.globalAlpha = Math.min(1, game.hintT * 3);
    hctx.fillStyle = game.hint.startsWith('⚡') || game.hint.includes('부딪') || game.hint.includes('번개에') ? 'rgba(220,60,60,0.85)' : 'rgba(30,40,70,0.6)';
    rr(W / 2 - tw / 2, 18, tw, 44, 22); hctx.fill();
    hctx.fillStyle = '#fff';
    hctx.fillText(game.hint, W / 2, 41);
    hctx.globalAlpha = 1;
  }
  // 지역 배너
  if (game.banner > 0) {
    hctx.globalAlpha = Math.min(1, game.banner);
    hctx.textAlign = 'center';
    hctx.font = '60px "Jua", sans-serif';
    hctx.lineWidth = 8; hctx.strokeStyle = 'rgba(30,40,70,0.6)';
    const name = BIOMES[game.biome].name;
    hctx.strokeText(name, W / 2, 200); hctx.fillStyle = '#fff'; hctx.fillText(name, W / 2, 200);
    hctx.globalAlpha = 1;
  }
  // 오른쪽 위: 고도계
  hctx.fillStyle = 'rgba(30,40,70,0.45)';
  rr(W - 46, 90, 22, 300, 11); hctx.fill();
  const hy = 90 + 300 * (1 - bird.y / CEIL);
  hctx.fillStyle = bird.y < 3 ? '#ff6b6b' : '#ffd34d';
  hctx.beginPath(); hctx.arc(W - 35, hy, 9, 0, Math.PI * 2); hctx.fill();
  hctx.fillStyle = '#fff'; hctx.font = '700 12px "Noto Sans KR", sans-serif'; hctx.textAlign = 'center';
  hctx.fillText('고도', W - 35, 78);
  // 활공 표시
  if (bird.glide) {
    hctx.font = '22px "Jua", sans-serif'; hctx.fillStyle = '#bff3ff'; hctx.textAlign = 'center';
    hctx.fillText('🪽 활공 중', W / 2, 640);
  }
  if (game.phase !== 'fly') {
    let big = '', small = '';
    if (game.phase === 'lost') { big = '잠깐 멈춤'; small = '몸이 화면에서 벗어났어요. 상체와 두 팔이 보이게 서 주세요'; }
    else if (!bodyVisible()) { big = '준비'; small = '상체와 두 팔이 카메라에 보이게 서 주세요'; }
    else { big = String(Math.max(1, Math.ceil(3 - game.readyT))); small = game.mode === 'camera' ? '팔을 들었다 내려치면 날아올라요!' : 'Space로 날갯짓, A/D로 방향 전환'; }
    hctx.textAlign = 'center';
    hctx.fillStyle = 'rgba(30,40,70,0.45)';
    rr(W / 2 - 260, 250, 520, 150, 24); hctx.fill();
    hctx.fillStyle = '#fff';
    hctx.font = '64px "Jua", sans-serif';
    hctx.fillText(big, W / 2, 310);
    hctx.font = '700 18px "Noto Sans KR", sans-serif';
    hctx.fillText(small, W / 2, 368);
  }
  drawPreview(W);
}

function drawPreview(W) {
  if (game.mode !== 'camera' || !tracker || !tracker.video || tracker.video.readyState < 2) return;
  const v = tracker.video;
  const pw = 220, ph = Math.round(pw / tracker.aspect), px = W - pw - 70, py = 720 - ph - 16;
  hctx.save();
  rr(px, py, pw, ph, 12); hctx.clip();
  hctx.translate(px + pw, py); hctx.scale(-1, 1);
  hctx.globalAlpha = 0.85;
  hctx.drawImage(v, 0, 0, pw, ph);
  hctx.restore();
  hctx.globalAlpha = 1;
  const gs = tracker.gestures, lm = tracker.landmarks;
  if (lm && gs.present) {
    const map = (p) => ({ x: px + (p.x / tracker.aspect) * pw, y: py + p.y * ph });
    hctx.strokeStyle = '#ffd34d'; hctx.lineWidth = 3; hctx.lineCap = 'round';
    for (const [a, b] of POSE_LINKS) { const pa = map(lm[a]), pb = map(lm[b]); hctx.beginPath(); hctx.moveTo(pa.x, pa.y); hctx.lineTo(pb.x, pb.y); hctx.stroke(); }
  }
  hctx.strokeStyle = 'rgba(255,255,255,0.8)'; hctx.lineWidth = 2;
  rr(px, py, pw, ph, 12); hctx.stroke();
  // 팔 높이 막대: 위 선을 넘겼다가 아래 선까지 내려치면 날갯짓
  const bx = px - 26, by = py, bh = ph;
  hctx.fillStyle = 'rgba(30,40,70,0.5)'; rr(bx, by, 16, bh, 8); hctx.fill();
  const toY = (a) => by + clamp((a + 1) / 2.2, 0, 1) * bh;
  hctx.fillStyle = '#7ee8ff'; hctx.fillRect(bx - 3, toY(0.1) - 1, 22, 2);
  hctx.fillStyle = '#ff9a6b'; hctx.fillRect(bx - 3, toY(0.75) - 1, 22, 2);
  hctx.fillStyle = gs.phase === 'up' ? '#7ee8ff' : '#ffd34d';
  hctx.beginPath(); hctx.arc(bx + 8, toY(gs.armY), 7, 0, Math.PI * 2); hctx.fill();
  hctx.fillStyle = '#fff'; hctx.font = '700 12px "Noto Sans KR", sans-serif'; hctx.textAlign = 'center';
  if (!gs.present) hctx.fillText('상체가 화면에 보이게 서 주세요', px + pw / 2, py - 8);
  else hctx.fillText(`기울기 ${gs.lean > 0.1 ? '▶' : gs.lean < -0.1 ? '◀' : '●'}${gs.glide ? ' · 활공' : ''}`, px + pw / 2, py - 8);
}

function rr(x, y, w, h, r) {
  hctx.beginPath();
  hctx.moveTo(x + r, y);
  hctx.arcTo(x + w, y, x + w, y + h, r);
  hctx.arcTo(x + w, y + h, x, y + h, r);
  hctx.arcTo(x, y + h, x, y, r);
  hctx.arcTo(x, y, x + w, y, r);
  hctx.closePath();
}

// ───────────── 화면 / 루프 ─────────────
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  hud.width = Math.floor(w * dpr); hud.height = Math.floor(h * dpr);
}

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('show', el.id === id);
}

function startGame(mode) {
  game.mode = mode;
  resetRun();
  game.phase = mode === 'bot' ? 'fly' : 'ready';
  game.readyT = 0;
  game.lostT = 0;
  game.screen = 'play';
  showScreen(null);
}

$('btn-cam').addEventListener('click', async () => {
  sfx.ensure();
  const btns = document.querySelectorAll('#title button');
  btns.forEach((b) => { b.disabled = true; });
  try {
    if (!tracker) {
      const t = new PoseTracker($('cam'));
      await t.init((msg) => { $('status').textContent = msg; });
      tracker = t;
    }
    startGame('camera');
  } catch (err) {
    console.error(err);
    $('status').textContent = `카메라/몸 인식을 시작하지 못했어요: ${err.message || err}. 카메라 권한을 확인하거나 키보드로 플레이하세요.`;
  }
  btns.forEach((b) => { b.disabled = false; });
});
$('btn-key').addEventListener('click', () => { sfx.ensure(); startGame('keyboard'); });
$('btn-again').addEventListener('click', () => startGame(game.mode));
$('btn-title').addEventListener('click', () => { game.screen = 'title'; resetRun(); showScreen('title'); });

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!e.repeat && (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') && game.screen === 'play') game.keyFlap = (game.keyFlap || 0) + 1;
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('resize', resize);

resetRun();
resize();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.screen === 'play') { if (!game.frozen) update(dt); }
  else if (game.screen === 'title') {
    // 타이틀 뒤에서는 새가 저절로 천천히 날아간다
    game.time += dt;
    bird.z -= 8 * dt;
    bird.y = 10 + Math.sin(game.time * 0.8) * 2;
    bird.flapAnim = (game.time % 1.2) < 0.05 ? 1 : Math.max(0, bird.flapAnim - dt * 3);
    while (game.nextZ > bird.z - VIEW) { spawnChunk(game.nextZ); game.nextZ -= 26; }
    for (const o of game.obstacles) o.update && o.update(game.time, dt);
    for (const c of clouds) if (c.position.z > bird.z + 20) c.position.z = bird.z - VIEW;
    game.obstacles = game.obstacles.filter((o) => { const keep = o.z < bird.z + 20; if (!keep) scene.remove(o.group); return keep; });
    game.items = game.items.filter((it) => { const keep = it.z < bird.z + 10; if (!keep) scene.remove(it.mesh); return keep; });
  }
  updateCamera(dt);
  renderer.render(scene, camera);
  drawHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 개발 확인용: ?debug 로 열면 상태를 보고 입력을 직접 넣을 수 있다
if (/[?&]debug\b/.test(location.search)) {
  game.botInput = { lean: 0, glide: false, flap: 0 };
  window.__fly = { game, bird, update, startGame, colliderDist, LANE, CEIL, BIRD_R };
}
})();
