// 손끝 클라이밍 — tracker.js(전역 HandTracker)를 먼저 불러온 뒤 실행된다.
// 월드 단위는 미터, y는 위쪽이 +. 몸 위치는 골반 기준이다.
(() => {

// ───────────── 상수 ─────────────
const W = 1280, H = 720;
const PX = 80;                 // 1m = 80px
const WALL = 5;                // 벽 x 범위 ±
const TOP = 60;                // 정상 높이
const REACH = 1.15;            // 어깨에서 손까지 최대 거리
const SHOULDER = { dx: 0.22, dy: 0.45 };
const LEG = 0.95;              // 골반~발
const GRAB_R = 0.38;           // 손이 홀드에 이만큼 가까우면 잡힌다
const GRAVITY = 14;
const BODY_SPEED = 4;
const STAMINA_MAX = 100;
const GEM_COUNT_TARGET = 15;

const ZONES = [
  { y: 0, name: '출발 바위', tip: '✊ 주먹을 쥐면 잡고, 잡은 채 손을 아래로 내리면 몸이 올라가요. 🖐 손을 펴면 놓아요.' },
  { y: 10, name: '작은 홀드 구간', tip: '👌 노란 작은 홀드는 OK 손 모양으로만 잡혀요!' },
  { y: 20, name: '무너지는 절벽', tip: '금 간 홀드는 잡고 1.4초 뒤 무너져요. ▼ 표시가 뜨면 낙석을 피하세요!' },
  { y: 30, name: '폭포 벽', tip: '💧 젖은 홀드는 팔 힘이 두 배 넘게 빠져요. 보라 홀드는 좌우로 움직여요.' },
  { y: 40, name: '바람 능선', tip: '💨 돌풍이 불 땐 두 손으로 잡고 버티세요! 🌵 붉은 가시 홀드는 피하세요.' },
  { y: 50, name: '다이노 갭', tip: '🚀 손이 안 닿는 간격은 두 손으로 잡은 상태에서 손을 확 펴며 위로 뻗어 점프!' },
];
const zoneAt = (y) => { let z = 0; ZONES.forEach((zz, i) => { if (y >= zz.y) z = i; }); return z; };

const HOLD_STYLE = {
  jug: { color: '#a8673a', light: '#d99a63', r: 0.2, needs: 'fist' },
  crimp: { color: '#f2c230', light: '#ffe37a', r: 0.12, needs: 'pinch' },
  crumble: { color: '#8f8a84', light: '#c4beb6', r: 0.2, needs: 'fist' },
  wet: { color: '#3d8fd6', light: '#8fd0ff', r: 0.2, needs: 'fist' },
  move: { color: '#8a55d6', light: '#c6a2ff', r: 0.2, needs: 'fist' },
  spike: { color: '#d63b3b', light: '#ff8a8a', r: 0.2, needs: 'fist' },
};

// ───────────── 유틸 ─────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const hyp = (x, y) => Math.hypot(x, y);
let seed = 1;
const srand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const srange = (a, b) => a + srand() * (b - a);

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
    this.env(f, vol, 0.003, d, t);
    s.start(t, Math.random() * 0.5); s.stop(t + d + 0.05);
  },
  grab() { this.noiseHit(900, 0.06, 0.25, 'bandpass', 2); this.tone(180, 0.06, 'sine', 0.15); },
  release() { this.noiseHit(1600, 0.04, 0.08); },
  crack() { this.noiseHit(500, 0.25, 0.3, 'bandpass', 3); },
  crumble() { this.noiseHit(250, 0.5, 0.4, 'lowpass'); },
  ouch() { this.tone(500, 0.18, 'square', 0.08, 0, 250); },
  fall() { this.tone(700, 0.9, 'triangle', 0.12, 0, 120); },
  rock() { this.noiseHit(150, 0.4, 0.5, 'lowpass'); },
  warn() { this.tone(880, 0.1, 'square', 0.06); this.tone(880, 0.1, 'square', 0.06, 0.18); },
  wind() { this.noiseHit(600, 1.8, 0.18, 'bandpass', 0.6); },
  gem() { this.tone(1320, 0.12, 'triangle', 0.15); this.tone(1760, 0.18, 'triangle', 0.12, 0.08); },
  checkpoint() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.14, i * 0.1)); },
  dyno() { this.tone(300, 0.3, 'sawtooth', 0.08, 0, 900); },
  tired() { this.tone(200, 0.3, 'sine', 0.12, 0, 140); },
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.15, i * 0.13)); },
};

// ───────────── 코스 생성 ─────────────
// 각 구간마다 '반드시 오를 수 있는 길'을 먼저 깔고, 그 주변에 함정과 여분 홀드를 뿌린다.
function buildCourse() {
  seed = 20261020;
  const holds = [], ledges = [], gems = [];
  const add = (type, x, y, extra = {}) => {
    const h = { type, x, y, bx: x, ...HOLD_STYLE[type], broken: false, crack: 0, respawnT: 0, phase: srand() * 6, ...extra };
    holds.push(h);
    return h;
  };
  // 체크포인트 렛지
  const ledgeYs = [10, 20, 30, 40, 50, TOP];
  for (const y of ledgeYs) ledges.push({ x0: -1.6, x1: 1.6, y, reached: false, top: y === TOP });

  let x = 0;
  const pathType = (zone, k) => {
    switch (zone) {
      case 0: return 'jug';
      case 1: return k % 2 ? 'crimp' : (srand() < 0.5 ? 'crimp' : 'jug');
      case 2: return srand() < 0.75 ? 'crumble' : 'jug';
      case 3: return srand() < 0.4 ? 'wet' : (srand() < 0.45 ? 'move' : 'jug');
      case 4: return srand() < 0.35 ? 'crimp' : 'jug';
      default: return 'jug';
    }
  };
  for (let zone = 0; zone < 6; zone++) {
    const y0 = zone * 10, y1 = y0 + 10;
    let y = zone === 0 ? 1.9 : y0 + 1.05;
    let k = 0;
    // 다이노 구간은 가운데에 손이 닿지 않는 간격을 하나 둔다 (앞뒤로는 일반 홀드)
    const gaps = zone === 5 ? [y0 + 4] : [];
    while (y < y1 - 0.6) {
      const type = pathType(zone, k);
      x = clamp(x + srange(-0.85, 0.85), -3.2, 3.2);
      const h = add(type, x, y);
      if (type === 'move') { h.amp = srange(0.8, 1.2); h.speed = srange(0.6, 0.9); }
      // 잡기 편하게 같은 높이에 하나 더 두는 경우
      if (zone !== 1 && srand() < 0.35) add(zone === 3 ? 'wet' : zone === 2 ? 'crumble' : 'jug', clamp(x + (srand() < 0.5 ? -0.6 : 0.6), -3.6, 3.6), y + srange(-0.1, 0.15));
      // 함정·여분 홀드
      if (zone === 4 && srand() < 0.6) add('spike', clamp(x + (srand() < 0.5 ? -1.5 : 1.5), -4.2, 4.2), y + srange(-0.3, 0.4));
      if (srand() < 0.25) add(zone === 4 ? 'spike' : 'jug', clamp(x + (srand() < 0.5 ? -2.2 : 2.2), -4.4, 4.4), y + srange(-0.2, 0.3));
      if (srand() < 0.45) gems.push({ x: clamp(x + srange(-1.4, 1.4), -4, 4), y: y + srange(0.3, 0.7), taken: false });
      let step = srange(0.85, 1.15);
      for (const g of gaps) {
        if (y < g && y + step >= g) {
          // 간격 바로 아래는 두 손으로 잡을 수 있는 큰 홀드 두 개
          add('jug', x + 0.45, y + 0.02);
          step = 3.0;
          gems.push({ x, y: y + 1.9, taken: false });
        }
      }
      y += step;
      k++;
    }
    // 렛지 위로 올라서는 손잡이
    add('jug', -0.9, y1 - 0.05);
    add('jug', 0.9, y1 - 0.05);
    x = clamp(x, -1.2, 1.2);
  }
  return { holds, ledges, gems };
}

// ───────────── 상태 ─────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const video = document.getElementById('cam');
const $ = (id) => document.getElementById(id);
let viewScale = 1;
let tracker = null;
let course = buildCourse();

const makeHand = (i) => ({
  i, x: 0, y: 0, rx: i ? 0.3 : -0.3, ry: 0.6, hold: null, shape: 'open', lockClosed: false,
  wrongT: 0, ouchT: 0, rvx: 0, rvy: 0,
});
const P = {
  x: 0, y: LEG, vx: 0, vy: 0, supported: true, stamina: STAMINA_MAX, exhausted: false, stunT: 0,
  hands: [makeHand(0), makeHand(1)], checkpoint: { x: 0, y: 0 }, falls: 0, gems: 0, maxY: 0,
};
const game = {
  screen: 'title', mode: 'mouse', time: 0, clock: 0, camY: 4, zone: -1, zoneBanner: 0,
  rocks: [], gusts: null, rockT: 4, gustT: 6, particles: [], floaters: [], shake: 0, fade: 0,
  finished: false, input: [{ px: 0.4, py: 0.5, shape: 'open', present: true }, { px: 0.6, py: 0.5, shape: 'open', present: true }],
  dynoLock: 0,
};
const mouse = { x: W / 2, y: H / 2, left: false, right: false, shift: false };

// 카메라 프레임 좌표(0~1) → 골반 기준 손 위치(m)
function frameToRel(px, py) {
  return { x: (px - 0.5) * 3.2, y: (0.62 - py) * 2.8 };
}
const shoulderOf = (i) => ({ x: P.x + (i ? SHOULDER.dx : -SHOULDER.dx), y: P.y + SHOULDER.dy });

function resetRun() {
  course = buildCourse();
  Object.assign(P, { x: 0, y: LEG, vx: 0, vy: 0, supported: true, stamina: STAMINA_MAX, exhausted: false, stunT: 0, falls: 0, gems: 0, maxY: 0, checkpoint: { x: 0, y: 0 } });
  P.hands = [makeHand(0), makeHand(1)];
  P.hands.forEach((h) => { const s = shoulderOf(h.i); h.x = s.x + h.rx * 0.3; h.y = s.y; });
  Object.assign(game, { time: 0, camY: 4, zone: -1, rocks: [], gusts: null, rockT: 4, gustT: 6, particles: [], floaters: [], finished: false, fade: 0 });
}

// ───────────── 입력 ─────────────
function readInputs(dt) {
  if (game.mode === 'camera' && tracker) {
    tracker.update(performance.now());
    tracker.slots.forEach((s, i) => {
      game.input[i].present = s.present;
      if (s.present) { game.input[i].px = s.x; game.input[i].py = s.y; }
      game.input[i].shape = s.shape;
    });
  } else if (game.mode === 'mouse') {
    // 마우스 하나로 두 손을 함께 움직이고, 왼쪽/오른쪽 버튼으로 각 손을 쥔다 (Shift를 누르면 OK 모양)
    const px = mouse.x / W, py = mouse.y / H;
    const shapeOf = (down) => (down ? (mouse.shift ? 'pinch' : 'fist') : 'open');
    game.input[0] = { px: px - 0.09, py, shape: shapeOf(mouse.left), present: true };
    game.input[1] = { px: px + 0.09, py, shape: shapeOf(mouse.right), present: true };
  }
  // game.mode === 'bot' 이면 디버그 훅이 game.input을 직접 채운다
  for (const h of P.hands) {
    const inp = game.input[h.i];
    const rel = frameToRel(inp.px, inp.py);
    h.rvx = (rel.x - h.rx) / Math.max(dt, 1e-3);
    h.rvy = (rel.y - h.ry) / Math.max(dt, 1e-3);
    h.rx = rel.x; h.ry = rel.y;
    h.shape = inp.shape;
  }
}

// ───────────── 업데이트 ─────────────
function holdPos(h) {
  if (h.type === 'move') return { x: h.bx + Math.sin(game.time * h.speed * 2 + h.phase) * h.amp, y: h.y };
  return { x: h.x, y: h.y };
}

function grabbable(h) { return !h.broken; }

function tryGrab(hand) {
  // 쥔 손이 홀드에 닿으면 잡는다. 사고로 놓친 손은 한 번 폈다가 다시 쥐어야 잡힌다.
  if (hand.hold || hand.shape === 'open' || P.stunT > 0 || P.exhausted) return;
  let best = null, bd = GRAB_R;
  for (const h of course.holds) {
    if (!grabbable(h)) continue;
    const p = holdPos(h);
    const d = hyp(p.x - hand.x, p.y - hand.y) - h.r * 0.5;
    if (d < bd) { bd = d; best = h; }
  }
  if (!best) return;
  if (hand.lockClosed) {
    if (hand.wrongT <= 0) { floater('🖐 폈다가 다시 쥐기!', hand.x, hand.y + 0.4, '#ffe08a'); hand.wrongT = 1.2; }
    return;
  }
  if (best.needs !== hand.shape) {
    if (hand.wrongT <= 0) {
      floater(best.needs === 'pinch' ? '👌 OK 모양으로!' : '✊ 주먹으로!', best.x, best.y + 0.4, '#ffe08a');
      hand.wrongT = 0.8;
    }
    return;
  }
  if (best.type === 'spike') {
    P.stamina = Math.max(0, P.stamina - 25);
    hand.ouchT = 0.6;
    hand.lockClosed = true;
    floater('아야! 가시!', best.x, best.y + 0.4, '#ff7a7a');
    sfx.ouch();
    game.shake = 0.3;
    return;
  }
  hand.hold = best;
  best.gripT = 0;
  sfx.grab();
  chalk(hand.x, hand.y);
}

function releaseHand(hand, reason, forced = false) {
  if (!hand.hold) return;
  hand.hold = null;
  if (forced) hand.lockClosed = true;
  if (reason) floater(reason, hand.x, hand.y + 0.3, '#ffb0b0');
  sfx.release();
}

function update(dt) {
  game.time += dt;
  if (!game.finished) game.clock += dt;
  readInputs(dt);

  P.stunT = Math.max(0, P.stunT - dt);
  game.dynoLock = Math.max(0, game.dynoLock - dt);
  for (const hand of P.hands) {
    if (hand.shape === 'open') hand.lockClosed = false;
    hand.wrongT = Math.max(0, hand.wrongT - dt);
    hand.ouchT = Math.max(0, hand.ouchT - dt);
    // 손 모양이 홀드에 맞지 않으면 놓친다 (손을 펴면 놓는다)
    if (hand.hold && hand.shape !== hand.hold.needs) { releaseHand(hand); hand.letGoAt = game.time; }
  }
  checkDyno();

  updateHolds(dt);
  updateHazards(dt);
  updateBody(dt);
  for (const hand of P.hands) tryGrab(hand);
  updateStamina(dt);
  collect();
  checkCheckpoints();
  updateEffects(dt);

  // 카메라
  game.camY += (P.y + 0.5 - game.camY) * damp(8, dt);
  game.shake = Math.max(0, game.shake - dt * 2);
  game.fade = Math.max(0, game.fade - dt * 1.5);
  const z = zoneAt(P.y);
  if (z !== game.zone) {
    if (z > game.zone) { game.zoneBanner = 3; $('zone-tip').textContent = ZONES[z].tip; }
    game.zone = z;
  }
  game.zoneBanner = Math.max(0, game.zoneBanner - dt);
  P.maxY = Math.max(P.maxY, P.y - LEG);
}

// 다이노: 두 손으로 잡고 있다가 거의 동시에 손을 펴면서 위로 뻗으면 튀어 오른다
function checkDyno() {
  const [a, b] = P.hands;
  if (game.dynoLock > 0) return;
  // 공중에서 두 손으로 매달려 있다가 직접 손을 펴서 놓았을 때만 (렛지에 올라선 뒤 손을 펴는 건 제외)
  const letGo = (h) => h.letGoAt !== undefined && game.time - h.letGoAt < 0.25;
  if (P.supported || !letGo(a) || !letGo(b)) return;
  if (!P.lastTwoGripT || game.time - P.lastTwoGripT > 0.3) return;
  const up = (a.rvy + b.rvy) / 2;
  if (up < 1.2 && !P.forceDyno) return;
  P.forceDyno = false;
  P.vy = clamp(3.5 + up * 0.6, 6, 8.2);
  P.vx = clamp((a.rvx + b.rvx) / 4, -2, 2);
  P.supported = false;
  game.dynoLock = 0.8;
  floater('다이노!', P.x, P.y + 1.2, '#7ee8ff');
  sfx.dyno();
}

function updateHolds(dt) {
  for (const h of course.holds) {
    if (h.broken) {
      h.respawnT -= dt;
      if (h.respawnT <= 0) { h.broken = false; h.crack = 0; }
      continue;
    }
    const held = P.hands.some((hand) => hand.hold === h);
    if (h.type === 'crumble' && held) {
      h.gripT += dt;
      const before = h.crack;
      h.crack = h.gripT / 1.4;
      if (before < 0.5 && h.crack >= 0.5) sfx.crack();
      if (h.crack >= 1) {
        h.broken = true;
        h.respawnT = 5;
        for (const hand of P.hands) if (hand.hold === h) releaseHand(hand, '와르르!', true);
        sfx.crumble();
        const p = holdPos(h);
        for (let k = 0; k < 10; k++) game.particles.push({ x: p.x, y: p.y, vx: srange(-1.5, 1.5), vy: srange(0, 2), life: 1.2, color: '#8f8a84', size: 0.08, g: 12 });
      }
    } else if (h.type === 'crumble' && h.crack > 0 && !held) {
      h.crack = Math.max(0, h.crack - dt * 0.2);
      h.gripT = h.crack * 1.4;
    }
  }
}

function supportUnder(x, feetY, prevFeetY) {
  if (prevFeetY >= 0 && feetY <= 0) return 0;
  for (const l of course.ledges) {
    if (x >= l.x0 - 0.2 && x <= l.x1 + 0.2 && prevFeetY >= l.y - 0.05 && feetY <= l.y) return l.y;
  }
  return null;
}
function standingOn(x, feetY) {
  if (Math.abs(feetY) < 0.02) return 0;
  for (const l of course.ledges) if (x >= l.x0 - 0.2 && x <= l.x1 + 0.2 && Math.abs(feetY - l.y) < 0.02) return l.y;
  return null;
}

function updateBody(dt) {
  const grips = P.hands.filter((h) => h.hold);
  if (grips.length === 2) P.lastTwoGripT = game.time;
  const prevFeet = P.y - LEG;

  if (grips.length) {
    // 잡은 손은 홀드에 고정되고, 카메라 속 손의 움직임만큼 몸이 반대로 움직인다 (손을 내리면 몸이 올라간다)
    let dx = 0, dy = 0;
    for (const h of grips) {
      const p = holdPos(h.hold);
      dx += p.x - h.rx; dy += p.y - h.ry;
    }
    let tx = dx / grips.length, ty = dy / grips.length;
    // 팔 길이 제약: 잡은 홀드에서 어깨까지 REACH 이내
    for (let it = 0; it < 4; it++) {
      for (const h of grips) {
        const p = holdPos(h.hold);
        const sx = tx + (h.i ? SHOULDER.dx : -SHOULDER.dx), sy = ty + SHOULDER.dy;
        const ddx = sx - p.x, ddy = sy - p.y, l = hyp(ddx, ddy);
        if (l > REACH) { tx -= ddx * (1 - REACH / l); ty -= ddy * (1 - REACH / l); }
      }
    }
    // 돌풍에 한 손으로 매달리면 몸이 흔들린다
    if (game.gusts?.active && grips.length === 1) tx += game.gusts.dir * 0.35 * Math.sin(game.time * 9);
    const mx = tx - P.x, my = ty - P.y, ml = hyp(mx, my);
    const step = Math.min(ml * damp(12, dt), BODY_SPEED * dt);
    const nx = ml > 1e-5 ? P.x + (mx / ml) * step : P.x;
    let ny = ml > 1e-5 ? P.y + (my / ml) * step : P.y;
    // 발밑 바닥이나 렛지 아래로 파고들지 않는다
    const floor = standingOn(P.x, prevFeet);
    if (floor !== null && ny - LEG < floor) ny = floor + LEG;
    if (ny - LEG < 0) ny = LEG;
    P.vx = (nx - P.x) / dt; P.vy = (ny - P.y) / dt;
    P.x = nx; P.y = ny;
    P.supported = standingOn(P.x, P.y - LEG) !== null;
    // 렛지 가장자리까지 몸을 끌어올리면 자동으로 올라선다 (팔 길이만으로는 발이 렛지 위로 못 가므로)
    for (const l of course.ledges) {
      const feet = P.y - LEG;
      if (P.vy > 0 && feet > l.y - 0.8 && feet < l.y && P.x > l.x0 - 0.4 && P.x < l.x1 + 0.4) {
        P.y = l.y + LEG; P.vy = 0; P.supported = true;
        P.hands.forEach((h) => { h.hold = null; h.lockClosed = true; });
        floater('영차!', P.x, P.y + 1.2, '#ffffff');
        dust(P.x, l.y);
        break;
      }
    }
  } else if (P.supported && standingOn(P.x, P.y - LEG) !== null) {
    P.vx = 0; P.vy = 0;
  } else {
    P.supported = false;
    P.vy = Math.max(P.vy - GRAVITY * dt, -18);
    if (game.gusts?.active) P.vx += game.gusts.dir * 4 * dt;
    P.vx *= 1 - damp(1.5, dt);
    P.x += P.vx * dt;
    P.y += P.vy * dt;
    const land = P.vy <= 0 ? supportUnder(P.x, P.y - LEG, prevFeet) : null;
    if (land !== null) {
      P.y = land + LEG; P.vy = 0; P.vx = 0; P.supported = true;
      dust(P.x, land);
    }
    // 체크포인트보다 한참 아래로 떨어지면 체크포인트로 돌아간다
    if (P.y - LEG < P.checkpoint.y - 5) respawn();
  }
  P.x = clamp(P.x, -WALL + 0.5, WALL - 0.5);

  // 손 위치: 잡은 손은 홀드, 아닌 손은 카메라 속 손 위치(팔 길이 안)
  for (const hand of P.hands) {
    if (hand.hold) { const p = holdPos(hand.hold); hand.x = p.x; hand.y = p.y; continue; }
    const s = shoulderOf(hand.i);
    let tx = P.x + hand.rx, ty = P.y + hand.ry;
    const dx = tx - s.x, dy = ty - s.y, l = hyp(dx, dy);
    if (l > REACH) { tx = s.x + dx * REACH / l; ty = s.y + dy * REACH / l; }
    hand.x += (tx - hand.x) * damp(20, 1 / 60);
    hand.y += (ty - hand.y) * damp(20, 1 / 60);
  }
}

function respawn() {
  P.falls++;
  sfx.fall();
  const c = P.checkpoint;
  P.x = c.x; P.y = c.y + LEG; P.vx = 0; P.vy = 0; P.supported = true;
  P.stamina = STAMINA_MAX; P.exhausted = false; P.stunT = 0;
  P.hands.forEach((h) => { h.hold = null; h.lockClosed = true; });
  game.rocks = [];
  game.fade = 1;
  floater('체크포인트로!', P.x, P.y + 1.4, '#ffffff');
}

function updateStamina(dt) {
  const grips = P.hands.filter((h) => h.hold);
  if (P.supported) {
    P.stamina = Math.min(STAMINA_MAX, P.stamina + 40 * dt);
    if (P.stamina > 30) P.exhausted = false;
    return;
  }
  if (!grips.length) return;
  let drain = grips.length === 1 ? 8 : 3.5;
  for (const h of grips) {
    if (h.hold.type === 'wet') drain += grips.length === 1 ? 10 : 4;
    if (h.hold.type === 'crimp') drain += 2;
  }
  if (game.gusts?.active && grips.length === 1) drain *= 2;
  P.stamina = Math.max(0, P.stamina - drain * dt);
  if (P.stamina <= 0) {
    P.exhausted = true;
    for (const h of P.hands) releaseHand(h, null, true);
    floater('팔 힘이 다 빠졌다!', P.x, P.y + 1.4, '#ff9a9a');
    sfx.tired();
  }
}

function updateHazards(dt) {
  // 낙석: 무너지는 절벽 구간
  if (zoneAt(P.y) === 2 && !P.supported) {
    game.rockT -= dt;
    if (game.rockT <= 0) {
      game.rockT = srange(3.5, 5);
      game.rocks.push({ x: clamp(P.x + srange(-0.8, 0.8), -4.5, 4.5), y: P.y + 7, warn: 1.4, vy: 0, r: 0.35 });
      sfx.warn();
    }
  }
  for (const r of game.rocks) {
    if (r.warn > 0) { r.warn -= dt; r.y = P.y + 6.5; continue; }
    r.vy = Math.max(r.vy - 18 * dt, -14);
    r.y += r.vy * dt;
    const hitBody = hyp(r.x - P.x, r.y - (P.y + 0.5)) < r.r + 0.45;
    const hitHand = P.hands.some((h) => h.hold && hyp(r.x - h.x, r.y - h.y) < r.r + 0.2);
    if (!r.hit && (hitBody || hitHand)) {
      r.hit = true;
      P.hands.forEach((h) => releaseHand(h, null, true));
      P.stunT = 0.6;
      P.vx = (P.x - r.x) * 3;
      floater('쿵! 낙석!', P.x, P.y + 1.3, '#ffb0b0');
      sfx.rock();
      game.shake = 0.6;
    }
    if (r.y < P.y - 8) r.dead = true;
  }
  game.rocks = game.rocks.filter((r) => !r.dead);

  // 돌풍: 바람 능선 구간
  if (zoneAt(P.y) === 4 && !P.supported) {
    if (!game.gusts) {
      game.gustT -= dt;
      if (game.gustT <= 0) {
        game.gusts = { dir: Math.random() < 0.5 ? -1 : 1, warn: 1.3, t: 0, dur: 2.2, active: false, slipT: 0 };
        sfx.warn();
      }
    }
  }
  const g = game.gusts;
  if (g) {
    if (g.warn > 0) {
      g.warn -= dt;
      if (g.warn <= 0) { g.active = true; sfx.wind(); }
    } else {
      g.t += dt;
      const grips = P.hands.filter((h) => h.hold).length;
      if (grips === 1) {
        g.slipT += dt;
        if (g.slipT > 0.8) { P.hands.forEach((h) => releaseHand(h, '바람에 날렸다!', true)); g.slipT = -99; }
      }
      if (g.t >= g.dur) {
        if (grips === 2 && g.slipT >= 0) floater('버텼다!', P.x, P.y + 1.4, '#bdf5a5');
        game.gusts = null;
        game.gustT = srange(5, 7);
      }
    }
    if (game.gusts) {
      for (let k = 0; k < 2; k++) game.particles.push({ x: g.dir > 0 ? -WALL : WALL, y: game.camY + srange(-4, 4), vx: g.dir * srange(8, 14) * (g.active ? 1 : 0.4), vy: 0, life: 1, color: 'rgba(255,255,255,0.7)', streak: true, g: 0 });
    }
  }
}

function collect() {
  for (const g of course.gems) {
    if (g.taken) continue;
    const near = hyp(g.x - P.x, g.y - (P.y + 0.4)) < 0.6 || P.hands.some((h) => hyp(g.x - h.x, g.y - h.y) < 0.4);
    if (near) {
      g.taken = true;
      P.gems++;
      sfx.gem();
      for (let k = 0; k < 8; k++) game.particles.push({ x: g.x, y: g.y, vx: srange(-2, 2), vy: srange(-1, 2.5), life: 0.6, color: '#7ef0ff', size: 0.06, g: 4 });
    }
  }
}

function checkCheckpoints() {
  if (!P.supported) return;
  const feet = P.y - LEG;
  for (const l of course.ledges) {
    if (Math.abs(feet - l.y) < 0.05 && !l.reached) {
      l.reached = true;
      P.checkpoint = { x: clamp(P.x, l.x0, l.x1), y: l.y };
      sfx.checkpoint();
      floater(l.top ? '정상!' : `체크포인트 ${l.y}m`, P.x, P.y + 1.5, '#bdf5a5');
      if (l.top) finish();
    }
  }
}

function finish() {
  game.finished = true;
  sfx.win();
  const gems = P.gems;
  const score = Math.max(0, Math.round(10000 - game.clock * 20 - P.falls * 300 + gems * 200));
  const rank = score >= 8000 ? 'S' : score >= 6500 ? 'A' : score >= 5000 ? 'B' : 'C';
  let best = null;
  try { best = JSON.parse(localStorage.getItem('fingertip_climb_best')); } catch { /* 저장소 없음 */ }
  const isBest = !best || score > best.score;
  if (isBest) { try { localStorage.setItem('fingertip_climb_best', JSON.stringify({ score, time: game.clock, falls: P.falls, gems })); } catch { /* 무시 */ } }
  setTimeout(() => showResult({ score, rank, time: game.clock, falls: P.falls, gems, isBest, best }), 1600);
}

// ───────────── 효과 ─────────────
function floater(text, x, y, color) { game.floaters.push({ text, x, y, color, life: 1.3 }); }
function chalk(x, y) { for (let k = 0; k < 5; k++) game.particles.push({ x, y, vx: srange(-0.8, 0.8), vy: srange(-0.5, 0.8), life: 0.5, color: 'rgba(255,255,255,0.8)', size: 0.05, g: 2 }); }
function dust(x, y) { for (let k = 0; k < 8; k++) game.particles.push({ x: x + srange(-0.4, 0.4), y, vx: srange(-1.5, 1.5), vy: srange(0.2, 1), life: 0.6, color: 'rgba(210,190,160,0.8)', size: 0.09, g: 3 }); }
function updateEffects(dt) {
  for (const p of game.particles) { p.life -= dt; p.vy -= (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  game.particles = game.particles.filter((p) => p.life > 0).slice(-400);
  for (const f of game.floaters) { f.life -= dt; f.y += 0.6 * dt; }
  game.floaters = game.floaters.filter((f) => f.life > 0);
}

// ───────────── 렌더 ─────────────
const sx = (x) => W / 2 + x * PX;
const sy = (y) => H / 2 - (y - game.camY) * PX;

function skyColor(h) {
  const stops = [[0, [150, 210, 255]], [25, [170, 200, 250]], [45, [255, 196, 150]], [60, [255, 140, 120]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [y0, c0] = stops[i], [y1, c1] = stops[i + 1];
    if (h <= y1) { const t = clamp((h - y0) / (y1 - y0), 0, 1); return c0.map((v, k) => Math.round(lerp(v, c1[k], t))); }
  }
  return stops[stops.length - 1][1];
}

function drawBackground() {
  const top = skyColor(game.camY + 5), bot = skyColor(game.camY - 5);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgb(${top})`);
  g.addColorStop(1, `rgb(${bot})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 먼 산 (느린 시차)
  for (const [layer, color, amp, base] of [[0.15, 'rgba(120,140,190,0.45)', 90, 0.75], [0.3, 'rgba(90,110,150,0.55)', 70, 0.85]]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    const off = game.camY * PX * layer;
    for (let x = 0; x <= W; x += 40) {
      const n = Math.sin(x * 0.011 + layer * 9) * 0.6 + Math.sin(x * 0.027 + layer * 3) * 0.4;
      ctx.lineTo(x, H * base + off - n * amp);
    }
    ctx.lineTo(W, H);
    ctx.fill();
  }
}

function drawWall() {
  const x0 = sx(-WALL), x1 = sx(WALL);
  const wg = ctx.createLinearGradient(x0, 0, x1, 0);
  wg.addColorStop(0, '#6e5a4a'); wg.addColorStop(0.08, '#9a8371'); wg.addColorStop(0.5, '#a89280'); wg.addColorStop(0.92, '#9a8371'); wg.addColorStop(1, '#6e5a4a');
  ctx.fillStyle = wg;
  const yTop = Math.min(sy(TOP + 0.2), H), yBot = Math.max(sy(-1), 0);
  ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
  // 바위 무늬 (1m 줄마다 같은 무늬가 나오게 줄 번호로 시드)
  const yMin = Math.floor(game.camY - 6), yMax = Math.ceil(game.camY + 6);
  for (let row = Math.max(-1, yMin); row <= Math.min(TOP, yMax); row++) {
    let s = (row + 100) * 9301;
    const r = () => { s = (s * 16807) % 2147483647; return (s % 1000) / 1000; };
    for (let k = 0; k < 6; k++) {
      const x = -WALL + 0.3 + r() * (WALL * 2 - 0.6), y = row + r();
      ctx.fillStyle = r() < 0.5 ? 'rgba(80,60,45,0.18)' : 'rgba(255,240,220,0.12)';
      ctx.beginPath();
      ctx.ellipse(sx(x), sy(y), 10 + r() * 30, 6 + r() * 14, r() * 3, 0, Math.PI * 2);
      ctx.fill();
      if (r() < 0.4) {
        ctx.strokeStyle = 'rgba(60,45,35,0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let cx = sx(x), cy = sy(y);
        ctx.moveTo(cx, cy);
        for (let j = 0; j < 4; j++) { cx += (r() - 0.5) * 30; cy += r() * 18; ctx.lineTo(cx, cy); }
        ctx.stroke();
      }
    }
    // 구간 경계 표시
    if (row % 10 === 0 && row > 0 && row < TOP) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '700 14px "Noto Sans KR", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${row}m`, x0 + 6, sy(row) - 6);
    }
  }
  // 땅
  if (sy(0) < H) {
    ctx.fillStyle = '#6fa85a';
    ctx.fillRect(0, sy(0), W, H - sy(0));
    ctx.fillStyle = '#5b8f49';
    ctx.fillRect(0, sy(0), W, 8);
  }
}

function drawLedges() {
  for (const l of course.ledges) {
    const y = sy(l.y);
    if (y < -60 || y > H + 60) continue;
    ctx.fillStyle = '#7a5434';
    ctx.fillRect(sx(l.x0), y, (l.x1 - l.x0) * PX, 14);
    ctx.fillStyle = '#a8764a';
    ctx.fillRect(sx(l.x0), y, (l.x1 - l.x0) * PX, 5);
    // 깃발
    const fx = sx(l.x1 - 0.2);
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(fx, y); ctx.lineTo(fx, y - 60); ctx.stroke();
    ctx.fillStyle = l.top ? '#ffd34d' : l.reached ? '#5ad16a' : '#e2483f';
    ctx.beginPath(); ctx.moveTo(fx, y - 60); ctx.lineTo(fx + 30, y - 52); ctx.lineTo(fx, y - 44); ctx.fill();
    if (l.top) {
      ctx.fillStyle = '#fff';
      ctx.font = '22px "Jua", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🏁 정상', sx(0), y - 20);
    }
  }
}

function drawHolds() {
  for (const h of course.holds) {
    const p = holdPos(h);
    const x = sx(p.x), y = sy(p.y);
    if (y < -40 || y > H + 40) continue;
    if (h.type === 'move') {
      ctx.strokeStyle = 'rgba(138,85,214,0.35)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sx(h.bx - h.amp), y); ctx.lineTo(sx(h.bx + h.amp), y); ctx.stroke();
    }
    if (h.broken) {
      ctx.fillStyle = 'rgba(60,50,40,0.35)';
      ctx.beginPath(); ctx.arc(x, y, h.r * PX * 0.6, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    const r = h.r * PX;
    const shake = h.type === 'crumble' && h.crack > 0.5 ? Math.sin(game.time * 60) * 2 : 0;
    ctx.save();
    ctx.translate(x + shake, y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(3, 4, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = h.color;
    ctx.beginPath();
    if (h.type === 'spike') {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2, rr = k % 2 ? r * 0.7 : r * 1.25;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
    } else {
      ctx.ellipse(0, 0, r, r * 0.8, h.phase, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = h.light;
    ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.3, r * 0.4, r * 0.25, -0.5, 0, Math.PI * 2); ctx.fill();
    if (h.type === 'crumble') {
      ctx.strokeStyle = `rgba(40,30,25,${0.5 + h.crack * 0.5})`;
      ctx.lineWidth = 1.5 + h.crack * 2;
      ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.2); ctx.lineTo(0, r * 0.1); ctx.lineTo(r * 0.3, -r * 0.4); ctx.moveTo(0, r * 0.1); ctx.lineTo(r * 0.1, r * 0.6); ctx.stroke();
    }
    if (h.type === 'wet') {
      const dy = ((game.time * 1.2 + h.phase) % 1) * 18;
      ctx.fillStyle = 'rgba(140,210,255,0.9)';
      ctx.beginPath(); ctx.ellipse(r * 0.3, r * 0.6 + dy, 2.5, 4, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (h.type === 'crimp') {
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👌', 0, -r - 3);
    }
    ctx.restore();
  }
  for (const g of course.gems) {
    if (g.taken) continue;
    const x = sx(g.x), y = sy(g.y);
    if (y < -30 || y > H + 30) continue;
    const s = 9 + Math.sin(game.time * 4 + g.x) * 1.5, w = Math.abs(Math.cos(game.time * 2 + g.y)) * s;
    ctx.fillStyle = '#56e3ff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + w, y); ctx.lineTo(x, y + s); ctx.lineTo(x - w, y); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
}

function limb(a, b, c, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
}
// 관절 위치: 두 해 중 아래쪽(화면 y가 큰 쪽)이면서 side 방향 바깥으로 굽은 쪽을 고른다
function elbow(s, h, len, side) {
  const dx = h.x - s.x, dy = h.y - s.y, d = Math.min(hyp(dx, dy), len * 2 - 0.01);
  const a = Math.atan2(dy, dx), off = Math.acos(clamp(d / (2 * len), -1, 1));
  const c1 = { x: s.x + Math.cos(a + off) * len, y: s.y + Math.sin(a + off) * len };
  const c2 = { x: s.x + Math.cos(a - off) * len, y: s.y + Math.sin(a - off) * len };
  const score = (c) => c.y + (c.x - s.x) * side * 0.8;
  return score(c1) >= score(c2) ? c1 : c2;
}

function drawClimber() {
  const toS = (p) => ({ x: sx(p.x), y: sy(p.y) });
  const hip = toS({ x: P.x, y: P.y });
  const neck = toS({ x: P.x, y: P.y + 0.55 });
  const head = toS({ x: P.x, y: P.y + 0.85 });
  // 로프: 마지막 체크포인트에서 하네스까지
  const anchor = toS({ x: P.checkpoint.x, y: P.checkpoint.y + 0.1 });
  ctx.strokeStyle = '#ff8a2a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.quadraticCurveTo((anchor.x + hip.x) / 2 + 20, Math.max(anchor.y, hip.y) + 40, hip.x, hip.y);
  ctx.stroke();

  // 다리: 서 있으면 발판 위, 아니면 가까운 홀드에 발을 올리거나 늘어뜨린다
  const swing = Math.sin(game.time * 3) * 0.08;
  for (const side of [-1, 1]) {
    let foot = { x: P.x + side * 0.25 + swing, y: P.y - LEG };
    if (!P.supported) {
      let best = null, bd = 0.7;
      for (const h of course.holds) {
        if (h.broken) continue;
        const p = holdPos(h);
        if (p.y > P.y - 0.4 || Math.sign(p.x - P.x || side) !== side) continue;
        const d = hyp(p.x - (P.x + side * 0.3), p.y - (P.y - 0.8));
        if (d < bd) { bd = d; best = p; }
      }
      if (best) foot = { x: best.x, y: best.y + 0.08 };
    }
    const f = toS(foot);
    const knee = elbow(hip, f, 0.5 * PX, side);
    limb(hip, knee, f, 10, '#3c5a8a');
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath(); ctx.ellipse(f.x + side * 4, f.y, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  // 몸통
  ctx.strokeStyle = '#ff7a3d'; ctx.lineWidth = 22; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(neck.x, neck.y); ctx.stroke();
  ctx.fillStyle = '#2b2b33';
  ctx.fillRect(hip.x - 12, hip.y - 6, 24, 8); // 하네스
  ctx.fillStyle = '#f4f4f4';
  ctx.beginPath(); ctx.arc(hip.x + 13, hip.y + 2, 6, 0, Math.PI * 2); ctx.fill(); // 초크백

  // 팔과 손
  for (const hand of P.hands) {
    const s = toS(shoulderOf(hand.i));
    const shakeAmt = P.stamina < 25 && hand.hold ? Math.sin(game.time * 50 + hand.i) * 2 : 0;
    const hp = { x: sx(hand.x) + shakeAmt, y: sy(hand.y) };
    const el = elbow(s, hp, (REACH / 2 + 0.02) * PX, hand.i ? 1 : -1);
    limb(s, el, hp, 9, '#ffcfa8');
    drawHand(hand, hp);
    // 카메라 속 손이 팔 길이 밖에 있으면 희미한 원으로 보여준다
    if (!hand.hold) {
      const tp = { x: sx(P.x + hand.rx), y: sy(P.y + hand.ry) };
      if (hyp(tp.x - hp.x, tp.y - hp.y) > 12) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(tp.x, tp.y, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
  // 머리
  ctx.fillStyle = '#ffd9b8';
  ctx.beginPath(); ctx.arc(head.x, head.y, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath(); ctx.arc(head.x, head.y - 4, 23, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillRect(head.x - 25, head.y - 6, 50, 5);
  ctx.fillStyle = '#2b2b33';
  const strain = P.stamina < 30 || P.stunT > 0;
  for (const ex of [-8, 8]) {
    if (strain) { ctx.fillRect(head.x + ex - 4, head.y + 5, 8, 2.5); } else { ctx.beginPath(); ctx.arc(head.x + ex, head.y + 6, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = 2;
  ctx.beginPath();
  if (strain) { ctx.moveTo(head.x - 5, head.y + 15); ctx.lineTo(head.x + 5, head.y + 15); } else ctx.arc(head.x, head.y + 12, 5, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,120,140,0.5)';
  for (const ex of [-14, 14]) { ctx.beginPath(); ctx.ellipse(head.x + ex, head.y + 11, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill(); }
}

function drawHand(hand, p) {
  const holding = !!hand.hold;
  // 잡을 수 있는 홀드 위에 있으면 테두리로 알려준다
  let ring = null;
  if (!holding) {
    for (const h of course.holds) {
      if (h.broken) continue;
      const hp = holdPos(h);
      if (hyp(hp.x - hand.x, hp.y - hand.y) - h.r * 0.5 < GRAB_R) { ring = h.type === 'spike' ? '#ff5a5a' : h.needs === 'pinch' ? '#ffe08a' : '#7cf08a'; break; }
    }
  }
  ctx.fillStyle = hand.ouchT > 0 ? '#ff9a9a' : '#ffcfa8';
  ctx.strokeStyle = holding ? '#3fd06a' : ring || '#8a5a3c';
  ctx.lineWidth = holding || ring ? 4 : 2;
  ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hand.shape === 'fist' ? '✊' : hand.shape === 'pinch' ? '👌' : '🖐', p.x, p.y - 22);
  ctx.textBaseline = 'alphabetic';
}

function drawHazards() {
  for (const r of game.rocks) {
    if (r.warn > 0) {
      const a = 0.25 + 0.25 * Math.abs(Math.sin(game.time * 12));
      ctx.fillStyle = `rgba(255,60,60,${a})`;
      ctx.fillRect(sx(r.x - r.r - 0.1), 0, (r.r + 0.1) * 2 * PX, H);
      ctx.fillStyle = '#ff4040';
      ctx.font = '34px "Jua", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('▼', sx(r.x), 120);
      continue;
    }
    ctx.fillStyle = '#6b625a';
    ctx.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + game.time * 3, rr = r.r * PX * (0.8 + (k % 2) * 0.25);
      ctx.lineTo(sx(r.x) + Math.cos(a) * rr, sy(r.y) + Math.sin(a) * rr);
    }
    ctx.fill();
  }
  const g = game.gusts;
  if (g && g.warn > 0) {
    ctx.fillStyle = '#fff';
    ctx.font = '40px "Jua", sans-serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(game.time * 10));
    ctx.fillText(g.dir > 0 ? '💨 ➡➡➡' : '⬅⬅⬅ 💨', W / 2, 150);
    ctx.globalAlpha = 1;
  }
}

function drawEffects() {
  for (const p of game.particles) {
    ctx.globalAlpha = clamp(p.life * 2, 0, 1);
    if (p.streak) {
      ctx.strokeStyle = p.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx(p.x), sy(p.y)); ctx.lineTo(sx(p.x - p.vx * 0.05), sy(p.y)); ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), (p.size || 0.06) * PX, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  for (const f of game.floaters) {
    ctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
    ctx.font = '26px "Jua", sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(40,25,15,0.8)';
    ctx.strokeText(f.text, sx(f.x), sy(f.y));
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, sx(f.x), sy(f.y));
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  // 높이
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(30,20,15,0.6)';
  roundRect(16, 16, 250, 140, 14); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '44px "Jua", sans-serif';
  ctx.fillText(`${Math.max(0, P.y - LEG).toFixed(1)}m`, 30, 64);
  ctx.font = '700 14px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#ffe08a';
  ctx.fillText(`${ZONES[Math.max(0, game.zone)].name} · 목표 ${TOP}m`, 30, 88);
  ctx.fillStyle = '#ddd';
  ctx.fillText(`⏱ ${game.clock.toFixed(1)}s   💎 ${P.gems}   💥 추락 ${P.falls}`, 30, 114);
  // 진행 막대
  ctx.fillStyle = 'rgba(30,20,15,0.6)';
  roundRect(W - 46, 90, 22, 420, 11); ctx.fill();
  const prog = clamp((P.y - LEG) / TOP, 0, 1);
  ctx.fillStyle = '#ffd34d';
  roundRect(W - 42, 94 + 412 * (1 - prog), 14, 412 * prog, 7); ctx.fill();
  for (const l of course.ledges) {
    const yy = 94 + 412 * (1 - l.y / TOP);
    ctx.fillStyle = l.reached ? '#5ad16a' : '#fff';
    ctx.fillRect(W - 52, yy - 1, 34, 3);
  }
  // 팔 힘 (왼쪽 위 정보 상자 안)
  const bx = 30, by = 136, bw = 222;
  ctx.fillStyle = '#fff';
  ctx.font = '700 12px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(P.exhausted ? '💪 팔 힘 회복 중… 렛지에서 쉬세요' : P.supported ? '💪 팔 힘 (서 있으면 회복)' : '💪 팔 힘', bx, by);
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  roundRect(bx, by + 8, bw, 12, 6); ctx.fill();
  const f = P.stamina / STAMINA_MAX;
  ctx.fillStyle = f > 0.5 ? '#7be36a' : f > 0.25 ? '#ffc44d' : '#ff5d5d';
  roundRect(bx, by + 8, bw * f, 12, 6); ctx.fill();

  // 구간 배너
  if (game.zoneBanner > 0) {
    ctx.globalAlpha = clamp(game.zoneBanner, 0, 1);
    ctx.textAlign = 'center';
    ctx.font = '54px "Jua", sans-serif';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(40,25,15,0.7)';
    const name = ZONES[game.zone].name;
    ctx.strokeText(name, W / 2, 210); ctx.fillStyle = '#fff'; ctx.fillText(name, W / 2, 210);
    ctx.globalAlpha = 1;
  }
  if (game.fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${game.fade * 0.6})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawPreview() {
  if (game.mode !== 'camera' || !tracker || video.readyState < 2) return;
  const pw = 220, ph = Math.round(pw / tracker.aspect), px = W - pw - 70, py = H - ph - 14;
  ctx.save();
  roundRect(px, py, pw, ph, 10); ctx.clip();
  ctx.translate(px + pw, py); ctx.scale(-1, 1);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(video, 0, 0, pw, ph);
  ctx.restore();
  ctx.globalAlpha = 1;
  tracker.slots.forEach((slot, i) => {
    if (!slot.present) return;
    const map = (p) => ({ x: px + (p.x / tracker.aspect) * pw, y: py + p.y * ph });
    ctx.strokeStyle = i ? '#7ee8ff' : '#ffb07e'; ctx.lineWidth = 1.5;
    for (const [a, b] of HAND_CONNECTIONS) { const pa = map(slot.smooth[a]), pb = map(slot.smooth[b]); ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); }
    const c = map(slot.smooth[9]);
    ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(slot.shape === 'fist' ? '✊' : slot.shape === 'pinch' ? '👌' : '🖐', c.x, c.y - 26);
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
  roundRect(px, py, pw, ph, 10); ctx.stroke();
  const missing = tracker.slots.filter((s) => !s.present).length;
  if (missing) {
    ctx.fillStyle = '#ffe08a'; ctx.font = '700 12px "Noto Sans KR", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(missing === 2 ? '두 손을 카메라에 보여주세요' : '한 손이 안 보여요', px + pw / 2, py - 6);
  }
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function render() {
  ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
  if (game.shake > 0) ctx.translate((Math.random() - 0.5) * game.shake * 14, (Math.random() - 0.5) * game.shake * 14);
  drawBackground();
  drawWall();
  drawLedges();
  drawHolds();
  drawHazards();
  drawClimber();
  drawEffects();
  ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
  if (game.screen === 'play') { drawHud(); drawPreview(); }
}

// ───────────── 화면 / 루프 ─────────────
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = `${Math.floor(W * s)}px`;
  canvas.style.height = `${Math.floor(H * s)}px`;
  canvas.width = Math.floor(W * s * dpr);
  canvas.height = Math.floor(H * s * dpr);
  viewScale = s * dpr;
}

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('show', el.id === id);
  $('zone-tip').style.display = id === null ? '' : 'none';
}

function startGame(mode) {
  game.mode = mode;
  resetRun();
  game.clock = 0;
  game.screen = 'play';
  showScreen(null);
}

function showResult(r) {
  game.screen = 'result';
  $('result-rank').textContent = r.rank;
  $('result-score').textContent = `${r.score.toLocaleString()}점${r.isBest ? ' · 최고 기록!' : ''}`;
  $('result-detail').textContent = `시간 ${r.time.toFixed(1)}초 · 추락 ${r.falls}번 · 보석 ${r.gems}개`;
  showScreen('result');
}

$('btn-cam').addEventListener('click', async () => {
  sfx.ensure();
  const btns = document.querySelectorAll('#title button');
  btns.forEach((b) => { b.disabled = true; });
  try {
    const t = new HandTracker(video);
    await t.init((msg) => { $('status').textContent = msg; });
    tracker = t;
    startGame('camera');
  } catch (err) {
    console.error(err);
    $('status').textContent = `카메라/손 인식을 시작하지 못했어요: ${err.message || err}. 카메라 권한을 확인하거나 마우스로 플레이하세요.`;
  }
  btns.forEach((b) => { b.disabled = false; });
});
$('btn-mouse').addEventListener('click', () => { sfx.ensure(); startGame('mouse'); });
$('btn-again').addEventListener('click', () => startGame(game.mode));
$('btn-title').addEventListener('click', () => { game.screen = 'title'; resetRun(); showScreen('title'); });

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) / r.width * W;
  mouse.y = (e.clientY - r.top) / r.height * H;
});
canvas.addEventListener('mousedown', (e) => { sfx.ensure(); if (e.button === 0) mouse.left = true; if (e.button === 2) mouse.right = true; mouse.shift = e.shiftKey; });
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') mouse.shift = true;
  // 마우스 모드 다이노: 두 손으로 잡은 상태에서 Space
  if (e.code === 'Space' && game.screen === 'play') {
    e.preventDefault();
    if (P.hands.every((h) => h.hold)) {
      P.lastTwoGripT = game.time;
      P.hands.forEach((h) => { h.hold = null; h.shape = 'open'; h.letGoAt = game.time; });
      P.forceDyno = true;
      checkDyno();
      mouse.left = mouse.right = false;
    }
  }
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') mouse.shift = false; });
window.addEventListener('resize', resize);
window.addEventListener('blur', () => { mouse.left = mouse.right = false; });

resetRun();
resize();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.screen === 'play') { if (!game.frozen) update(dt); }
  else { game.time += dt; game.camY += (Math.sin(game.time * 0.15) * 20 + 25 - game.camY) * damp(0.5, dt); }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 개발 확인용: ?debug 로 열면 상태를 보고 입력을 직접 넣을 수 있다
if (/[?&]debug\b/.test(location.search)) {
  window.__climb = { game, P, course: () => course, update, startGame, holdPos, frameToRel, shoulderOf, REACH, LEG, TOP };
}
})();
