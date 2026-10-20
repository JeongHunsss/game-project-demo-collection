(() => {
// 웹캠 손 추적: MediaPipe HandLandmarker로 손 두 개를 찾아 화면 왼쪽 손 = P1, 오른쪽 손 = P2로 배정한다.
// 좌표는 거울 모드(좌우 반전)이고 x는 화면 비율을 곱해 정사각 단위로 맞춘다.

const MP_VERSION = '0.10.14';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const LOST_GRACE = 250; // ms: 이 시간 안에 다시 잡히면 같은 손으로 본다
const SMOOTH = 0.55;    // 관절 위치 지수 평활 계수

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function palmCenter(lm) {
  let x = 0, y = 0;
  for (const i of [0, 5, 9, 13, 17]) { x += lm[i].x; y += lm[i].y; }
  return { x: x / 5, y: y / 5 };
}

// 손가락이 얼마나 펴졌는지 0(접음)~1(폄). 손목→끝 거리를 손목→뿌리 거리로 나눠 카메라 거리에 무관하게 만든다.
function extension(lm, tip, mcp) {
  const r = dist(lm[0], lm[tip]) / Math.max(1e-4, dist(lm[0], lm[mcp]));
  return clamp01((r - 1.3) / 0.5);
}

function deriveControls(lm, aspect) {
  const palm = palmCenter(lm);
  const size = Math.max(1e-4, dist(lm[0], lm[9]));
  // 검지 방향: 첫 마디 위주로 잡아야 손가락을 접어도 방향이 튀지 않는다
  const ix = (lm[6].x - lm[5].x) + (lm[7].x - lm[6].x) * 0.5;
  const iy = (lm[6].y - lm[5].y) + (lm[7].y - lm[6].y) * 0.5;
  const mid = extension(lm, 12, 9), ring = extension(lm, 16, 13), pinky = extension(lm, 20, 17);
  const index = extension(lm, 8, 5);
  // 엄지: 세우면 끝이 검지 뿌리에서 멀어지고, 손바닥 쪽으로 접으면 가까워진다
  const thumb = clamp01((dist(lm[4], lm[5]) / size - 0.35) / 0.4);
  return {
    px: palm.x / aspect,
    py: palm.y,
    swordAngle: Math.atan2(iy, ix),
    armExt: index,
    thumb,
    lunge: clamp01(((mid + ring) / 2 - 0.15) / 0.7),
    duck: clamp01((pinky - 0.2) / 0.6),
    open: index > 0.7 && mid > 0.7 && ring > 0.7 && pinky > 0.7,
    rel: lm.map((p) => ({ x: (p.x - palm.x) / size, y: (p.y - palm.y) / size })),
  };
}

class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.aspect = 16 / 9;
    this.slots = [0, 1].map(() => ({ smooth: null, lastSeen: -1e9, present: false, controls: null }));
  }

  get ready() { return !!this.landmarker; }

  async init(onStatus) {
    onStatus('카메라 권한을 요청하는 중…');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();

    onStatus('손 인식 모델을 불러오는 중… (처음 한 번은 조금 걸려요)');
    const { FilesetResolver, HandLandmarker } = await import(MP_BUNDLE);
    const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MP_MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
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
      const hands = (res.landmarks || []).map((lms) => lms.map((p) => ({ x: (1 - p.x) * this.aspect, y: p.y })));
      const palms = hands.map(palmCenter);
      const order = hands.map((_, i) => i).sort((a, b) => palms[a].x - palms[b].x);

      const assigned = [null, null];
      if (order.length >= 2) {
        assigned[0] = hands[order[0]];
        assigned[1] = hands[order[order.length - 1]];
      } else if (order.length === 1) {
        const i = order[0];
        assigned[palms[i].x / this.aspect < 0.5 ? 0 : 1] = hands[i];
      }

      assigned.forEach((lm, s) => {
        if (!lm) return;
        const slot = this.slots[s];
        if (!slot.smooth || nowMs - slot.lastSeen > LOST_GRACE) {
          slot.smooth = lm.map((p) => ({ ...p }));
        } else {
          slot.smooth.forEach((p, i) => {
            p.x += (lm[i].x - p.x) * SMOOTH;
            p.y += (lm[i].y - p.y) * SMOOTH;
          });
        }
        slot.lastSeen = nowMs;
        slot.controls = deriveControls(slot.smooth, this.aspect);
      });
    }
    for (const slot of this.slots) slot.present = !!slot.smooth && nowMs - slot.lastSeen < LOST_GRACE;
  }
}

window.HandTracker = HandTracker;
window.HAND_CONNECTIONS = HAND_CONNECTIONS;
})();
