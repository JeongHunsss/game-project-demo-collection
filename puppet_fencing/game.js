// tracker.js가 먼저 로드되어 HandTracker, HAND_CONNECTIONS를 전역으로 제공한다 (file:// 로 열어도 동작하도록 모듈을 쓰지 않음)
(() => {

// ───────────── 상수 ─────────────
const W = 1280, H = 720;
const FLOOR = 560;
const PISTE_L = 100, PISTE_R = 1180;
const START_X = [430, 850];
const WIN_SCORE = 5;
const MIN_GAP = 64;
const TORSO = 80, UPPER = 40, FORE = 40, THIGH = 52, SHIN = 52, SWORD_LEN = 150;
const THRUST_SPEED = 170; // 칼끝이 칼날 방향으로 이 속도(px/s) 이상 나가야 '찌르기'로 인정
const RIG_Y = 128;
const PARRY_WINDOW = 0.35;  // 엄지를 접은 뒤 칼을 막는 자세로 버티며, 닿으면 무조건 튕겨내는 시간
const PARRY_COOLDOWN = 0.9;
const PARRIED_TIME = 0.9;   // 패리 당한 쪽이 득점할 수 없는 시간

const PLAYERS = [
  { name: 'RED', label: 'P1', color: '#ff4d5e', glow: 'rgba(255,77,94,0.85)', soft: 'rgba(255,77,94,0.16)' },
  { name: 'GREEN', label: 'P2', color: '#35e08a', glow: 'rgba(53,224,138,0.85)', soft: 'rgba(53,224,138,0.16)' },
];

const KEYS = [
  { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], thrust: ['KeyF'], lunge: ['KeyG'], parry: ['KeyE'], duck: ['KeyQ'] },
  { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], thrust: ['Period', 'KeyK'], lunge: ['Slash', 'KeyL'], parry: ['Comma', 'KeyJ'], duck: ['ShiftRight', 'KeyI'] },
];

// 마리오네트 줄: 손가락 끝 → 그 손가락이 움직이는 몸 부위
const STRINGS = [
  { tip: 4, part: 'elbow' },  // 엄지 → 칼 든 팔꿈치 (패리)
  { tip: 8, part: 'hand' },   // 검지 → 칼 든 손 (조준·찌르기)
  { tip: 12, part: 'fKnee' }, // 중지 → 앞무릎 (런지)
  { tip: 16, part: 'bKnee' }, // 약지 → 뒷무릎 (런지)
  { tip: 20, part: 'head' },  // 새끼 → 머리 (웅크리기)
];

// ───────────── 수학 ─────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const remap = (v, a, b, c, d) => c + (d - c) * clamp((v - a) / (b - a), 0, 1);
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const len = (a) => Math.hypot(a.x, a.y);
const dirv = (a) => ({ x: Math.cos(a), y: Math.sin(a) });
function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function distToSeg(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return len(sub(p, add(a, mul(ab, t))));
}
function segIntersect(p1, p2, p3, p4) {
  const r = sub(p2, p1), s = sub(p4, p3), den = cross(r, s);
  if (Math.abs(den) < 1e-6) return null;
  const qp = sub(p3, p1);
  const t = cross(qp, s) / den, u = cross(qp, r) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? add(p1, mul(r, t)) : null;
}
// 2관절 IK: 두 해 중 prefer 방향으로 굽은 쪽을 고른다
function ik(a, b, l1, l2, prefer) {
  let d = sub(b, a);
  let dl = len(d);
  const max = l1 + l2 - 0.5;
  if (dl > max) { d = mul(d, max / dl); dl = max; }
  dl = Math.max(dl, 1e-3);
  const base = Math.atan2(d.y, d.x);
  const off = Math.acos(clamp((l1 * l1 + dl * dl - l2 * l2) / (2 * l1 * dl), -1, 1));
  const k1 = add(a, mul(dirv(base + off), l1));
  const k2 = add(a, mul(dirv(base - off), l1));
  const mid = add(a, mul(d, 0.5));
  return dot(sub(k1, mid), prefer) >= dot(sub(k2, mid), prefer) ? k1 : k2;
}

// ───────────── 사운드 ─────────────
class Sfx {
  constructor() { this.ctx = null; }
  ensure() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const n = Math.floor(this.ctx.sampleRate * 0.4);
        this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const ch = this.noise.getChannelData(0);
        for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  }
  env(node, vol, attack, decay, t) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g).connect(this.master);
    return g;
  }
  tone(freq, dur, type = 'sine', vol = 0.2, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    this.env(o, vol, 0.005, dur, t);
    o.start(t); o.stop(t + dur + 0.05);
  }
  clang(power) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 1300 + Math.random() * 600;
    [1, 1.47, 2.09, 2.96].forEach((m, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(base * m, t);
      this.env(o, (0.22 / (i + 1)) * power + 0.01, 0.002, 0.18 + 0.35 / (i + 1), t);
      o.start(t); o.stop(t + 0.7);
    });
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3500;
    src.connect(hp);
    this.env(hp, 0.35 * power + 0.02, 0.001, 0.06, t);
    src.start(t); src.stop(t + 0.1);
  }
  buzz() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    this.env(lp, 0.28, 0.01, 0.75, t);
    for (const f of [196, 199, 392]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.connect(lp);
      o.start(t); o.stop(t + 0.85);
    }
  }
  whoosh() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
    src.connect(bp);
    this.env(bp, 0.12, 0.03, 0.14, t);
    src.start(t); src.stop(t + 0.25);
  }
}

// ───────────── 펜서(졸라맨 마리오네트) ─────────────
class Fencer {
  constructor(id) {
    this.id = id;
    this.side = id === 0 ? 1 : -1;
    this.reset();
  }
  reset() {
    const s = this.side;
    this.x = START_X[this.id];
    this.vx = 0;
    this.crouch = 0;
    this.swordAngle = s > 0 ? -0.15 : Math.PI + 0.15;
    this.armExt = 0.3;
    this.backAngle = s > 0 ? -2.3 : -0.84;
    this.lunge = 0;
    this.knock = 0;
    this.knockVel = 0;
    this.parried = 0;
    this.parryT = 0;
    this.parryCd = 0;
    this.parryDir = 0;
    this.parryOffset = 0;
    this.walkPhase = 0;
    this.walkAmt = 0;
    this.tipPrev = null;
    this.angPrev = this.swordAngle;
    this.tipVel = { x: 0, y: 0 };
    this.relPrev = null;
    this.relVel = { x: 0, y: 0 };
    this.angVel = 0;
    this.trail = [];
    this.wasThrusting = false;
    this.computePose();
  }
  bladeAngle() { return this.swordAngle + this.knock + this.parryOffset; }

  applyInput(inp, dt) {
    const k = (rate) => 1 - Math.exp(-rate * dt);
    const s = this.side;
    this.input = inp;
    const prevX = this.x;
    // 런지·웅크린 상태에서는 발이 무거워진다
    const moveRate = 14 * (1 - 0.6 * this.lunge) * (1 - 0.5 * this.crouch);
    this.x += (inp.x - this.x) * k(moveRate);
    this.vx = dt > 0 ? (this.x - prevX) / dt : 0;
    this.crouch += (inp.crouch - this.crouch) * k(12);
    this.swordAngle += angDiff(this.swordAngle, inp.swordAngle) * k(26);
    this.armExt += (inp.armExt - this.armExt) * k(20);
    this.lunge += (inp.lunge - this.lunge) * k(16);
    // 뒷팔은 자동: 평소엔 뒤로 들고, 런지하면 뒤로 내던진다
    const backTarget = s > 0 ? -2.3 - this.lunge * 1.14 : -0.84 + this.lunge * 1.14;
    this.backAngle += angDiff(this.backAngle, backTarget) * k(10);

    this.parryT = Math.max(0, this.parryT - dt);
    this.parryOffset += ((this.parryT > 0 ? this.parryDir * 0.4 : 0) - this.parryOffset) * k(30);
    this.parryCd = Math.max(0, this.parryCd - dt);

    // 칼이 쳐내졌을 때의 흔들림(스프링)
    this.knockVel += (-90 * this.knock - 12 * this.knockVel) * dt;
    this.knock += this.knockVel * dt;
    this.parried = Math.max(0, this.parried - dt);

    this.walkPhase += this.vx * dt * 0.09;
    this.walkAmt += (Math.min(1, Math.abs(this.vx) / 150) - this.walkAmt) * k(8);
  }

  foot(hip, dx, lift) {
    let fx = this.x + dx;
    const fy = FLOOR - lift;
    const reach = THIGH + SHIN - 2;
    const vy = fy - hip.y;
    const maxDx = Math.sqrt(Math.max(0, reach * reach - vy * vy));
    if (Math.abs(fx - hip.x) > maxDx) fx = hip.x + Math.sign(fx - hip.x) * maxDx;
    return { x: fx, y: fy };
  }

  computePose() {
    const s = this.side, L = this.lunge;
    // 웅크리면 깊게 앉으면서 상체를 살짝 뒤로 빼서 높은 찌르기를 피한다
    const hip = { x: this.x + s * L * 45, y: FLOOR - 100 + this.crouch * 60 + L * 20 * (1 - this.crouch) };
    const lean = s * (0.06 + L * 0.3 - this.crouch * 0.2);
    const td = { x: Math.sin(lean), y: -Math.cos(lean) };
    const shoulder = add(hip, mul(td, TORSO));
    const neck = add(hip, mul(td, TORSO + 10));
    const head = add(hip, mul(td, TORSO + 32));

    const d = dirv(this.bladeAngle());
    const hand = add(shoulder, mul(d, 30 + this.armExt * 48));
    const elbow = ik(shoulder, hand, UPPER, FORE, { x: -s * 0.3, y: 1 });
    const tip = add(hand, mul(d, SWORD_LEN));

    const bHand = add(shoulder, mul(dirv(this.backAngle), 64));
    const bElbow = ik(shoulder, bHand, UPPER, FORE, { x: -s, y: 0.4 });

    const w = this.walkAmt, ph = this.walkPhase;
    const fFoot = this.foot(hip, s * (30 + L * 95) + Math.sin(ph) * 14 * w, Math.max(0, Math.cos(ph)) * 9 * w);
    const bFoot = this.foot(hip, -s * (34 + L * 12) - Math.sin(ph) * 14 * w, Math.max(0, -Math.cos(ph)) * 9 * w);
    const fKnee = ik(hip, fFoot, THIGH, SHIN, { x: s, y: 0 });
    const bKnee = ik(hip, bFoot, THIGH, SHIN, { x: s * 0.6, y: 0 });

    this.pose = { hip, shoulder, neck, head, hand, elbow, tip, bHand, bElbow, fFoot, bFoot, fKnee, bKnee };
  }

  updateKinematics(dt) {
    const tip = this.pose.tip, ang = this.bladeAngle();
    // 찌르기 판정용: 몸 기준 칼끝 위치 (걷기만 해서는 찌르기가 안 되게)
    const rel = { x: tip.x - this.x, y: tip.y };
    if (this.tipPrev && dt > 0) {
      const vx = (tip.x - this.tipPrev.x) / dt, vy = (tip.y - this.tipPrev.y) / dt;
      this.tipVel.x += (vx - this.tipVel.x) * 0.6;
      this.tipVel.y += (vy - this.tipVel.y) * 0.6;
      const rx = (rel.x - this.relPrev.x) / dt, ry = (rel.y - this.relPrev.y) / dt;
      this.relVel.x += (rx - this.relVel.x) * 0.6;
      this.relVel.y += (ry - this.relVel.y) * 0.6;
      this.angVel += (angDiff(this.angPrev, ang) / dt - this.angVel) * 0.6;
    }
    this.tipPrev = { ...tip };
    this.relPrev = rel;
    this.angPrev = ang;
    this.trail.push({ ...tip });
    if (this.trail.length > 8) this.trail.shift();
  }

  // 팔 뻗기(검지)와 런지(중지·약지)로 칼끝이 몸보다 앞으로 나가는 속도
  thrustSpeed() { return dot(this.relVel, dirv(this.bladeAngle())); }
  sweepSpeed() { return Math.abs(cross(dirv(this.bladeAngle()), this.tipVel)); }

  // 에페 규칙: 전신이 유효면
  hitTest(p) {
    const P = this.pose;
    const segs = [
      [P.hip, P.shoulder, 13], [P.head, P.head, 22],
      [P.shoulder, P.elbow, 8], [P.elbow, P.hand, 8],
      [P.shoulder, P.bElbow, 7], [P.bElbow, P.bHand, 7],
      [P.hip, P.fKnee, 8], [P.fKnee, P.fFoot, 8],
      [P.hip, P.bKnee, 8], [P.bKnee, P.bFoot, 8],
    ];
    return segs.some(([a, b, r]) => distToSeg(p, a, b) < r);
  }
}

// ───────────── 상태 ─────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const video = document.getElementById('cam');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const sfx = new Sfx();
const fencers = [new Fencer(0), new Fencer(1)];
const kb = [0, 1].map((i) => ({ x: START_X[i], aim: 0.15, ext: 0.3, lunge: 0, parryHeld: false }));
// 엄지 패리는 '세움 → 접음' 순간에만 한 번 발동한다
const thumbArmed = [false, false];
const keys = new Set();
let tracker = null;
let viewScale = 1;
let particles = [];
let floaters = [];

const game = {
  state: 'title', scores: [0, 0], timer: 0, countdown: 0, phase: -1,
  call: '', sub: '', callColor: '#fff', callTimer: 0,
  lamps: [false, false], flash: 0, flashColor: '#fff', slow: 0,
  pending: null, clashCd: 0, holdStart: 0, winner: -1,
};

function handOf(i) {
  const slot = tracker?.slots[i];
  return slot?.present && slot.controls ? slot.controls : null;
}

function buildInput(i, dt) {
  const s = fencers[i].side;
  const c = handOf(i);
  if (c) {
    let parry = false;
    if (c.thumb > 0.6) thumbArmed[i] = true;
    else if (c.thumb < 0.3 && thumbArmed[i]) { thumbArmed[i] = false; parry = true; }
    return {
      x: i === 0 ? remap(c.px, 0.06, 0.47, PISTE_L + 40, 900) : remap(c.px, 0.53, 0.94, 380, PISTE_R - 40),
      crouch: c.duck,
      swordAngle: c.swordAngle,
      armExt: c.armExt,
      lunge: c.lunge,
      parry,
      thumb: c.thumb,
    };
  }
  const K = KEYS[i], k = kb[i];
  const held = (codes) => codes.some((c2) => keys.has(c2));
  const canMove = game.state !== 'title';
  if (canMove) {
    k.x += ((held(K.right) ? 1 : 0) - (held(K.left) ? 1 : 0)) * 320 * dt;
    k.aim = clamp(k.aim + ((held(K.up) ? 1 : 0) - (held(K.down) ? 1 : 0)) * 2.2 * dt, -1.2, 1.4);
  }
  k.x = clamp(k.x, PISTE_L + 30, PISTE_R - 30);
  k.ext = canMove && held(K.thrust) ? 1 : 0.3;
  k.lunge = canMove && held(K.lunge) ? 1 : 0;
  const parryDown = canMove && held(K.parry);
  const parry = parryDown && !k.parryHeld;
  k.parryHeld = parryDown;
  return {
    x: k.x,
    crouch: canMove && held(K.duck) ? 1 : 0,
    swordAngle: s > 0 ? -k.aim : Math.PI + k.aim,
    armExt: k.ext,
    lunge: k.lunge,
    parry,
    thumb: parryDown ? 0 : 1,
  };
}

function setCall(text, sub = '', color = '#fff', time = 0) {
  game.call = text; game.sub = sub; game.callColor = color; game.callTimer = time;
}

function startMatch() {
  game.scores = [0, 0];
  game.winner = -1;
  enterEngarde();
}

function enterEngarde() {
  game.state = 'engarde';
  game.countdown = 0;
  game.phase = -1;
  game.lamps = [false, false];
  game.pending = null;
  kb.forEach((k, i) => { k.x = START_X[i]; k.aim = 0.15; });
}

// ───────────── 업데이트 ─────────────
function update(dt) {
  const inputs = [buildInput(0, dt), buildInput(1, dt)];
  fencers.forEach((f, i) => f.applyInput(inputs[i], dt));
  fencers.forEach((f, i) => { if (inputs[i].parry) startParry(f, fencers[1 - i]); });

  // 몸끼리 겹치지 않게 + 피스트 밖으로 못 나가게
  const [a, b] = fencers;
  if (b.x - a.x < MIN_GAP) {
    const mid = (a.x + b.x) / 2;
    a.x = mid - MIN_GAP / 2;
    b.x = mid + MIN_GAP / 2;
  }
  fencers.forEach((f) => { f.x = clamp(f.x, PISTE_L + 30, PISTE_R - 30); });
  if (!handOf(0)) kb[0].x = Math.min(kb[0].x, b.x - MIN_GAP + 4);
  if (!handOf(1)) kb[1].x = Math.max(kb[1].x, a.x + MIN_GAP - 4);

  fencers.forEach((f) => {
    f.computePose();
    f.updateKinematics(dt);
    const thrusting = f.thrustSpeed() > THRUST_SPEED * 1.6;
    if (thrusting && !f.wasThrusting && game.state !== 'title') sfx.whoosh();
    f.wasThrusting = thrusting;
  });

  handleClash(dt);

  switch (game.state) {
    case 'engarde': updateEngarde(dt); break;
    case 'fencing': updateFencing(dt); break;
    case 'touch':
      game.timer -= dt;
      if (game.timer <= 0) {
        const best = Math.max(...game.scores);
        if (best >= WIN_SCORE) {
          game.state = 'gameover';
          game.winner = game.scores[0] > game.scores[1] ? 0 : 1;
          game.holdStart = 0;
          sfx.tone(523, 0.2, 'square', 0.12); sfx.tone(659, 0.2, 'square', 0.12, 0.18); sfx.tone(784, 0.45, 'square', 0.12, 0.36);
        } else {
          enterEngarde();
        }
      }
      break;
    case 'gameover': {
      const both = handOf(0)?.open && handOf(1)?.open;
      game.holdStart = both ? game.holdStart + dt : 0;
      if (game.holdStart > 1.5) startMatch();
      break;
    }
  }

  game.callTimer = Math.max(0, game.callTimer - dt);
  game.flash = Math.max(0, game.flash - dt * 2.5);

  particles.forEach((p) => {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += (p.g || 0) * dt;
    p.vx *= 0.97;
  });
  particles = particles.filter((p) => p.life > 0);
  floaters.forEach((t) => { t.life -= dt; t.y -= 30 * dt; });
  floaters = floaters.filter((t) => t.life > 0);
}

function updateEngarde(dt) {
  const ready = fencers[0].x <= START_X[0] + 25 && fencers[1].x >= START_X[1] - 25;
  if (!ready) {
    game.countdown = 0;
    game.phase = -1;
    setCall('En garde!', '두 선수 모두 출발선 뒤로 물러나세요', '#fff');
    return;
  }
  game.countdown += dt;
  const phase = game.countdown < 0.9 ? 0 : game.countdown < 1.8 ? 1 : 2;
  if (phase !== game.phase) {
    game.phase = phase;
    if (phase === 0) { setCall('En garde!', '자세를 잡고', '#fff'); sfx.tone(440, 0.12, 'square', 0.08); }
    if (phase === 1) { setCall('Prêts?', '준비…', '#ffd36b'); sfx.tone(440, 0.12, 'square', 0.08); }
    if (phase === 2) {
      setCall('Allez!', '시작!', '#7ee8ff', 0.9);
      sfx.tone(880, 0.3, 'square', 0.1);
      game.state = 'fencing';
    }
  }
}

function updateFencing(dt) {
  for (let i = 0; i < 2; i++) {
    const atk = fencers[i], def = fencers[1 - i];
    if (atk.parried > 0 || game.pending?.hits.includes(i)) continue;
    if (atk.thrustSpeed() < THRUST_SPEED) continue;
    if (def.hitTest(atk.pose.tip)) {
      if (!game.pending) game.pending = { t: 0.07, hits: [] };
      game.pending.hits.push(i);
      burst(atk.pose.tip, PLAYERS[i].color, 26);
    }
  }
  if (game.pending) {
    game.pending.t -= dt;
    if (game.pending.t <= 0) resolveTouch(game.pending.hits);
  }
}

function resolveTouch(hits) {
  game.pending = null;
  game.state = 'touch';
  game.timer = 2.4;
  game.slow = 0.35;
  game.lamps = [hits.includes(0), hits.includes(1)];
  sfx.buzz();
  if (hits.length === 2) {
    game.flashColor = '#ffffff';
    if (game.scores[0] + 1 >= WIN_SCORE && game.scores[1] + 1 >= WIN_SCORE) {
      setCall('Annulé', '매치 포인트 동시 찌르기는 무효', '#ffd36b');
    } else {
      game.scores[0]++; game.scores[1]++;
      setCall('Coup double!', '동시 찌르기 — 양쪽 모두 1점', '#ffd36b');
    }
  } else {
    const i = hits[0];
    game.scores[i]++;
    game.flashColor = PLAYERS[i].color;
    setCall('Touché!', `${PLAYERS[i].name} 득점`, PLAYERS[i].color);
  }
  game.flash = 1;
}

// 엄지 패리: 상대 칼이 있는 쪽으로 내 칼을 쳐낸다
function startParry(f, opp) {
  if (f.parryCd > 0) return;
  f.parryT = PARRY_WINDOW;
  f.parryCd = PARRY_COOLDOWN;
  const oppMid = mul(add(opp.pose.hand, opp.pose.tip), 0.5);
  const toward = Math.sign(cross(dirv(f.bladeAngle()), sub(oppMid, f.pose.hand))) || -f.side;
  f.parryDir = toward;
  sfx.whoosh();
}

// 패리 중에는 칼이 정확히 교차하지 않아도 이 거리 안이면 막은 것으로 본다
const PARRY_REACH = 36;
function bladeContact(a, b) {
  const [a1, a2, b1, b2] = [a.pose.hand, a.pose.tip, b.pose.hand, b.pose.tip];
  const p = segIntersect(a1, a2, b1, b2);
  if (p) return p;
  if (a.parryT <= 0 && b.parryT <= 0) return null;
  const cands = [[b1, a1, a2], [b2, a1, a2], [a1, b1, b2], [a2, b1, b2]];
  let best = null, bd = PARRY_REACH;
  for (const [q, s1, s2] of cands) {
    const d = distToSeg(q, s1, s2);
    if (d < bd) { bd = d; best = q; }
  }
  return best && { ...best };
}

function handleClash(dt) {
  game.clashCd -= dt;
  const [a, b] = fencers;
  const p = bladeContact(a, b);
  if (!p || game.clashCd > 0) return;
  game.clashCd = 0.16;

  const sa = a.sweepSpeed(), sb = b.sweepSpeed();
  // 엄지 패리 중인 쪽이 있으면 그쪽이 무조건 이긴다. 아니면 더 빨리 휘두른 쪽이 밀어낸다.
  const pa = a.parryT > 0, pb = b.parryT > 0;
  const parry = pa !== pb;
  const winner = parry ? (pa ? a : b) : (sa >= sb ? a : b);
  const loser = winner === a ? b : a;
  const ws = winner === a ? sa : sb, ls = winner === a ? sb : sa;
  const power = parry ? 1 : clamp((sa + sb) / 900, 0.2, 1);
  sfx.clang(power);
  sparks(p, 6 + Math.round(power * 16));

  // 이긴 쪽 칼이 맞닿은 지점에서 움직이던 방향으로 상대 칼을 밀어낸다
  const r = len(sub(p, winner.pose.hand)) / SWORD_LEN;
  const v = mul(winner.tipVel, r);
  const torque = Math.sign(cross(dirv(loser.bladeAngle()), v)) || -loser.side;
  const mag = parry ? 11 : clamp((ws - ls * 0.5) / 90, 1.5, 6);
  loser.knockVel += torque * mag;
  winner.knockVel -= torque * mag * 0.25;
  if (!parry || game.state !== 'fencing') return;
  winner.parryT = 0;
  loser.parried = PARRIED_TIME;
  game.slow = Math.max(game.slow, 0.15);
  floaters.push({ x: p.x, y: p.y - 20, text: 'Parade!', color: PLAYERS[winner.id].color, life: 0.9, max: 0.9 });
}

function sparks(p, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 420;
    particles.push({ type: 'spark', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 600, life: 0.25 + Math.random() * 0.3, max: 0.55, color: '#ffe9a8' });
  }
}
function burst(p, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 300;
    particles.push({ type: 'dot', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 200, life: 0.4 + Math.random() * 0.5, max: 0.9, color, size: 2 + Math.random() * 3 });
  }
  particles.push({ type: 'ring', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.45, max: 0.45, color });
}

// ───────────── 배경(한 번만 그림) ─────────────
const bg = document.createElement('canvas');
function paintBackground() {
  bg.width = W * 2; bg.height = H * 2;
  const g = bg.getContext('2d');
  g.scale(2, 2);

  const wall = g.createLinearGradient(0, 0, 0, FLOOR);
  wall.addColorStop(0, '#07070c');
  wall.addColorStop(1, '#171824');
  g.fillStyle = wall;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.018)';
  for (let x = 0; x < W; x += 36) g.fillRect(x, 0, 18, FLOOR - 40);

  // 무대 바닥
  const floor = g.createLinearGradient(0, FLOOR - 40, 0, H);
  floor.addColorStop(0, '#2c2018');
  floor.addColorStop(1, '#120c08');
  g.fillStyle = floor;
  g.fillRect(0, FLOOR - 40, W, H - FLOOR + 40);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const y = FLOOR - 40 + Math.pow(i / 8, 1.6) * (H - FLOOR + 40);
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }

  // 피스트
  const top = FLOOR - 14, bot = FLOOR + 24;
  const px = (x, y) => { const t = (y - top) / (bot - top); return 640 + (x - 640) * (0.97 + 0.03 * t); };
  const piste = g.createLinearGradient(0, top, 0, bot);
  piste.addColorStop(0, '#5a606e');
  piste.addColorStop(1, '#383c46');
  g.fillStyle = piste;
  g.beginPath();
  g.moveTo(px(PISTE_L, top), top); g.lineTo(px(PISTE_R, top), top);
  g.lineTo(px(PISTE_R, bot), bot); g.lineTo(px(PISTE_L, bot), bot);
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,90,90,0.22)';
  for (const [x0, x1] of [[PISTE_L, PISTE_L + 90], [PISTE_R - 90, PISTE_R]]) {
    g.beginPath();
    g.moveTo(px(x0, top), top); g.lineTo(px(x1, top), top);
    g.lineTo(px(x1, bot), bot); g.lineTo(px(x0, bot), bot);
    g.closePath(); g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 2;
  for (const x of [640, ...START_X, PISTE_L + 4, PISTE_R - 4]) {
    g.beginPath(); g.moveTo(px(x, top), top + 2); g.lineTo(px(x, bot), bot - 2); g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(px(PISTE_L, bot), bot, px(PISTE_R, bot) - px(PISTE_L, bot), 4);

  // 커튼
  for (const [x0, x1, inner] of [[0, 96, 96], [W - 96, W, W - 96]]) {
    const cg = g.createLinearGradient(x0, 0, x1, 0);
    for (let i = 0; i <= 10; i++) cg.addColorStop(i / 10, i % 2 ? '#4d0c15' : '#8a1825');
    g.fillStyle = cg;
    g.fillRect(x0, 0, x1 - x0, H);
    const sh = g.createLinearGradient(inner, 0, inner + (inner < 640 ? -40 : 40), 0);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.fillRect(Math.min(inner, inner + (inner < 640 ? -40 : 40)), 0, 40, H);
  }
  // 상단 가림막(밸런스)
  const vg = g.createLinearGradient(0, 0, 0, 44);
  vg.addColorStop(0, '#5a0e18');
  vg.addColorStop(1, '#8c1a27');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, 34);
  g.beginPath();
  for (let x = 0; x <= W; x += 64) g.arc(x + 32, 34, 32, 0, Math.PI);
  g.fill();
  g.strokeStyle = '#c9a24a';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, 30); g.lineTo(W, 30); g.stroke();
  // 마리오네트 조종대가 매달린 들보
  g.fillStyle = '#2a1c12';
  g.fillRect(96, 62, W - 192, 8);
}

// ───────────── 렌더 ─────────────
function line(a, b, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}
function limb(a, b, c, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
}

function rigPoints(f) {
  const c = handOf(f.id);
  const ox = f.x, oy = RIG_Y;
  if (c) return { hand: true, pts: c.rel.map((p) => ({ x: ox + p.x * 34, y: oy + p.y * 34 })) };
  // 손이 없으면 나무 십자 조종대
  const pts = [];
  pts[4] = { x: ox - f.side * 46, y: oy };
  pts[8] = { x: ox + f.side * 46, y: oy };
  pts[12] = { x: ox, y: oy - 26 };
  pts[16] = { x: ox + f.side * 22, y: oy + 26 };
  pts[20] = { x: ox - f.side * 22, y: oy + 26 };
  return { hand: false, pts, ox, oy };
}

function drawRig(f) {
  const col = PLAYERS[f.id];
  const rig = rigPoints(f);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(225,225,255,0.32)';
  ctx.lineWidth = 1.2;
  for (const s of STRINGS) {
    const a = rig.pts[s.tip], b = f.pose[s.part];
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  // 조종대 → 들보 매달린 줄
  ctx.strokeStyle = 'rgba(200,170,120,0.35)';
  ctx.beginPath(); ctx.moveTo(f.x, 70); ctx.lineTo(f.x, RIG_Y - 30); ctx.stroke();

  if (rig.hand) {
    ctx.strokeStyle = col.color; ctx.lineWidth = 3;
    ctx.shadowColor = col.glow; ctx.shadowBlur = 10;
    for (const [i, j] of HAND_CONNECTIONS) line(rig.pts[i], rig.pts[j], 3, col.color);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    for (const s of STRINGS) {
      const p = rig.pts[s.tip];
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.lineWidth = 7;
    line({ x: rig.ox - 50, y: rig.oy }, { x: rig.ox + 50, y: rig.oy }, 7, '#6b4a2b');
    line({ x: rig.ox, y: rig.oy - 30 }, { x: rig.ox, y: rig.oy + 30 }, 7, '#6b4a2b');
    line({ x: rig.ox - 26, y: rig.oy + 26 }, { x: rig.ox + 26, y: rig.oy + 26 }, 5, '#6b4a2b');
    ctx.fillStyle = col.color;
    ctx.beginPath(); ctx.arc(rig.ox, rig.oy, 4, 0, Math.PI * 2); ctx.fill();
  }
}

function drawSword(f) {
  const P = f.pose, a = f.bladeAngle(), d = dirv(a);
  const col = PLAYERS[f.id];
  const dim = f.parried > 0;
  // 칼끝 잔상
  if (f.thrustSpeed() > THRUST_SPEED && f.trail.length > 2) {
    ctx.strokeStyle = dim ? 'rgba(160,160,160,0.25)' : col.soft.replace('0.16', '0.5');
    ctx.lineWidth = 5;
    ctx.beginPath();
    f.trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  line(add(P.hand, mul(d, -16)), P.hand, 5, '#3a3a40');
  const blade = ctx.createLinearGradient(P.hand.x, P.hand.y, P.tip.x, P.tip.y);
  blade.addColorStop(0, dim ? '#777' : '#e9eef6');
  blade.addColorStop(1, dim ? '#555' : '#9aa6b8');
  ctx.strokeStyle = blade;
  ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(P.hand.x, P.hand.y); ctx.lineTo(P.tip.x, P.tip.y); ctx.stroke();
  // 종 모양 가드
  ctx.save();
  ctx.translate(P.hand.x + d.x * 3, P.hand.y + d.y * 3);
  ctx.rotate(a);
  ctx.fillStyle = dim ? '#666' : '#cfd6e2';
  ctx.strokeStyle = f.parryT > 0 ? '#fff' : col.color;
  ctx.lineWidth = f.parryT > 0 ? 3 : 1.5;
  if (f.parryT > 0) { ctx.shadowColor = col.glow; ctx.shadowBlur = 18; }
  ctx.beginPath(); ctx.ellipse(0, 0, 4, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = col.color;
  ctx.beginPath(); ctx.arc(P.tip.x, P.tip.y, 2.6, 0, Math.PI * 2); ctx.fill();
}

function drawFencer(f) {
  const P = f.pose, col = PLAYERS[f.id], s = f.side;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(P.hip.x, FLOOR + 4, 62, 7, 0, 0, Math.PI * 2); ctx.fill();

  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // 뒤쪽 팔다리는 살짝 어둡게
  limb(P.shoulder, P.bElbow, P.bHand, 6, '#a9adb8');
  limb(P.hip, P.bKnee, P.bFoot, 7, '#b4b8c2');
  line(P.bFoot, add(P.bFoot, { x: s * 12, y: 0 }), 6, '#b4b8c2');

  ctx.shadowColor = col.glow; ctx.shadowBlur = 16;
  line(P.hip, P.shoulder, 9, '#f4f5f8');
  limb(P.hip, P.fKnee, P.fFoot, 7, '#f4f5f8');
  line(P.fFoot, add(P.fFoot, { x: s * 14, y: 0 }), 6, '#f4f5f8');
  line(P.shoulder, P.neck, 6, '#f4f5f8');
  limb(P.shoulder, P.elbow, P.hand, 6, '#f4f5f8');
  ctx.shadowBlur = 0;

  // 마스크
  const h = P.head;
  ctx.fillStyle = '#1d1e26';
  ctx.beginPath(); ctx.arc(h.x, h.y, 20, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(h.x + s * 5, h.y + 1, 14, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  for (let k = -16; k <= 16; k += 4) {
    ctx.beginPath(); ctx.moveTo(h.x + k, h.y - 20); ctx.lineTo(h.x + k, h.y + 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(h.x - 20, h.y + k); ctx.lineTo(h.x + 20, h.y + k); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = col.color; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.arc(h.x, h.y, 20, 0, Math.PI * 2); ctx.stroke();

  drawSword(f);

  if (f.parried > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '700 15px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('칼 튕김!', h.x, h.y - 34);
  }
}

function drawSpot(f) {
  const col = PLAYERS[f.id];
  const g = ctx.createRadialGradient(f.pose.hip.x, FLOOR, 10, f.pose.hip.x, FLOOR - 60, 260);
  g.addColorStop(0, col.soft);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(f.pose.hip.x - 280, FLOOR - 340, 560, 420);
}

function drawScoreboard() {
  const cx = W / 2, y = 44;
  ctx.fillStyle = 'rgba(8,8,14,0.92)';
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 2;
  roundRect(cx - 170, y - 30, 340, 64, 12);
  ctx.fill(); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 2; i++) {
    const col = PLAYERS[i];
    const sx = cx + (i ? 1 : -1) * 62;
    ctx.fillStyle = col.color;
    ctx.font = '40px "Black Han Sans", sans-serif';
    ctx.fillText(String(game.scores[i]), sx, y + 3);
    ctx.font = '700 11px "Noto Sans KR", sans-serif';
    ctx.fillText(`${col.label} ${col.name}`, sx, y - 20);
    // 득점 램프
    const lx = cx + (i ? 1 : -1) * 138;
    const on = game.lamps[i] && (game.state === 'touch' || game.state === 'gameover');
    ctx.fillStyle = on ? col.color : '#26262e';
    if (on) { ctx.shadowColor = col.glow; ctx.shadowBlur = 24; }
    ctx.beginPath(); ctx.arc(lx, y + 2, 14, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = '#c9a24a';
  ctx.font = '700 12px "Noto Sans KR", sans-serif';
  ctx.fillText(`${WIN_SCORE}점 선취`, cx, y - 20);
  ctx.font = '28px "Black Han Sans", sans-serif';
  ctx.fillStyle = '#888';
  ctx.fillText(':', cx, y + 3);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCall() {
  let text = game.call, sub = game.sub, color = game.callColor, alpha = 1;
  if (game.state === 'fencing') {
    if (game.callTimer <= 0) return;
    alpha = Math.min(1, game.callTimer / 0.4);
  } else if (game.state === 'gameover') {
    const col = PLAYERS[game.winner];
    text = `${col.name} 승리!`;
    sub = 'Space 또는 두 선수 모두 손바닥을 활짝 펴고 1.5초 → 재대결';
    color = col.color;
  } else if (game.state === 'title') return;
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '76px "Black Han Sans", sans-serif';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, W / 2, 248);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, 248);
  if (sub) {
    ctx.font = '700 20px "Noto Sans KR", sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeText(sub, W / 2, 304);
    ctx.fillStyle = '#f0f0f0';
    ctx.fillText(sub, W / 2, 304);
  }
  if (game.state === 'gameover' && game.holdStart > 0) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(W / 2, 352, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, game.holdStart / 1.5));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPreview() {
  if (!tracker || video.readyState < 2) return;
  const pw = 208, ph = Math.round(pw / tracker.aspect), px = W / 2 - pw / 2, py = H - ph - 10;
  ctx.save();
  roundRect(px, py, pw, ph, 8);
  ctx.clip();
  ctx.translate(px + pw, py);
  ctx.scale(-1, 1);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(video, 0, 0, pw, ph);
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.setLineDash([4, 4]);
  line({ x: W / 2, y: py }, { x: W / 2, y: py + ph }, 1, 'rgba(255,255,255,0.5)');
  ctx.setLineDash([]);
  tracker.slots.forEach((slot, i) => {
    if (!slot.present) return;
    const map = (p) => ({ x: px + (p.x / tracker.aspect) * pw, y: py + p.y * ph });
    for (const [a, b] of HAND_CONNECTIONS) line(map(slot.smooth[a]), map(slot.smooth[b]), 1.5, PLAYERS[i].color);
  });
  ctx.strokeStyle = 'rgba(201,162,74,0.8)'; ctx.lineWidth = 1.5;
  roundRect(px, py, pw, ph, 8); ctx.stroke();
  ctx.font = '700 11px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'left'; ctx.fillStyle = PLAYERS[0].color; ctx.fillText('P1 영역', px + 6, py + 12);
  ctx.textAlign = 'right'; ctx.fillStyle = PLAYERS[1].color; ctx.fillText('P2 영역', px + pw - 6, py + 12);
}

function drawStatus() {
  ctx.font = '700 13px "Noto Sans KR", sans-serif';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 2; i++) {
    const f = fencers[i], col = PLAYERS[i], hand = !!handOf(i);
    const x0 = i ? W - 112 - 300 : 112, y = H - 100;
    ctx.textAlign = 'left';
    ctx.fillStyle = col.color;
    ctx.font = '700 13px "Noto Sans KR", sans-serif';
    ctx.fillText(`${col.label} ${col.name} · ${hand ? '손 인식 중' : '키보드'}`, x0, y);

    // 손가락별 게이지: [이름, 동작, 채움(0~1), 활성 여부, 키보드 키]
    const ready = f.parryCd <= 0;
    const rows = [
      ['엄지', f.parryT > 0 ? '패리!' : ready ? '접으면 패리' : '패리 충전 중', 1 - f.parryCd / PARRY_COOLDOWN, f.parryT > 0, i ? ', / J' : 'E'],
      ['검지', '찌르기', f.armExt, f.thrustSpeed() > THRUST_SPEED, i ? '. / K' : 'F'],
      ['중지·약지', '런지', f.lunge, f.lunge > 0.6, i ? '/ / L' : 'G'],
      ['새끼', '웅크리기', f.crouch, f.crouch > 0.6, i ? 'R-Shift / I' : 'Q'],
    ];
    rows.forEach(([name, act, v, on, key], r) => {
      const ry = y + 18 + r * 17;
      ctx.font = '700 11px "Noto Sans KR", sans-serif';
      ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.6)';
      ctx.fillText(name, x0, ry);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x0 + 62, ry - 4, 90, 8);
      ctx.fillStyle = on ? '#fff' : col.color;
      ctx.fillRect(x0 + 62, ry - 4, 90 * clamp(v, 0, 1), 8);
      ctx.font = '500 11px "Noto Sans KR", sans-serif';
      ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.6)';
      ctx.fillText(hand ? act : `${act} (${key})`, x0 + 162, ry);
    });
    if (!hand) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(i ? '←→ 이동 · ↑↓ 조준' : 'A/D 이동 · W/S 조준', x0, y + 18 + 4 * 17);
    }
  }
}

function drawParticles() {
  for (const p of particles) {
    const t = p.life / p.max;
    ctx.globalAlpha = Math.max(0, t);
    if (p.type === 'spark') {
      line({ x: p.x, y: p.y }, { x: p.x - p.vx * 0.02, y: p.y - p.vy * 0.02 }, 2, p.color);
    } else if (p.type === 'ring') {
      ctx.strokeStyle = p.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10 + (1 - t) * 60, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const t of floaters) {
    ctx.globalAlpha = Math.min(1, t.life / (t.max * 0.5));
    ctx.font = '22px "Black Han Sans", sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
  ctx.drawImage(bg, 0, 0, W, H);
  fencers.forEach(drawSpot);
  fencers.forEach(drawRig);
  fencers.forEach(drawFencer);
  drawParticles();
  drawScoreboard();
  drawCall();
  drawPreview();
  drawStatus();
  if (game.flash > 0) {
    ctx.globalAlpha = game.flash * 0.25;
    ctx.fillStyle = game.flashColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

// ───────────── 루프 / 입력 / 시작 ─────────────
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = `${Math.floor(W * s)}px`;
  canvas.style.height = `${Math.floor(H * s)}px`;
  canvas.width = Math.floor(W * s * dpr);
  canvas.height = Math.floor(H * s * dpr);
  viewScale = s * dpr;
}

let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (tracker) tracker.update(now);
  game.slow = Math.max(0, game.slow - rdt);
  update(rdt * (game.slow > 0 ? 0.25 : 1));
  render();
  requestAnimationFrame(frame);
}

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'Space' && game.state === 'gameover') startMatch();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('resize', resize);

function begin() {
  overlay.classList.add('hidden');
  canvas.focus();
  startMatch();
}

document.getElementById('btn-cam').addEventListener('click', async (e) => {
  sfx.ensure();
  const btns = overlay.querySelectorAll('button');
  btns.forEach((b) => { b.disabled = true; });
  try {
    const t = new HandTracker(video);
    await t.init((msg) => { statusEl.textContent = msg; });
    tracker = t;
    begin();
  } catch (err) {
    console.error(err);
    statusEl.textContent = `카메라/손 인식을 시작하지 못했어요: ${err.message || err}. 로컬 서버(README 참고)로 열었는지, 카메라 권한을 허용했는지 확인하세요.`;
    btns.forEach((b) => { b.disabled = false; });
  }
});
document.getElementById('btn-kb').addEventListener('click', () => {
  sfx.ensure();
  begin();
});

paintBackground();
resize();
document.fonts?.load('40px "Black Han Sans"').catch(() => {});
requestAnimationFrame(frame);
})();
