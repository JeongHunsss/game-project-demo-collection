(() => {
// 웹캠 손 추적: MediaPipe HandLandmarker로 두 손을 찾아 화면 왼쪽 손 = 왼손(0), 오른쪽 손 = 오른손(1)으로 배정하고
// 손바닥 위치(0~1, 거울 모드)와 손 모양('fist' 주먹 / 'pinch' OK / 'open' 편 손)을 넘겨준다.

const MP_VERSION = '0.10.14';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const LOST_GRACE = 400;  // ms: 잠깐 인식이 끊겨도 이 시간 동안은 마지막 손 모양을 유지한다 (갑자기 놓치지 않게)
const SMOOTH = 0.5;
const SHAPE_FRAMES = 2;  // 같은 모양이 연속 이만큼 나와야 바뀐다

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function palmCenter(lm) {
  let x = 0, y = 0;
  for (const i of [0, 5, 9, 13, 17]) { x += lm[i].x; y += lm[i].y; }
  return { x: x / 5, y: y / 5 };
}

// 손가락 펴짐 0(접음)~1(폄): 손목→끝 거리 / 손목→뿌리 거리
function extension(lm, tip, mcp) {
  const r = dist(lm[0], lm[tip]) / Math.max(1e-4, dist(lm[0], lm[mcp]));
  return clamp01((r - 1.25) / 0.55);
}

// 손 모양 판별: 네 손가락이 모두 접히면 주먹, 엄지·검지 끝이 붙고 나머지가 펴져 있으면 OK(집기)
function classify(lm) {
  const size = Math.max(1e-4, dist(lm[0], lm[9]));
  const ext = [extension(lm, 8, 5), extension(lm, 12, 9), extension(lm, 16, 13), extension(lm, 20, 17)];
  const pinchGap = dist(lm[4], lm[8]) / size;
  if (ext.every((e) => e < 0.4)) return 'fist';
  if (pinchGap < 0.38 && ext[1] > 0.45 && ext[2] > 0.35) return 'pinch';
  return 'open';
}

class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.aspect = 16 / 9;
    this.slots = [0, 1].map(() => ({ smooth: null, lastSeen: -1e9, present: false, shape: 'open', pending: 'open', pendingN: 0, x: 0.5, y: 0.5 }));
  }

  async init(onStatus) {
    onStatus('카메라 권한을 요청하는 중…');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
    onStatus('손 인식 모델을 불러오는 중… (처음 한 번은 조금 걸려요)');
    const { FilesetResolver, HandLandmarker } = await import(MP_BUNDLE);
    const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MP_MODEL, delegate },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
    }
  }

  update(nowMs) {
    if (!this.landmarker || this.video.readyState < 2) return;
    const t = this.video.currentTime;
    if (t !== this.lastVideoTime) {
      this.lastVideoTime = t;
      this.aspect = (this.video.videoWidth / this.video.videoHeight) || 16 / 9;
      const res = this.landmarker.detectForVideo(this.video, nowMs);
      // 거울 모드 좌표, x는 화면 비율을 곱해 모양 계산이 찌그러지지 않게 한다
      const hands = (res.landmarks || []).map((lms) => lms.map((p) => ({ x: (1 - p.x) * this.aspect, y: p.y })));
      const palms = hands.map(palmCenter);
      const order = hands.map((_, i) => i).sort((a, b) => palms[a].x - palms[b].x);
      const assigned = [null, null];
      if (order.length >= 2) {
        assigned[0] = hands[order[0]];
        assigned[1] = hands[order[order.length - 1]];
      } else if (order.length === 1) {
        assigned[palms[order[0]].x / this.aspect < 0.5 ? 0 : 1] = hands[order[0]];
      }
      assigned.forEach((lm, s) => {
        if (!lm) return;
        const slot = this.slots[s];
        if (!slot.smooth || nowMs - slot.lastSeen > LOST_GRACE) slot.smooth = lm.map((p) => ({ ...p }));
        else slot.smooth.forEach((p, i) => { p.x += (lm[i].x - p.x) * SMOOTH; p.y += (lm[i].y - p.y) * SMOOTH; });
        slot.lastSeen = nowMs;
        const pc = palmCenter(slot.smooth);
        slot.x = pc.x / this.aspect;
        slot.y = pc.y;
        const shape = classify(lm);
        if (shape === slot.pending) slot.pendingN++;
        else { slot.pending = shape; slot.pendingN = 1; }
        if (slot.pendingN >= SHAPE_FRAMES) slot.shape = shape;
      });
    }
    for (const slot of this.slots) {
      slot.present = !!slot.smooth && nowMs - slot.lastSeen < LOST_GRACE;
      if (!slot.present) slot.shape = 'open';
    }
  }
}

window.HandTracker = HandTracker;
window.HAND_CONNECTIONS = HAND_CONNECTIONS;
window.classifyHand = classify;
})();
