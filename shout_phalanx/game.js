// 외쳐라, 방진대! — three.js(전역 THREE)와 voice.js(전역 VoiceCommander)를 먼저 불러온 뒤 실행된다.
// 게임 좌표는 (x: 오른쪽, d: 앞쪽 거리)이고, 3D 월드로는 (x, 0, -d)에 놓는다.
(() => {
const T = THREE;

// ───────────── 상수 ─────────────
const VALLEY = 11;           // 협곡 안쪽 x 범위 (±)
const COLS = 6;
const SPACING = { normal: 1.5, shield: 1.05, spread: 3.0 };
const ROW_SP = { normal: 1.5, shield: 1.15, spread: 2.4 };
const MARCH = { normal: 3.2, shield: 1.4, spread: 3.0 };
const CHARGE_SPEED = 9;
const REACH = 2.5;           // 창이 닿는 거리 (뒷줄도 앞줄 너머로 찌를 수 있다)
const SOLDIER_HP = 100;
const SOLDIER_COUNT = 12;
const COOLDOWN = { javelin: 8, charge: 12, warcry: 20 };
const ARCHER_INTERVAL = 5.5;

const COMMAND_INFO = {
  advance: { label: '전진', key: 'W' },
  retreat: { label: '후퇴', key: 'S' },
  halt: { label: '정지', key: 'X' },
  left: { label: '왼쪽', key: 'A' },
  right: { label: '오른쪽', key: 'D' },
  attack: { label: '공격', key: 'E' },
  shield: { label: '방패', key: 'Q' },
  spread: { label: '산개', key: 'Z' },
  gather: { label: '모여', key: 'C' },
  javelin: { label: '투창', key: 'F' },
  charge: { label: '돌격', key: 'R' },
  warcry: { label: '스파르타', key: 'G' },
};
const KEY_TO_CMD = Object.fromEntries(Object.entries(COMMAND_INFO).map(([id, c]) => [`Key${c.key}`, id]));
KEY_TO_CMD.Space = 'halt';

const ENEMY = {
  grunt: { name: '보병', hp: 55, r: 0.45, speed: 2.3, dmg: 10, atkCd: 1.2 },
  archer: { name: '궁수', hp: 35, r: 0.45, speed: 2.0, dmg: 5, atkCd: 1.4 },
  rider: { name: '기병', hp: 80, r: 0.8, speed: 8, dmg: 10, atkCd: 1.2 },
  catapult: { name: '투석기', hp: 120, r: 1.2, speed: 0, dmg: 0, atkCd: 99 },
  boss: { name: '거인 대장 볼그', hp: 2200, r: 1.3, speed: 1.2, dmg: 16, atkCd: 1.6 },
};
const SPAWN_AHEAD = { grunt: 22, archer: 30, rider: 26, catapult: 36, boss: 26 };

const STAGES = [
  {
    name: '첫 행군', desc: '보병 무리를 상대로 기본 명령을 익혀요.',
    tip: "'전진!'으로 나아가고, 적이 다가오면 '공격!'",
    waves: [
      { at: 3, units: [['grunt', 5]] },
      { at: 20, units: [['grunt', 8]] },
      { at: 38, units: [['grunt', 12]] },
    ],
  },
  {
    name: '화살비', desc: '궁수가 화살을 퍼부어요. 바닥의 붉은 원을 보세요.',
    tip: "붉은 원이 보이면 '방패!' — 막고 나면 '모여!'로 대형 복귀",
    waves: [
      { at: 3, units: [['grunt', 4], ['archer', 3]] },
      { at: 22, units: [['archer', 4], ['grunt', 6]] },
      { at: 42, units: [['archer', 6], ['grunt', 8]] },
    ],
  },
  {
    name: '기병 돌격', desc: '말 탄 적이 줄을 겨누고 달려와요.',
    tip: "붉은 길이 깔리면 '방패!' — 멀리 있는 기병은 '투창!'",
    waves: [
      { at: 3, units: [['rider', 2], ['grunt', 4]] },
      { at: 22, units: [['rider', 3], ['grunt', 6]] },
      { at: 42, units: [['rider', 4], ['archer', 3], ['grunt', 6]] },
    ],
  },
  {
    name: '투석기 요새', desc: '바위는 방패로 못 막아요. 흩어지거나 피하세요.',
    tip: "큰 원이 보이면 '산개!' 또는 '왼쪽/오른쪽' — 투석기는 '돌격!'으로 부숴요",
    waves: [
      { at: 3, units: [['catapult', 1], ['grunt', 6]] },
      { at: 24, units: [['catapult', 2], ['archer', 3], ['grunt', 6]] },
      { at: 46, units: [['catapult', 2], ['rider', 2], ['archer', 3], ['grunt', 8]] },
    ],
  },
  {
    name: '거인의 협곡', desc: '협곡 끝에서 거인 대장 볼그가 기다려요.',
    tip: "'스파르타!'라고 외치면 함성으로 힘이 솟아요",
    waves: [
      { at: 3, units: [['grunt', 8], ['archer', 3]] },
      { at: 22, units: [['boss', 1], ['grunt', 4], ['archer', 2]] },
    ],
  },
];

// ───────────── 유틸 ─────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.d - b.d);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
let seed = 7;
const srand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

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
  tone(f, d, type = 'sine', vol = 0.2, delay = 0, slideTo = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + d);
    this.env(o, vol, 0.005, d, t);
    o.start(t); o.stop(t + d + 0.05);
  },
  noiseHit(freq, d, vol, type = 'bandpass', delay = 0, q = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f);
    this.env(f, vol, 0.003, d, t);
    s.start(t, Math.random() * 0.5); s.stop(t + d + 0.05);
  },
  command() { this.tone(110, 0.25, 'sine', 0.35, 0, 70); this.noiseHit(300, 0.12, 0.2, 'lowpass'); },
  denied() { this.tone(220, 0.12, 'square', 0.06); this.tone(180, 0.15, 'square', 0.06, 0.1); },
  stab() { this.noiseHit(2200, 0.06, 0.08, 'bandpass', 0, 3); },
  clang() { [1700, 2480, 3300].forEach((f, i) => this.tone(f * rand(0.95, 1.05), 0.25 / (i + 1), 'triangle', 0.07)); },
  hurt() { this.tone(260, 0.12, 'sawtooth', 0.05, 0, 140); },
  arrows() { this.noiseHit(3000, 0.7, 0.12, 'bandpass', 0, 0.8); },
  horn() { this.tone(196, 0.5, 'sawtooth', 0.08); this.tone(147, 0.7, 'sawtooth', 0.08, 0.45); },
  boom() { this.tone(90, 0.6, 'sine', 0.5, 0, 35); this.noiseHit(400, 0.5, 0.35, 'lowpass'); },
  throwJav() { this.noiseHit(1200, 0.25, 0.1, 'bandpass', 0, 2); },
  warcry() { [220, 277, 330].forEach((f, i) => this.tone(f, 0.9, 'sawtooth', 0.06, i * 0.05)); this.noiseHit(500, 0.6, 0.2, 'lowpass'); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.15, i * 0.15)); },
  lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.12, i * 0.25)); },
};

// ───────────── 3D 기본 ─────────────
const canvas = document.getElementById('scene');
const renderer = new T.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;

const scene = new T.Scene();
const SKY = 0xbfe6ff;
scene.background = new T.Color(SKY);
scene.fog = new T.Fog(SKY, 45, 105);
const camera = new T.PerspectiveCamera(55, 1, 0.1, 250);

scene.add(new T.HemisphereLight(0xffffff, 0x9cc27a, 0.6));
const sun = new T.DirectionalLight(0xfff3dd, 0.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
scene.add(sun, sun.target);

const toonRamp = new T.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, T.RedFormat);
toonRamp.minFilter = toonRamp.magFilter = T.NearestFilter;
toonRamp.needsUpdate = true;
const toon = (color, extra = {}) => new T.MeshToonMaterial({ color, gradientMap: toonRamp, ...extra });
const basic = (color, extra = {}) => new T.MeshBasicMaterial({ color, ...extra });

function mesh(geo, mat, shadow = true) {
  const m = new T.Mesh(geo, mat);
  m.castShadow = shadow;
  return m;
}
const worldPos = (x, d, y = 0) => new T.Vector3(x, y, -d);

// 지오메트리는 한 번만 만들어 공유한다
const G = {
  leg: new T.CapsuleGeometry(0.08, 0.14, 4, 8),
  torso: new T.CapsuleGeometry(0.22, 0.2, 4, 12),
  head: new T.SphereGeometry(0.36, 20, 14),
  eye: new T.SphereGeometry(0.05, 8, 6),
  cheek: new T.SphereGeometry(0.06, 8, 6),
  helmet: new T.SphereGeometry(0.39, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  crest: new T.TorusGeometry(0.3, 0.07, 6, 16, Math.PI),
  horn: new T.ConeGeometry(0.07, 0.28, 8),
  hood: new T.ConeGeometry(0.42, 0.62, 14),
  crown: new T.CylinderGeometry(0.3, 0.34, 0.2, 8, 1, true),
  cape: new T.PlaneGeometry(0.5, 0.62),
  shaft: new T.CylinderGeometry(0.03, 0.03, 2.2, 6),
  tip: new T.ConeGeometry(0.06, 0.22, 6),
  shield: new T.CylinderGeometry(0.42, 0.42, 0.07, 22),
  emblem: new T.CylinderGeometry(0.2, 0.2, 0.08, 16),
  club: new T.CylinderGeometry(0.06, 0.11, 0.8, 8),
  clubHead: new T.SphereGeometry(0.16, 10, 8),
  bow: new T.TorusGeometry(0.35, 0.03, 6, 14, Math.PI),
  horseBody: new T.CapsuleGeometry(0.42, 0.7, 4, 12),
  horseHead: new T.BoxGeometry(0.34, 0.36, 0.55),
  horseLeg: new T.CylinderGeometry(0.08, 0.07, 0.55, 6),
  box: new T.BoxGeometry(1, 1, 1),
  wheel: new T.CylinderGeometry(0.35, 0.35, 0.18, 12),
  ball: new T.SphereGeometry(1, 14, 10),
  ring: new T.RingGeometry(0.93, 1, 48),
  disc: new T.CircleGeometry(1, 48),
  plane: new T.PlaneGeometry(1, 1),
  arrow: new T.CylinderGeometry(0.02, 0.02, 0.9, 4),
};

// 귀여운 2등신 캐릭터. 모델은 +z(월드 기준)를 바라보게 만든다.
function makeChibi(o) {
  const group = new T.Group();
  const rig = new T.Group();
  group.add(rig);
  const m = {
    tunic: toon(o.tunic), skin: toon(0xffd7b5), metal: toon(o.metal ?? 0xe0a83e),
    dark: toon(0x2a2630), accent: toon(o.accent ?? 0xd8343c), wood: toon(0x9a6a3c),
  };
  const legs = [];
  for (const sx of [-0.12, 0.12]) {
    const leg = mesh(G.leg, m.skin);
    leg.position.set(sx, 0.17, 0);
    rig.add(leg);
    legs.push(leg);
  }
  const torso = mesh(G.torso, m.tunic);
  torso.position.y = 0.52;
  rig.add(torso);

  const head = new T.Group();
  head.position.y = 1.02;
  rig.add(head);
  head.add(mesh(G.head, m.skin));
  for (const sx of [-0.12, 0.12]) {
    const eye = mesh(G.eye, m.dark, false);
    eye.position.set(sx, 0.02, 0.33);
    eye.scale.set(1, 1.35, 0.6);
    head.add(eye);
    const cheek = mesh(G.cheek, toon(0xff9aa8), false);
    cheek.position.set(sx * 1.7, -0.09, 0.29);
    cheek.scale.set(1, 0.6, 0.4);
    head.add(cheek);
  }
  if (o.helmet === 'greek') {
    const helm = mesh(G.helmet, m.metal);
    helm.position.y = 0.04;
    head.add(helm);
    const crest = mesh(G.crest, m.accent);
    crest.rotation.y = Math.PI / 2;
    crest.position.y = 0.36;
    crest.scale.set(1, 0.9, 1.6);
    head.add(crest);
  } else if (o.helmet === 'horn') {
    const helm = mesh(G.helmet, m.metal);
    helm.position.y = 0.04;
    head.add(helm);
    for (const sx of [-1, 1]) {
      const horn = mesh(G.horn, toon(0xfff3d6));
      horn.position.set(sx * 0.3, 0.32, 0);
      horn.rotation.z = -sx * 0.6;
      head.add(horn);
    }
  } else if (o.helmet === 'hood') {
    const hood = mesh(G.hood, m.tunic);
    hood.position.y = 0.3;
    head.add(hood);
  } else if (o.helmet === 'crown') {
    const crown = mesh(G.crown, toon(0xffd34d, { side: T.DoubleSide }));
    crown.position.y = 0.38;
    head.add(crown);
  }
  if (o.cape) {
    const cape = mesh(G.cape, toon(o.accent ?? 0xd8343c, { side: T.DoubleSide }));
    cape.position.set(0, 0.55, -0.24);
    cape.rotation.x = 0.18;
    rig.add(cape);
  }

  // 오른손(-x) 무기, 왼손(+x) 방패
  const weapon = new T.Group();
  weapon.position.set(-0.3, 0.6, 0.05);
  rig.add(weapon);
  if (o.weapon === 'spear') {
    const shaft = mesh(G.shaft, m.wood);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.45;
    weapon.add(shaft);
    const tip = mesh(G.tip, toon(0xdfe6ee));
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 1.62;
    weapon.add(tip);
    weapon.rotation.x = 0.08;
  } else if (o.weapon === 'club') {
    const club = mesh(G.club, m.wood);
    club.position.y = 0.3;
    weapon.add(club);
    const ch = mesh(G.clubHead, m.wood);
    ch.position.y = 0.7;
    weapon.add(ch);
    weapon.rotation.x = 0.5;
  } else if (o.weapon === 'bow') {
    const bow = mesh(G.bow, m.wood);
    bow.rotation.y = Math.PI / 2;
    bow.position.z = 0.2;
    weapon.add(bow);
  }
  let shieldArm = null;
  if (o.shield) {
    shieldArm = new T.Group();
    shieldArm.position.set(0.32, 0.58, 0.16);
    rig.add(shieldArm);
    const sh = mesh(G.shield, m.metal);
    sh.rotation.x = Math.PI / 2;
    shieldArm.add(sh);
    const em = mesh(G.emblem, m.accent);
    em.rotation.x = Math.PI / 2;
    em.position.z = 0.01;
    shieldArm.add(em);
  }
  group.traverse((c) => { if (c.isMesh) c.receiveShadow = false; });
  return { group, rig, head, legs, weapon, shieldArm, flash: [m.tunic, m.skin] };
}

function makeHorse() {
  const g = new T.Group();
  const coat = toon(0x8b5a3c), mane = toon(0x3b2a20);
  const body = mesh(G.horseBody, coat);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.75;
  g.add(body);
  const head = mesh(G.horseHead, coat);
  head.position.set(0, 1.15, 0.75);
  head.rotation.x = -0.4;
  g.add(head);
  const m2 = mesh(G.box, mane);
  m2.scale.set(0.1, 0.35, 0.5);
  m2.position.set(0, 1.25, 0.45);
  g.add(m2);
  const legs = [];
  for (const [x, z] of [[-0.22, 0.45], [0.22, 0.45], [-0.22, -0.45], [0.22, -0.45]]) {
    const l = mesh(G.horseLeg, coat);
    l.position.set(x, 0.28, z);
    g.add(l);
    legs.push(l);
  }
  return { group: g, legs, flash: [coat] };
}

function makeCatapult() {
  const g = new T.Group();
  const wood = toon(0xa0703f), dark = toon(0x6a4628);
  const base = mesh(G.box, wood);
  base.scale.set(1.6, 0.35, 2.2);
  base.position.y = 0.5;
  g.add(base);
  for (const [x, z] of [[-0.85, 0.7], [0.85, 0.7], [-0.85, -0.7], [0.85, -0.7]]) {
    const w = mesh(G.wheel, dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.35, z);
    g.add(w);
  }
  const arm = new T.Group();
  arm.position.set(0, 0.75, -0.3);
  g.add(arm);
  const beam = mesh(G.box, dark);
  beam.scale.set(0.18, 0.18, 2.2);
  beam.position.z = 0.9;
  arm.add(beam);
  const cup = mesh(G.ball, toon(0x7d7d86));
  cup.scale.setScalar(0.28);
  cup.position.set(0, 0.15, 1.9);
  arm.add(cup);
  arm.rotation.x = -0.35;
  return { group: g, arm, flash: [wood] };
}

function makeBar(width) {
  const g = new T.Group();
  const bg = new T.Mesh(G.plane, basic(0x221a1a, { transparent: true, opacity: 0.6, depthWrite: false }));
  bg.scale.set(width, 0.12, 1);
  const fill = new T.Mesh(G.plane, basic(0xff5d5d, { depthWrite: false }));
  fill.scale.set(width, 0.1, 1);
  fill.position.z = 0.001;
  g.add(bg, fill);
  g.visible = false;
  scene.add(g);
  return { group: g, fill, width };
}

// ───────────── 지형 ─────────────
function buildWorld() {
  const grass = new T.Mesh(new T.PlaneGeometry(90, 260), toon(0xa6d98a));
  grass.rotation.x = -Math.PI / 2;
  grass.position.z = -90;
  grass.receiveShadow = true;
  scene.add(grass);
  const path = new T.Mesh(new T.PlaneGeometry(VALLEY * 2 + 2, 260), toon(0xe2c48c));
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, -90);
  path.receiveShadow = true;
  scene.add(path);

  const rockMat = new T.MeshStandardMaterial({ color: 0xc9b49a, flatShading: true, roughness: 1 });
  const rockMat2 = new T.MeshStandardMaterial({ color: 0xb39b82, flatShading: true, roughness: 1 });
  const rockGeo = new T.DodecahedronGeometry(1, 0);
  for (let d = -25; d < 190; d += 3.2) {
    for (const side of [-1, 1]) {
      const s = 1.8 + srand() * 2.4;
      const r = new T.Mesh(rockGeo, srand() > 0.5 ? rockMat : rockMat2);
      r.scale.set(s, s * (1 + srand() * 1.2), s);
      r.position.set(side * (VALLEY + 2.6 + srand() * 3.5), s * 0.5, -d - srand() * 2);
      r.rotation.set(srand() * 3, srand() * 3, srand() * 3);
      r.castShadow = true;
      r.receiveShadow = true;
      scene.add(r);
    }
  }
  const trunk = toon(0x8a5a3a), leaf = toon(0x6cc36a), leaf2 = toon(0x86d47a);
  const trunkGeo = new T.CylinderGeometry(0.18, 0.25, 1.2, 6), leafGeo = new T.ConeGeometry(1.1, 2.2, 7);
  for (let i = 0; i < 70; i++) {
    const side = srand() > 0.5 ? 1 : -1;
    const x = side * (VALLEY + 7 + srand() * 18), d = -20 + srand() * 200;
    const t = mesh(trunkGeo, trunk);
    t.position.set(x, 0.6, -d);
    const l = mesh(leafGeo, srand() > 0.5 ? leaf : leaf2);
    l.position.set(x, 2.0, -d);
    scene.add(t, l);
  }
  const marble = toon(0xf4f1ea);
  const colGeo = new T.CylinderGeometry(0.35, 0.4, 3, 10);
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const c = mesh(colGeo, marble);
    const h = 0.5 + srand() * 0.8;
    c.scale.y = h;
    c.position.set(side * (VALLEY - 0.3), 1.5 * h, -(10 + i * 14 + srand() * 4));
    scene.add(c);
  }
}

// ───────────── 게임 상태 ─────────────
const army = { x: 0, targetX: 0, d: 0, order: 'halt', stance: 'normal', chargeT: 0, tiredT: 0, buffT: 0, rows: 2, width: 7.5, chargeId: 0 };
const game = {
  screen: 'title', stageIdx: 0, time: 0, waveIdx: 0, archerCd: ARCHER_INTERVAL,
  soldiers: [], enemies: [], telegraphs: [], projectiles: [], effects: [],
  cds: { javelin: 0, charge: 0, warcry: 0 }, shake: 0, endTimer: 0, result: null,
  bubble: { text: '', t: 0 }, boss: null, damageBy: {},
};
let commander = null;
const keys = new Set();

const progress = (() => {
  let data = { stars: [0, 0, 0, 0, 0] };
  try { data = JSON.parse(localStorage.getItem('shout_phalanx_progress')) || data; } catch { /* 저장소 없음 */ }
  return {
    stars: (i) => data.stars[i] || 0,
    unlocked: (i) => i === 0 || (data.stars[i - 1] || 0) > 0,
    save(i, s) {
      data.stars[i] = Math.max(data.stars[i] || 0, s);
      try { localStorage.setItem('shout_phalanx_progress', JSON.stringify(data)); } catch { /* 무시 */ }
    },
  };
})();

function clearUnits() {
  for (const list of [game.soldiers, game.enemies, game.projectiles, game.effects, game.telegraphs]) {
    for (const u of list) removeObj(u);
    list.length = 0;
  }
  if (commander) { scene.remove(commander.group); commander = null; }
}
function removeObj(u) {
  if (u.group) scene.remove(u.group);
  if (u.mesh) scene.remove(u.mesh);
  if (u.meshes) u.meshes.forEach((m) => scene.remove(m));
  if (u.bar) scene.remove(u.bar.group);
}

function startStage(i) {
  clearUnits();
  game.stageIdx = i;
  game.time = 0;
  game.waveIdx = 0;
  game.archerCd = ARCHER_INTERVAL;
  game.cds = { javelin: 0, charge: 0, warcry: 0 };
  game.endTimer = 0;
  game.result = null;
  game.damageBy = {};
  game.boss = null;
  Object.assign(army, { x: 0, targetX: 0, d: 0, order: 'halt', stance: 'normal', chargeT: 0, tiredT: 0, buffT: 0 });
  for (let k = 0; k < SOLDIER_COUNT; k++) {
    const c = makeChibi({ tunic: 0xe2483f, helmet: 'greek', weapon: 'spear', shield: true, cape: true });
    const s = {
      ...c, alive: true, hp: SOLDIER_HP, x: 0, d: 0, atkCd: rand(0, 0.8), thrustT: 0, hitT: 0, deadT: 0,
      phase: rand(0, 6), bar: makeBar(0.8), chargeHit: 0,
    };
    s.group.rotation.y = Math.PI;
    scene.add(s.group);
    game.soldiers.push(s);
  }
  layoutFormation();
  for (const s of game.soldiers) { s.x = s.slotX; s.d = s.slotD; }
  commander = makeChibi({ tunic: 0xb8232c, helmet: 'greek', weapon: 'none', shield: false, cape: true, accent: 0x7b3fc4, metal: 0xffcf5a });
  commander.group.scale.setScalar(1.25);
  commander.group.rotation.y = Math.PI;
  commander.x = 0; commander.d = -5;
  scene.add(commander.group);
  game.screen = 'play';
  ui.showScreen(null);
  ui.stageIntro(STAGES[i]);
  say(STAGES[i].name);
}

function layoutFormation() {
  const sp = SPACING[army.stance], rs = ROW_SP[army.stance];
  const alive = game.soldiers.filter((s) => s.alive);
  const n = alive.length;
  const cols = Math.max(1, Math.min(COLS, n));
  alive.forEach((s, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const col = i % cols;
    s.row = row;
    s.slotX = army.x + (col - (inRow - 1) / 2) * sp;
    s.slotD = army.d - row * rs;
  });
  army.rows = Math.ceil(n / cols);
  army.width = (cols - 1) * sp;
  return alive;
}

function spawnWave(w) {
  const groupX = rand(-3, 3);
  for (const [type, count] of w.units) {
    for (let k = 0; k < count; k++) {
      const x = type === 'boss' ? 0 : clamp(groupX + rand(-4, 4), -8, 8);
      spawnEnemy(type, x, army.d + SPAWN_AHEAD[type] + rand(0, 6));
    }
  }
}

function spawnEnemy(type, x, d) {
  const def = ENEMY[type];
  let parts;
  if (type === 'grunt') parts = makeChibi({ tunic: 0x7a5cc9, helmet: 'horn', weapon: 'club', metal: 0x8c8aa3 });
  else if (type === 'archer') parts = makeChibi({ tunic: 0x3f9a6a, helmet: 'hood', weapon: 'bow' });
  else if (type === 'rider') {
    const rider = makeChibi({ tunic: 0x4a6fd1, helmet: 'horn', weapon: 'club', metal: 0x8c8aa3 });
    const horse = makeHorse();
    rider.group.position.set(0, 0.62, -0.1);
    horse.group.add(rider.group);
    parts = { group: horse.group, rig: rider.rig, legs: horse.legs, weapon: rider.weapon, flash: [...horse.flash, ...rider.flash], riderParts: rider };
  } else if (type === 'catapult') parts = makeCatapult();
  else if (type === 'boss') {
    parts = makeChibi({ tunic: 0x8e2c4f, helmet: 'crown', weapon: 'club', metal: 0x8c8aa3 });
    parts.group.scale.setScalar(2.5);
  }
  const e = {
    ...parts, type, def, alive: true, hp: def.hp, x, d, r: def.r, atkCd: rand(0.5, 1.5), stun: 0, hitT: 0, deadT: 0,
    phase: rand(0, 6), state: 'wait', stateT: rand(1.5, 3.5), fireCd: rand(3, 5), hitSet: new Set(), bar: null,
  };
  if (type !== 'boss') e.bar = makeBar(type === 'catapult' ? 1.6 : 0.9);
  if (type === 'rider') { e.waitX = x; e.waitD = d; }
  if (type === 'boss') { e.state = 'walk'; e.abilityT = 4; e.abilityIdx = 0; game.boss = e; }
  e.group.position.copy(worldPos(x, d));
  scene.add(e.group);
  game.enemies.push(e);
  return e;
}

// ───────────── 명령 ─────────────
function say(text, t = 1.6) { game.bubble.text = text; game.bubble.t = t; }

function issueCommand(id, source = 'key') {
  if (game.screen !== 'play' || !COMMAND_INFO[id]) return false;
  const label = COMMAND_INFO[id].label;
  if (COOLDOWN[id] && game.cds[id] > 0) {
    say(`${label} 준비 중! (${Math.ceil(game.cds[id])}초)`, 1.2);
    sfx.denied();
    ui.flashCommand(id, false);
    return false;
  }
  switch (id) {
    case 'advance': case 'retreat': case 'halt': case 'attack':
      army.order = id;
      break;
    case 'left': army.targetX -= 4; break;
    case 'right': army.targetX += 4; break;
    case 'shield': army.stance = 'shield'; break;
    case 'spread': army.stance = 'spread'; break;
    case 'gather': army.stance = 'normal'; break;
    case 'javelin': throwJavelins(); break;
    case 'charge':
      army.chargeT = 2.2;
      army.chargeId++;
      army.stance = 'normal';
      army.order = 'attack';
      break;
    case 'warcry':
      army.buffT = 7;
      sfx.warcry();
      shockwave();
      break;
  }
  if (COOLDOWN[id]) game.cds[id] = COOLDOWN[id];
  say(`${label}!`);
  sfx.command();
  ui.flashCommand(id, true, source);
  return true;
}

function throwJavelins() {
  sfx.throwJav();
  const targets = game.enemies.filter((e) => e.alive && e.d - army.d < 26 && e.d > army.d - 2);
  for (const s of game.soldiers) {
    if (!s.alive) continue;
    const e = targets.length ? targets[Math.floor(Math.random() * targets.length)] : null;
    const to = e ? { x: e.x + rand(-0.3, 0.3), d: e.d } : { x: s.x + rand(-2, 2), d: s.d + rand(14, 20) };
    const m = new T.Group();
    const shaft = mesh(G.shaft, toon(0x9a6a3c));
    shaft.rotation.x = Math.PI / 2;
    m.add(shaft);
    scene.add(m);
    game.projectiles.push({ kind: 'javelin', mesh: m, from: { x: s.x, d: s.d }, to, target: e, t: 0, dur: 0.75 + Math.random() * 0.2, h: 3 });
  }
}

function shockwave() {
  const front = army.d;
  for (const e of game.enemies) {
    if (!e.alive || e.d - front > 8 || e.d < front - 3) continue;
    if (e.type !== 'boss' && e.type !== 'catapult') { e.d += 3; e.stun = Math.max(e.stun, 1.4); }
    else if (e.type === 'boss') e.stun = Math.max(e.stun, 0.8);
  }
  addRing(army.x, army.d - 1, 0xffd34d, 9);
}

// ───────────── 피해 ─────────────
function hurtSoldier(s, dmg, cause) {
  if (!s.alive) return;
  const mult = army.buffT > 0 ? 0.6 : 1;
  s.hp -= dmg * mult;
  game.damageBy[cause] = (game.damageBy[cause] || 0) + dmg * mult;
  s.hitT = 0.18;
  if (s.hp <= 0) {
    s.alive = false;
    s.deadT = 0;
    s.bar.group.visible = false;
    puff(s.x, s.d, 0xffffff, 6);
    sfx.hurt();
  }
}

function hurtEnemy(e, dmg) {
  if (!e.alive) return;
  e.hp -= dmg;
  e.hitT = 0.15;
  if (e.hp <= 0) {
    e.alive = false;
    e.deadT = 0;
    if (e.bar) e.bar.group.visible = false;
    puff(e.x, e.d, 0xd9c9ff, e.type === 'boss' ? 20 : 7);
  }
}

// ───────────── 업데이트 ─────────────
function update(dt) {
  game.time += dt;
  for (const k of Object.keys(game.cds)) game.cds[k] = Math.max(0, game.cds[k] - dt);
  game.bubble.t = Math.max(0, game.bubble.t - dt);
  game.shake = Math.max(0, game.shake - dt * 2);

  const stage = STAGES[game.stageIdx];
  while (game.waveIdx < stage.waves.length && army.d >= stage.waves[game.waveIdx].at) {
    spawnWave(stage.waves[game.waveIdx]);
    game.waveIdx++;
  }

  updateArmy(dt);
  updateSoldiers(dt);
  updateEnemies(dt);
  resolveCollisions();
  updateTelegraphs(dt);
  updateProjectiles(dt);
  updateEffects(dt);
  checkEnd(dt);
}

function frontBlocked(alive) {
  for (const s of alive) {
    if (s.row !== 0) continue;
    for (const e of game.enemies) {
      if (!e.alive) continue;
      const gap = e.d - s.d;
      if (Math.abs(e.x - s.x) < 0.8 + e.r && gap > -0.3 && gap < 1.0 + e.r) return true;
    }
  }
  return false;
}

function updateArmy(dt) {
  army.buffT = Math.max(0, army.buffT - dt);
  army.tiredT = Math.max(0, army.tiredT - dt);
  if (army.chargeT > 0) {
    army.chargeT -= dt;
    if (army.chargeT <= 0) army.tiredT = 3;
  }
  const alive = layoutFormation();
  if (army.order === 'attack' && army.chargeT <= 0) {
    const e = nearestEnemy({ x: army.x, d: army.d }, 30, (en) => en.d > army.d - 2);
    if (e && Math.abs(e.x - army.x) > army.width / 2) army.targetX += (e.x - army.targetX) * damp(1.5, dt);
  }
  const half = army.width / 2;
  army.targetX = clamp(army.targetX, -VALLEY + half + 0.6, VALLEY - half - 0.6);
  army.x += (army.targetX - army.x) * damp(3, dt);

  let speed = MARCH[army.stance] * (army.tiredT > 0 ? 0.5 : 1);
  // 살아 있는 적을 지나쳐 갈 수는 없다 (돌진 중인 기병·거인은 제외). 돌격도 적 앞에서 부딪혀 멈춘다.
  const limit = Math.min(...game.enemies.filter((e) => e.alive && e.state !== 'charge' && e.state !== 'return').map((e) => e.d - e.r - 0.6));
  if (army.chargeT > 0) {
    army.d = Math.max(army.d, Math.min(army.d + CHARGE_SPEED * dt, limit + 0.4));
  } else if (army.order === 'advance' || army.order === 'attack') {
    if (!frontBlocked(alive)) army.d = Math.max(army.d, Math.min(army.d + speed * dt, limit));
  } else if (army.order === 'retreat') {
    army.d = Math.max(-6, army.d - speed * 0.85 * dt);
  }
  layoutFormation();
}

function nearestEnemy(p, maxDist, filter) {
  let best = null, bd = maxDist;
  for (const e of game.enemies) {
    if (!e.alive || (filter && !filter(e))) continue;
    const d = dist(p, e) - e.r;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function updateSoldiers(dt) {
  const charging = army.chargeT > 0;
  for (const s of game.soldiers) {
    if (!s.alive) { animateDeath(s, dt); continue; }
    let tx = s.slotX, td = s.slotD;
    // 공격 명령 중엔 가까운 적 쪽으로 반걸음 나선다
    if (army.order === 'attack' && !charging) {
      const e = nearestEnemy({ x: s.slotX, d: s.slotD }, 3, (en) => en.d > s.slotD - 0.5);
      if (e) { tx = lerp(tx, e.x, 0.5); td = Math.min(e.d - e.r - 1.2, s.slotD + 1.5); }
    }
    const maxV = charging ? CHARGE_SPEED + 1 : Math.max(MARCH[army.stance] + 1.5, 4) * (army.tiredT > 0 ? 0.6 : 1);
    const dx = tx - s.x, dd = td - s.d, l = Math.hypot(dx, dd);
    const step = Math.min(l, maxV * dt);
    if (l > 1e-3) { s.x += (dx / l) * step; s.d += (dd / l) * step; }
    s.moving = l > 0.15;

    // 돌격 중 부딪힌 적은 크게 밀려나며 큰 피해를 입는다
    if (charging) {
      for (const e of game.enemies) {
        if (!e.alive || e.chargeHit === army.chargeId) continue;
        if (dist(s, e) < 1.1 + e.r) {
          e.chargeHit = army.chargeId;
          hurtEnemy(e, e.type === 'boss' ? 40 : 30);
          if (e.type !== 'boss' && e.type !== 'catapult') { e.d += 3; e.stun = 0.9; }
          sfx.stab();
          spark(e.x, e.d, 1.0);
        }
      }
    }

    s.atkCd -= dt;
    s.thrustT = Math.max(0, s.thrustT - dt);
    if (s.atkCd <= 0) {
      const e = nearestEnemy(s, REACH, (en) => en.d > s.d - 0.3 || dist(en, s) - en.r < 1.4); // 바로 옆·뒤에 붙은 적도 찌른다
      if (e) {
        let dmg = 10 * (army.buffT > 0 ? 1.5 : 1);
        if (army.stance === 'shield') dmg *= 0.6;
        else if (army.stance === 'spread') dmg *= 0.8;
        hurtEnemy(e, dmg);
        s.thrustT = 0.25;
        s.atkCd = (army.order === 'attack' ? 0.8 : 1.0) * (army.stance === 'shield' ? 1.3 : 1) * rand(0.9, 1.1);
        if (Math.random() < 0.4) sfx.stab();
      } else s.atkCd = 0.1;
    }
    animateSoldier(s, dt);
  }
  if (commander) {
    commander.x = lerp(commander.x, army.x, damp(4, dt));
    commander.d = lerp(commander.d, army.d - army.rows * ROW_SP[army.stance] - 1.4, damp(4, dt));
    commander.group.position.copy(worldPos(commander.x, commander.d));
    commander.rig.position.y = game.bubble.t > 1.2 ? 0.12 * Math.sin((1.6 - game.bubble.t) * 20) : 0;
  }
}

function nearestSoldier(p) {
  let best = null, bd = Infinity;
  for (const s of game.soldiers) {
    if (!s.alive) continue;
    const d = dist(p, s);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function updateEnemies(dt) {
  // 궁수는 한 무리로 일제 사격한다: 궁수가 많을수록 원이 크고 아프다
  const archers = game.enemies.filter((e) => e.alive && e.type === 'archer' && e.d - army.d < 24);
  if (archers.length) {
    game.archerCd -= dt;
    if (game.archerCd <= 0) {
      game.archerCd = ARCHER_INTERVAL;
      const r = Math.min(6, 3 + archers.length * 0.6);
      addTelegraph('arrows', army.x + rand(-1.5, 1.5), army.d - 1 + rand(-1, 1), r, 2.3, { dmg: 20 + archers.length * 4 });
      archers.forEach((a) => { a.drawT = 2.3; });
    }
  }

  for (const e of game.enemies) {
    if (!e.alive) { animateDeath(e, dt); continue; }
    e.stun = Math.max(0, e.stun - dt);
    e.atkCd -= dt;
    e.moving = false;
    if (e.stun > 0) { animateEnemy(e, dt); continue; }
    const target = nearestSoldier(e);
    if (!target) { animateEnemy(e, dt); continue; }
    switch (e.type) {
      case 'grunt': meleeAI(e, target, dt, 1.1); break;
      case 'archer':
        e.drawT = Math.max(0, (e.drawT || 0) - dt);
        if (e.d - army.d > 17) moveToward(e, { x: e.x, d: army.d + 16 }, e.def.speed, dt);
        else if (e.d - army.d < 9) meleeAI(e, target, dt, 1.1); // 가까이 오면 활을 버리고 덤빈다
        break;
      case 'rider': riderAI(e, target, dt); break;
      case 'catapult': catapultAI(e, dt); break;
      case 'boss': bossAI(e, target, dt); break;
    }
    animateEnemy(e, dt);
  }
}

function moveToward(e, p, speed, dt) {
  const dx = p.x - e.x, dd = p.d - e.d, l = Math.hypot(dx, dd);
  if (l < 0.05) return;
  const st = Math.min(l, speed * dt);
  e.x += (dx / l) * st;
  e.d += (dd / l) * st;
  e.moving = true;
  e.face = Math.atan2(dx, -dd);
}

function meleeAI(e, target, dt, range) {
  const d = dist(e, target);
  if (d > range + e.r) moveToward(e, target, e.def.speed, dt);
  else {
    e.face = Math.atan2(target.x - e.x, -(target.d - e.d));
    if (e.atkCd <= 0) {
      e.atkCd = e.def.atkCd * rand(0.9, 1.2);
      e.swingT = 0.3;
      const mult = army.stance === 'shield' ? 0.3 : army.stance === 'spread' ? 1.2 : 1;
      hurtSoldier(target, e.def.dmg * mult, e.type);
      if (army.stance === 'shield') { sfx.clang(); spark(target.x, target.d + 0.4, 0.6); }
    }
  }
}

function laneCast(e, width, dur) {
  const lane = addTelegraph('lane', e.x, e.d, width, dur, { from: e });
  e.lane = lane;
  sfx.horn();
}

function riderAI(e, target, dt) {
  e.stateT -= dt;
  if (e.state === 'wait') {
    const spot = { x: e.waitX, d: Math.max(e.waitD, army.d + 18) };
    moveToward(e, spot, 5, dt);
    e.face = 0;
    if (e.stateT <= 0 && e.d - army.d < 30) {
      e.state = 'aim';
      e.stateT = 1.9;
      const center = nearestSoldier({ x: army.x, d: army.d }) || target;
      e.laneX = center.x;
      e.x = lerp(e.x, e.laneX, 0.6);
      laneCast(e, 1.8, 1.9);
    }
  } else if (e.state === 'aim') {
    e.x += (e.laneX - e.x) * damp(5, dt);
    e.face = 0;
    if (e.stateT <= 0) { e.state = 'charge'; e.hitSet.clear(); }
  } else if (e.state === 'charge') {
    e.d -= 13 * dt;
    e.moving = true;
    e.face = 0;
    for (const s of game.soldiers) {
      if (!s.alive || e.hitSet.has(s)) continue;
      if (Math.abs(s.x - e.x) < 0.95 && Math.abs(s.d - e.d) < 0.9) {
        e.hitSet.add(s);
        if (army.stance === 'shield') {
          hurtEnemy(e, 55);
          hurtSoldier(s, 4, 'rider');
          e.state = 'stunned';
          e.stun = 2.2;
          e.stateT = 2.2;
          e.d += 1.5;
          sfx.clang(); sfx.clang();
          spark(e.x, e.d - 0.8, 1.4);
          floatText('막았다!', e.x, e.d, '#ffe08a');
          break;
        }
        hurtSoldier(s, 45, 'rider');
        s.x += Math.sign(s.x - e.x || 1) * 1.2;
        sfx.hurt();
        puff(s.x, s.d, 0xf3dca8, 4);
      }
    }
    if (e.d < army.d - army.rows * ROW_SP[army.stance] - 5) { e.state = 'return'; e.side = Math.random() < 0.5 ? -1 : 1; }
  } else if (e.state === 'return') {
    moveToward(e, { x: e.side * (VALLEY - 1), d: army.d + 20 }, 9, dt);
    if (e.d > army.d + 16) { e.state = 'wait'; e.stateT = rand(2.5, 4); e.waitX = rand(-5, 5); e.waitD = army.d + 20; }
  } else if (e.state === 'stunned') {
    if (e.stateT <= 0) { e.state = 'wait'; e.stateT = rand(2, 3.5); e.waitX = e.x; e.waitD = e.d + 14; }
  }
  if (e.lane && e.state !== 'aim' && e.state !== 'charge') { e.lane.done = true; e.lane = null; }
}

function catapultAI(e, dt) {
  e.fireCd -= dt;
  e.armT = Math.max(0, (e.armT || 0) - dt);
  if (e.fireCd <= 0 && e.d - army.d < 42) {
    e.fireCd = rand(10, 12);
    e.armT = 0.6;
    const tx = army.x + rand(-1, 1), td = army.d - ROW_SP[army.stance] * 0.5;
    const tel = addTelegraph('boulder', tx, td, 3.2, 2.8, { dmg: 25 });
    const rock = mesh(G.ball, toon(0x8d8d96));
    rock.scale.setScalar(0.55);
    scene.add(rock);
    game.projectiles.push({ kind: 'boulder', mesh: rock, from: { x: e.x, d: e.d }, to: { x: tx, d: td }, t: 0, dur: 2.8, h: 12, tel });
  }
}

function bossAI(e, target, dt) {
  e.abilityT -= dt;
  e.swingT = Math.max(0, (e.swingT || 0) - dt);
  if (e.state === 'walk') {
    const front = army.d;
    if (e.d - front > 2.8) moveToward(e, { x: lerp(e.x, army.x, 0.02), d: e.d - 1 }, e.def.speed, dt);
    // 가까이 있는 병사 두 명까지 휩쓸어 친다
    if (e.atkCd <= 0) {
      const near = game.soldiers.filter((s) => s.alive && dist(s, e) < 2.8 + e.r).slice(0, 2);
      if (near.length) {
        e.atkCd = e.def.atkCd;
        e.swingT = 0.35;
        near.forEach((s) => hurtSoldier(s, e.def.dmg * (army.stance === 'shield' ? 0.4 : 1), 'boss'));
        if (army.stance === 'shield') sfx.clang();
      }
    }
    if (e.abilityT <= 0) {
      const ab = ['slam', 'summon', 'charge'][e.abilityIdx++ % 3];
      if (ab === 'slam') {
        addTelegraph('slam', army.x, army.d - 0.5, 4.4, 2.1, { dmg: 45, from: e });
        e.state = 'slam'; e.stateT = 2.1;
        floatText('내려찍기!', e.x, e.d, '#ff8a8a');
      } else if (ab === 'summon') {
        for (let k = 0; k < 4; k++) spawnEnemy('grunt', clamp(e.x + rand(-5, 5), -VALLEY + 1, VALLEY - 1), e.d + rand(2, 5));
        floatText('부하들아!', e.x, e.d, '#d7c2ff');
        sfx.horn();
        e.abilityT = 6;
      } else {
        e.state = 'aim'; e.stateT = 2.1; e.laneX = army.x;
        e.d = Math.max(e.d, army.d + 8);
        laneCast(e, 3.4, 2.1);
        floatText('돌진한다!', e.x, e.d, '#ff8a8a');
      }
    }
  } else if (e.state === 'slam') {
    e.stateT -= dt;
    if (e.stateT <= 0) { e.state = 'walk'; e.abilityT = 6; e.swingT = 0.4; }
  } else if (e.state === 'aim') {
    e.stateT -= dt;
    e.x += (e.laneX - e.x) * damp(4, dt);
    if (e.stateT <= 0) { e.state = 'charge'; e.hitSet.clear(); }
  } else if (e.state === 'charge') {
    e.d -= 9 * dt;
    e.moving = true;
    let blocked = false;
    for (const s of game.soldiers) {
      if (!s.alive || e.hitSet.has(s)) continue;
      if (Math.abs(s.x - e.x) < 1.8 && Math.abs(s.d - e.d) < 1.5) {
        e.hitSet.add(s);
        if (army.stance === 'shield') { blocked = true; break; }
        hurtSoldier(s, 45, 'boss');
        s.x += Math.sign(s.x - e.x || 1) * 1.5;
      }
    }
    if (blocked || e.d < army.d - army.rows * 1.5 - 3) { if (e.lane) { e.lane.done = true; e.lane = null; } }
    if (blocked) {
      hurtEnemy(e, 120);
      e.stun = 3;
      e.state = 'walk';
      e.abilityT = 7;
      e.d += 2;
      sfx.clang(); sfx.boom();
      spark(e.x, e.d - 1.5, 2);
      floatText('막았다! 거인이 휘청!', e.x, e.d, '#ffe08a');
      game.shake = 0.6;
    } else if (e.d < army.d - army.rows * 1.5 - 3) {
      e.state = 'walk'; e.abilityT = 5; e.d = army.d + 10; e.x = clamp(e.x, -6, 6);
      puff(e.x, e.d, 0xf3dca8, 10);
    }
  }
}

function resolveCollisions() {
  const solid = game.enemies.filter((e) => e.alive && e.state !== 'charge');
  for (const e of solid) {
    for (const s of game.soldiers) {
      if (!s.alive) continue;
      const dx = e.x - s.x, dd = e.d - s.d, l = Math.hypot(dx, dd), min = e.r + 0.42;
      if (l < min && l > 1e-4) {
        const push = min - l;
        // 투석기는 움직이지 않고, 거인은 거의 밀리지 않는다
        const share = e.type === 'catapult' ? 0 : e.type === 'boss' ? 0.1 : 0.75;
        e.x += (dx / l) * push * share; e.d += (dd / l) * push * share;
        s.x -= (dx / l) * push * (1 - share); s.d -= (dd / l) * push * (1 - share);
      }
    }
  }
  const live = solid.filter((e) => e.type !== 'catapult');
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const dx = b.x - a.x, dd = b.d - a.d, l = Math.hypot(dx, dd), min = a.r + b.r;
      if (l < min && l > 1e-4) {
        const p = (min - l) / 2;
        a.x -= (dx / l) * p; a.d -= (dd / l) * p;
        b.x += (dx / l) * p; b.d += (dd / l) * p;
      }
    }
  }
  for (const u of [...game.enemies, ...game.soldiers]) u.x = clamp(u.x, -VALLEY + 0.4, VALLEY - 0.4);
}

// ───────────── 예고(텔레그래프) ─────────────
function addTelegraph(kind, x, d, r, dur, extra = {}) {
  const color = kind === 'arrows' ? 0xff5050 : kind === 'boulder' ? 0xff8a1f : kind === 'slam' ? 0xb04cff : 0xff3030;
  const tel = { kind, x, d, r, dur, t: 0, meshes: [], ...extra };
  if (kind === 'lane') {
    const len = 40;
    const strip = new T.Mesh(G.plane, basic(color, { transparent: true, opacity: 0.25, depthWrite: false }));
    strip.rotation.x = -Math.PI / 2;
    strip.scale.set(r, len, 1);
    tel.len = len;
    tel.meshes.push(strip);
  } else {
    const ring = new T.Mesh(G.ring, basic(color, { transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(r);
    const fill = new T.Mesh(G.disc, basic(color, { transparent: true, opacity: 0.28, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    tel.meshes.push(ring, fill);
  }
  tel.meshes.forEach((m) => scene.add(m));
  game.telegraphs.push(tel);
  if (kind === 'arrows') sfx.arrows();
  return tel;
}

function updateTelegraphs(dt) {
  for (const tel of game.telegraphs) {
    tel.t += dt;
    const p = clamp(tel.t / tel.dur, 0, 1);
    if (tel.kind === 'lane') {
      const e = tel.from;
      const [strip] = tel.meshes;
      strip.position.set(e.laneX ?? e.x, 0.04, -(e.d - tel.len / 2));
      strip.material.opacity = 0.18 + 0.2 * Math.abs(Math.sin(tel.t * 8));
      if (!e.alive) tel.done = true;
      continue;
    }
    const [ring, fill] = tel.meshes;
    ring.position.set(tel.x, 0.05, -tel.d);
    fill.position.set(tel.x, 0.04, -tel.d);
    fill.scale.setScalar(Math.max(0.01, tel.r * p));
    ring.material.opacity = 0.5 + 0.5 * Math.abs(Math.sin(tel.t * (4 + p * 10)));
    if (tel.kind === 'arrows' && !tel.volley && tel.t > tel.dur - 0.7) {
      tel.volley = true;
      for (let k = 0; k < 18; k++) {
        const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * tel.r;
        const m = mesh(G.arrow, toon(0x5a4030), false);
        scene.add(m);
        game.projectiles.push({ kind: 'arrow', mesh: m, from: { x: tel.x + Math.cos(a) * rr + 3, d: tel.d + Math.sin(a) * rr + 9 }, to: { x: tel.x + Math.cos(a) * rr, d: tel.d + Math.sin(a) * rr }, t: -Math.random() * 0.15, dur: 0.7, h: 5, fromY: 9 });
      }
    }
    if (tel.t >= tel.dur) {
      tel.done = true;
      landTelegraph(tel);
    }
  }
  game.telegraphs = game.telegraphs.filter((tel) => {
    if (tel.done) tel.meshes.forEach((m) => scene.remove(m));
    return !tel.done;
  });
}

function landTelegraph(tel) {
  const inside = game.soldiers.filter((s) => s.alive && Math.hypot(s.x - tel.x, s.d - tel.d) < tel.r);
  if (tel.kind === 'arrows') {
    const blocked = army.stance === 'shield';
    inside.forEach((s) => hurtSoldier(s, tel.dmg * (blocked ? 0.08 : 1), 'arrows'));
    if (blocked && inside.length) {
      sfx.clang();
      inside.slice(0, 5).forEach((s) => spark(s.x, s.d + 0.3, 0.5));
      floatText('막았다!', tel.x, tel.d, '#ffe08a');
    } else if (inside.length) sfx.hurt();
  } else if (tel.kind === 'boulder' || tel.kind === 'slam') {
    inside.forEach((s) => hurtSoldier(s, tel.dmg, tel.kind));
    sfx.boom();
    game.shake = 0.5;
    puff(tel.x, tel.d, 0xf3dca8, 14);
    if (!inside.length) floatText('피했다!', tel.x, tel.d, '#bdf5a5');
  }
}

// ───────────── 투사체 / 효과 ─────────────
function updateProjectiles(dt) {
  for (const p of game.projectiles) {
    p.t += dt;
    const k = clamp(p.t / p.dur, 0, 1);
    const x = lerp(p.from.x, p.to.x, k), d = lerp(p.from.d, p.to.d, k);
    const y = lerp(p.fromY ?? 1.2, 0.2, k) + Math.sin(k * Math.PI) * p.h;
    const prev = p.mesh.position.clone();
    p.mesh.position.copy(worldPos(x, d, y));
    if (p.kind !== 'boulder' && k > 0) {
      const dir = p.mesh.position.clone().sub(prev);
      if (dir.lengthSq() > 1e-6) p.mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, -1).applyAxisAngle(new T.Vector3(1, 0, 0), p.kind === 'arrow' ? -Math.PI / 2 : 0), dir.normalize());
    } else p.mesh.rotation.x += dt * 4;
    if (p.kind === 'arrow' && p.t < 0) p.mesh.visible = false; else p.mesh.visible = true;
    if (p.t >= p.dur) {
      p.done = true;
      if (p.kind === 'javelin' && p.target?.alive && Math.hypot(p.target.x - p.to.x, p.target.d - p.to.d) < 1.6 + p.target.r) {
        hurtEnemy(p.target, 25);
        spark(p.target.x, p.target.d, 0.5);
      }
    }
  }
  game.projectiles = game.projectiles.filter((p) => {
    if (p.done) scene.remove(p.mesh);
    return !p.done;
  });
}

function puff(x, d, color, n) {
  for (let i = 0; i < n; i++) {
    const m = new T.Mesh(G.ball, basic(color, { transparent: true, opacity: 0.8, depthWrite: false }));
    m.scale.setScalar(0.2);
    scene.add(m);
    game.effects.push({ mesh: m, x: x + rand(-0.5, 0.5), d: d + rand(-0.5, 0.5), y: 0.3, vx: rand(-1.5, 1.5), vd: rand(-1.5, 1.5), vy: rand(0.5, 2), life: 0.7, max: 0.7, grow: 0.5 });
  }
}
function spark(x, d, size) {
  for (let i = 0; i < 6 * size; i++) {
    const m = new T.Mesh(G.box, basic(0xffe48a));
    m.scale.setScalar(0.07);
    scene.add(m);
    game.effects.push({ mesh: m, x, d, y: 0.9, vx: rand(-4, 4), vd: rand(-4, 4), vy: rand(1, 5), g: 14, life: 0.35, max: 0.35 });
  }
}
function addRing(x, d, color, r) {
  const m = new T.Mesh(G.ring, basic(color, { transparent: true, opacity: 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  scene.add(m);
  game.effects.push({ mesh: m, x, d, y: 0.08, vx: 0, vd: 0, vy: 0, life: 0.6, max: 0.6, ring: r });
}

function updateEffects(dt) {
  for (const f of game.effects) {
    f.life -= dt;
    f.vy -= (f.g || 0) * dt;
    f.x += f.vx * dt; f.d += f.vd * dt; f.y = Math.max(0.05, f.y + f.vy * dt);
    f.mesh.position.copy(worldPos(f.x, f.d, f.y));
    const k = 1 - f.life / f.max;
    if (f.ring) f.mesh.scale.setScalar(0.5 + k * f.ring);
    else if (f.grow) f.mesh.scale.setScalar(0.2 + k * f.grow);
    if (f.mesh.material.transparent) f.mesh.material.opacity = Math.max(0, f.life / f.max) * 0.85;
  }
  game.effects = game.effects.filter((f) => {
    if (f.life <= 0) { scene.remove(f.mesh); f.mesh.material.dispose(); }
    return f.life > 0;
  });
}

// ───────────── 애니메이션 ─────────────
function setFlash(u) {
  const on = u.hitT > 0;
  for (const m of u.flash) m.emissive.setHex(on ? 0xff3030 : 0x000000);
}

function animateSoldier(s, dt) {
  s.hitT = Math.max(0, s.hitT - dt);
  s.phase += dt * (s.moving ? 11 : 2.5);
  s.group.position.copy(worldPos(s.x, s.d));
  s.rig.position.y = s.moving ? Math.abs(Math.sin(s.phase)) * 0.08 : Math.sin(s.phase) * 0.015;
  s.legs[0].rotation.x = s.moving ? Math.sin(s.phase) * 0.7 : 0;
  s.legs[1].rotation.x = s.moving ? -Math.sin(s.phase) * 0.7 : 0;
  const shield = army.stance === 'shield';
  s.shieldArm.position.x += ((shield ? 0.05 : 0.32) - s.shieldArm.position.x) * damp(12, dt);
  s.shieldArm.position.z += ((shield ? 0.42 : 0.16) - s.shieldArm.position.z) * damp(12, dt);
  s.shieldArm.scale.setScalar(lerp(s.shieldArm.scale.x, shield ? 1.3 : 1, damp(12, dt)));
  s.weapon.position.y += ((shield ? 0.95 : 0.6) - s.weapon.position.y) * damp(12, dt);
  s.weapon.position.z = 0.05 + Math.sin((s.thrustT / 0.25) * Math.PI) * 0.6;
  s.weapon.rotation.x = army.chargeT > 0 ? 0.25 : shield ? 0.0 : 0.08;
  s.head.rotation.z = army.buffT > 0 ? Math.sin(s.phase * 2) * 0.12 : 0;
  setFlash(s);
  const show = s.hp < SOLDIER_HP;
  s.bar.group.visible = show;
  if (show) placeBar(s.bar, s.x, s.d, 1.75, s.hp / SOLDIER_HP);
}

function animateEnemy(e, dt) {
  e.hitT = Math.max(0, e.hitT - dt);
  e.phase += dt * (e.moving ? (e.type === 'rider' ? 16 : 10) : 2.5);
  e.group.position.copy(worldPos(e.x, e.d));
  if (e.face !== undefined) e.group.rotation.y += angDelta(e.group.rotation.y, e.face) * damp(10, dt);
  if (e.type === 'catapult') {
    e.arm.rotation.x = e.armT > 0 ? -0.35 - 1.6 * Math.sin((e.armT / 0.6) * Math.PI) : -0.35;
  } else {
    if (e.rig) e.rig.position.y = e.moving ? Math.abs(Math.sin(e.phase)) * 0.08 : 0;
    if (e.legs) e.legs.forEach((l, i) => { l.rotation.x = e.moving ? Math.sin(e.phase + (i % 2) * Math.PI) * 0.7 : 0; });
    if (e.weapon) {
      e.swingT = Math.max(0, (e.swingT || 0) - dt);
      const raise = e.type === 'boss' && (e.state === 'slam' || e.state === 'aim') ? 1 : 0;
      e.weapon.rotation.x = 0.5 - Math.sin(((e.swingT || 0) / 0.3) * Math.PI) * 1.4 - raise * 1.8;
    }
    if (e.stun > 0 && e.rig) e.rig.rotation.z = Math.sin(game.time * 20) * 0.15; else if (e.rig) e.rig.rotation.z = 0;
  }
  setFlash(e);
  if (e.bar) {
    const show = e.hp < e.def.hp;
    e.bar.group.visible = show;
    if (show) placeBar(e.bar, e.x, e.d, e.type === 'rider' ? 2.6 : e.type === 'catapult' ? 2.2 : 1.7, e.hp / e.def.hp);
  }
}

function animateDeath(u, dt) {
  u.deadT += dt;
  u.group.rotation.x = Math.max(-Math.PI / 2, -u.deadT * 6);
  u.group.position.y = -Math.max(0, u.deadT - 0.8) * 0.8;
  if (u.deadT > 2 && !u.removed) {
    u.removed = true;
    scene.remove(u.group);
    if (u.bar) scene.remove(u.bar.group);
  }
}

function angDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function placeBar(bar, x, d, y, frac) {
  bar.group.position.copy(worldPos(x, d, y));
  bar.group.quaternion.copy(camera.quaternion);
  const f = clamp(frac, 0, 1);
  bar.fill.scale.x = bar.width * f;
  bar.fill.position.x = -bar.width * (1 - f) / 2;
  bar.fill.material.color.setHex(f > 0.5 ? 0x7be36a : f > 0.25 ? 0xffc44d : 0xff5d5d);
}

// ───────────── 승패 ─────────────
function checkEnd(dt) {
  if (game.result) {
    game.endTimer -= dt;
    if (game.endTimer <= 0 && game.screen === 'play') {
      game.screen = 'result';
      ui.showResult(game.result);
    }
    return;
  }
  const alive = game.soldiers.filter((s) => s.alive).length;
  const stage = STAGES[game.stageIdx];
  if (alive === 0) {
    game.result = { win: false, alive: 0 };
    game.endTimer = 1.8;
    sfx.lose();
    say('후퇴하라…', 3);
  } else if (game.waveIdx >= stage.waves.length && !game.enemies.some((e) => e.alive)) {
    // 별점은 남은 병력(체력 합계) 기준: 아무도 안 죽어도 많이 다쳤으면 3★가 아니다
    const strength = game.soldiers.reduce((sum, s) => sum + Math.max(0, s.alive ? s.hp : 0), 0) / (SOLDIER_COUNT * SOLDIER_HP);
    const stars = strength >= 0.7 ? 3 : strength >= 0.4 ? 2 : 1;
    game.result = { win: true, alive, stars, strength };
    progress.save(game.stageIdx, stars);
    game.endTimer = 1.8;
    sfx.win();
    say('승리다!', 3);
    addRing(army.x, army.d, 0xffd34d, 10);
  }
}

// ───────────── 카메라 / 렌더 ─────────────
const camPos = new T.Vector3(0, 13, 16);
const camLook = new T.Vector3();
function updateCamera(dt) {
  const target = worldPos(army.x * 0.7, army.d - 10, 11);
  camPos.lerp(target, damp(3, dt));
  camera.position.copy(camPos);
  if (game.shake > 0) camera.position.add(new T.Vector3(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(game.shake * 0.5));
  camLook.lerp(worldPos(army.x * 0.85, army.d + 9, -1), damp(4, dt));
  camera.lookAt(camLook);
  sun.position.copy(worldPos(army.x + 12, army.d + 10, 30));
  sun.target.position.copy(worldPos(army.x, army.d + 4, 0));
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ───────────── UI ─────────────
const $ = (id) => document.getElementById(id);
const ui = {
  floaters: [],
  init() {
    const bar = $('commands');
    for (const [id, c] of Object.entries(COMMAND_INFO)) {
      const b = document.createElement('button');
      b.className = 'cmd';
      b.dataset.cmd = id;
      b.innerHTML = `<span class="say">${c.label}</span><kbd>${c.key}</kbd><i class="cd"></i>`;
      b.addEventListener('click', () => { sfx.ensure(); issueCommand(id, 'click'); });
      bar.appendChild(b);
    }
    this.buttons = Object.fromEntries([...bar.children].map((b) => [b.dataset.cmd, b]));
    this.renderStages();
  },
  showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
    document.body.classList.toggle('playing', id === null);
  },
  renderStages() {
    const list = $('stage-list');
    list.innerHTML = '';
    STAGES.forEach((st, i) => {
      const b = document.createElement('button');
      const open = progress.unlocked(i);
      b.className = 'stage' + (open ? '' : ' locked');
      b.disabled = !open;
      const stars = progress.stars(i);
      b.innerHTML = `<b>${i + 1}</b><span class="nm">${st.name}</span><span class="ds">${open ? st.desc : '이전 스테이지를 깨면 열려요'}</span><span class="st">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>`;
      b.addEventListener('click', () => { sfx.ensure(); startStage(i); });
      list.appendChild(b);
    });
  },
  stageIntro(st) {
    $('stage-name').textContent = `STAGE ${game.stageIdx + 1} · ${st.name}`;
    $('stage-tip').textContent = st.tip;
    const intro = $('intro');
    intro.innerHTML = `<small>STAGE ${game.stageIdx + 1}</small><b>${st.name}</b><span>${st.tip}</span>`;
    intro.classList.remove('show');
    void intro.offsetWidth;
    intro.classList.add('show');
  },
  showResult(r) {
    $('result-title').textContent = r.win ? '승리!' : '패배…';
    $('result-title').className = r.win ? 'win' : 'lose';
    $('result-stars').textContent = r.win ? '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars) : '';
    $('result-text').textContent = r.win
      ? `살아남은 병사 ${r.alive} / ${SOLDIER_COUNT} · 남은 병력 ${Math.round(r.strength * 100)}%`
      : '방진이 무너졌어요. 예고 표시를 보고 알맞은 명령을 외쳐 보세요.';
    $('btn-next').style.display = r.win && game.stageIdx < STAGES.length - 1 ? '' : 'none';
    this.renderStages();
    this.showScreen('result');
  },
  flashCommand(id, ok, source) {
    const b = this.buttons[id];
    if (b) { b.classList.remove('ok', 'no'); void b.offsetWidth; b.classList.add(ok ? 'ok' : 'no'); }
    if (source === 'voice') $('heard-cmd').textContent = `🎙 ${COMMAND_INFO[id].label}`;
  },
  hint() {
    const kinds = new Set(game.telegraphs.map((t) => t.kind));
    if (kinds.has('lane')) return ["🐎 돌격이 온다! → '방패!'", 'danger'];
    if (kinds.has('slam')) return ["💥 내려찍기! → '후퇴!' 또는 '왼쪽/오른쪽'", 'danger'];
    if (kinds.has('boulder')) return ["🪨 바위가 날아온다! → '산개!' 또는 '왼쪽/오른쪽'", 'danger'];
    if (kinds.has('arrows')) return ["🏹 화살비! → '방패!'", 'danger'];
    const alive = game.enemies.filter((e) => e.alive);
    const stage = STAGES[game.stageIdx];
    if (!alive.length && game.waveIdx < stage.waves.length) return ["앞으로 나아가세요 → '전진!'", ''];
    const near = alive.some((e) => e.d - army.d < 6);
    if (near && army.stance !== 'normal' && army.chargeT <= 0) return ["대형을 풀면 더 세게 찔러요 → '모여!'", ''];
    if (near && army.order !== 'attack') return ["적이 코앞이에요 → '공격!'", ''];
    const far = alive.filter((e) => e.d - army.d > 10);
    if (far.length && game.cds.javelin <= 0) return ["멀리 있는 적에게 → '투창!'", ''];
    return ['', ''];
  },
  update() {
    if (game.screen !== 'play') return;
    const alive = game.soldiers.filter((s) => s.alive).length;
    $('troops').textContent = `🛡 ${alive} / ${SOLDIER_COUNT}`;
    const stage = STAGES[game.stageIdx];
    const lastAt = stage.waves[stage.waves.length - 1].at;
    const remain = game.enemies.filter((e) => e.alive).length;
    $('progress-fill').style.width = `${clamp(army.d / lastAt, 0, 1) * 100}%`;
    $('wave').textContent = `웨이브 ${game.waveIdx} / ${stage.waves.length} · 남은 적 ${remain}`;
    const orderName = { advance: '전진', retreat: '후퇴', halt: '정지', attack: '공격' }[army.order];
    const stanceName = { normal: '밀집 대형', shield: '방패벽', spread: '산개' }[army.stance];
    $('state').innerHTML = `${army.chargeT > 0 ? '<b>돌격!</b>' : orderName} · ${stanceName}${army.buffT > 0 ? ' · <b class="buff">함성</b>' : ''}${army.tiredT > 0 ? ' · 지침' : ''}`;
    for (const [id, b] of Object.entries(this.buttons)) {
      const cd = COOLDOWN[id] ? game.cds[id] / COOLDOWN[id] : 0;
      b.style.setProperty('--cd', cd);
      b.classList.toggle('active', id === army.order || (id === 'shield' && army.stance === 'shield') || (id === 'spread' && army.stance === 'spread') || (id === 'gather' && army.stance === 'normal'));
    }
    const [hint, cls] = this.hint();
    const h = $('hint');
    h.textContent = hint;
    h.className = cls;
    h.style.opacity = hint ? 1 : 0;

    // 지휘관 말풍선
    const bub = $('bubble');
    if (game.bubble.t > 0 && commander) {
      const p = worldPos(commander.x, commander.d, 2.6).project(camera);
      // 지휘관이 아래 명령 버튼 뒤로 가려져도 말풍선은 보이도록 높이를 제한한다
      const by = Math.min((-p.y * 0.5 + 0.5) * window.innerHeight, window.innerHeight - 150);
      bub.style.transform = `translate(${(p.x * 0.5 + 0.5) * window.innerWidth}px, ${by}px) translate(-50%, -100%)`;
      bub.textContent = game.bubble.text;
      bub.style.opacity = Math.min(1, game.bubble.t * 3);
    } else bub.style.opacity = 0;

    // 보스 체력
    const bossBar = $('boss');
    if (game.boss && game.boss.alive) {
      bossBar.style.display = '';
      $('boss-fill').style.width = `${(game.boss.hp / game.boss.def.hp) * 100}%`;
    } else bossBar.style.display = 'none';

    // 떠오르는 글자
    this.floaters = this.floaters.filter((f) => {
      f.t -= 1 / 60;
      const p = worldPos(f.x, f.d, 2.5 + (1.2 - f.t)).project(camera);
      f.el.style.transform = `translate(${(p.x * 0.5 + 0.5) * window.innerWidth}px, ${(-p.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -50%)`;
      f.el.style.opacity = Math.min(1, f.t * 2);
      if (f.t <= 0) f.el.remove();
      return f.t > 0;
    });
  },
};

function floatText(text, x, d, color) {
  const el = document.createElement('div');
  el.className = 'floater';
  el.textContent = text;
  el.style.color = color;
  $('floaters').appendChild(el);
  ui.floaters.push({ el, x, d, t: 1.2 });
}

// ───────────── 음성 ─────────────
const voice = new VoiceCommander({
  onCommand: (id) => issueCommand(id, 'voice'),
  onTranscript: (text, final) => {
    const el = $('heard');
    el.textContent = `“${text.trim()}”`;
    el.classList.toggle('interim', !final);
  },
  onState: (state, detail) => {
    const mic = $('mic');
    mic.dataset.state = state;
    const label = { listening: '듣는 중', off: '마이크 꺼짐', denied: '마이크 권한 거부됨', error: `오류: ${detail}` }[state] || state;
    $('mic-label').textContent = label;
    $('title-mic').textContent = state === 'listening' ? '🎙 마이크 준비 완료! 아무 명령이나 말해 보세요.' : state === 'denied' ? '마이크 권한이 거부됐어요. 키보드/버튼으로 플레이할 수 있어요.' : '';
  },
});
if (!voice.supported) {
  $('mic').dataset.state = 'unsupported';
  $('mic-label').textContent = '음성 인식 미지원 (Chrome/Edge 권장)';
}

function toggleMic() {
  sfx.ensure();
  if (!voice.supported) return;
  if (voice.wanted) voice.stop(); else voice.start();
}

// ───────────── 입력 / 루프 ─────────────
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Escape') {
    if (game.screen === 'play') { game.screen = 'paused'; ui.showScreen('pause'); } else if (game.screen === 'paused') { game.screen = 'play'; ui.showScreen(null); }
    return;
  }
  const id = KEY_TO_CMD[e.code];
  if (id && game.screen === 'play') {
    e.preventDefault();
    sfx.ensure();
    issueCommand(id, 'key');
  }
});

$('btn-start').addEventListener('click', () => { sfx.ensure(); voice.start(); ui.renderStages(); game.screen = 'select'; ui.showScreen('select'); });
$('btn-mic-test').addEventListener('click', () => { sfx.ensure(); voice.start(); });
$('mic').addEventListener('click', toggleMic);
$('btn-retry').addEventListener('click', () => startStage(game.stageIdx));
$('btn-next').addEventListener('click', () => startStage(game.stageIdx + 1));
for (const id of ['btn-select', 'btn-pause-select']) {
  $(id).addEventListener('click', () => { clearUnits(); game.screen = 'select'; ui.renderStages(); ui.showScreen('select'); });
}
$('btn-resume').addEventListener('click', () => { game.screen = 'play'; ui.showScreen(null); });
$('btn-back-title').addEventListener('click', () => { game.screen = 'title'; ui.showScreen('title'); });

buildWorld();
ui.init();
resize();
window.addEventListener('resize', resize);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.screen === 'play') update(dt);
  else if (game.screen === 'result') { updateSoldiers(dt); updateEnemies(dt); updateEffects(dt); }
  else game.time += dt;
  if (game.screen === 'title' || game.screen === 'select') {
    // 메뉴 뒤로 협곡을 천천히 비춘다
    army.d = 10 + Math.sin(game.time * 0.1) * 6;
  }
  updateCamera(dt);
  ui.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 개발 확인용: ?debug 로 열면 콘솔에서 상태를 보고 명령을 넣을 수 있다
if (/[?&]debug\b/.test(location.search)) {
  window.__phalanx = { game, army, issueCommand, startStage, step: (sec) => { for (let t = 0; t < sec; t += 1 / 60) update(1 / 60); } };
}
})();
