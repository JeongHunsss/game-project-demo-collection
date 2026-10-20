(() => {
// 몸 동작 인식: MediaPipe Pose Landmarker로 어깨·팔꿈치·손목을 추적해서
// 날갯짓(팔을 올렸다가 내려치기), 몸 기울기(어깨 기울기), 활공(팔을 양옆으로 쭉 펴고 버티기)을 판정한다.

const MP_VERSION = '0.10.14';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const L_SH = 11, R_SH = 12, L_EL = 13, R_EL = 14, L_WR = 15, R_WR = 16, L_HIP = 23, R_HIP = 24;
const POSE_LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];

// 팔 높이(armY)는 '손목이 어깨보다 얼마나 아래에 있는가'를 어깨 너비로 나눈 값이다. 위로 들면 음수, 내리면 양수.
const UP_LINE = 0.1;     // 이보다 위로 들면 '올린 상태'
const DOWN_LINE = 0.75;  // 이보다 아래로 내리면 '내려친 상태' → 날갯짓 1회
const LEAN_FULL = 0.30;  // 어깨 기울기(라디안)가 이만큼이면 최대로 꺾는다 (약 17°)
const LEAN_DEAD = 0.05;  // 이 안쪽은 똑바로 선 것으로 본다 (약 3°)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 랜드마크(거울 모드, x는 화면 비율을 곱한 값)를 받아 동작을 판정한다. 카메라 없이도 테스트할 수 있게 분리했다.
class BodyGestures {
  constructor() { this.reset(); }
  reset() {
    this.armY = 0.6;
    this.phase = 'down';
    this.peakUp = 0.6;
    this.flaps = 0;          // 지금까지 날갯짓 횟수 (게임은 증가분을 읽는다)
    this.lastStrength = 1;
    this.lean = 0;           // -1(왼쪽) ~ 1(오른쪽)
    this.glide = false;
    this.glideT = 0;
    this.lastFlapT = -9;
    this.present = false;
  }

  update(lm, t, dt) {
    const vis = (i) => (lm[i].visibility ?? 1) > 0.4;
    if (!vis(L_SH) || !vis(R_SH)) { this.present = false; return; }
    this.present = true;
    const ls = lm[L_SH], rs = lm[R_SH];
    const shW = Math.max(0.05, Math.hypot(ls.x - rs.x, ls.y - rs.y));
    const shY = (ls.y + rs.y) / 2;

    const wrists = [L_WR, R_WR].filter(vis).map((i) => lm[i]);
    if (wrists.length) {
      const wy = wrists.reduce((s, w) => s + w.y, 0) / wrists.length;
      const raw = (wy - shY) / shW;
      this.armY += (raw - this.armY) * 0.6;
    }

    // 날갯짓: '올린 상태'를 거쳐 '내려친 상태'에 닿는 순간 1회. 높이 올렸다 내려칠수록 세다.
    if (this.armY < UP_LINE) {
      if (this.phase !== 'up') { this.phase = 'up'; this.peakUp = this.armY; }
      this.peakUp = Math.min(this.peakUp, this.armY);
    } else if (this.armY > DOWN_LINE && this.phase === 'up') {
      this.phase = 'down';
      this.flaps++;
      this.lastStrength = clamp(0.75 + (DOWN_LINE - this.peakUp) * 0.35, 0.75, 1.3);
      this.lastFlapT = t;
    }

    // 기울기: 화면(거울) 왼쪽 어깨가 내려가면 왼쪽으로 기운 것
    // 화면 왼쪽에 있는 어깨는 거울 모드라서 x가 작은 쪽이다
    const [left, right] = ls.x < rs.x ? [ls, rs] : [rs, ls];
    const angle = Math.atan2(left.y - right.y, right.x - left.x); // 왼쪽이 낮으면 +
    const mag = Math.max(0, Math.abs(angle) - LEAN_DEAD) / (LEAN_FULL - LEAN_DEAD);
    const target = -Math.sign(angle) * clamp(mag, 0, 1);
    this.lean += (target - this.lean) * 0.35;

    // 활공: 두 손목이 어깨 높이 근처에서 어깨 너비의 2.3배 이상 벌어진 채 0.3초 이상
    let spread = false;
    if (vis(L_WR) && vis(R_WR)) {
      const w = Math.abs(lm[L_WR].x - lm[R_WR].x) / shW;
      spread = w > 2.3 && Math.abs(this.armY) < 0.45;
    }
    this.glideT = spread ? this.glideT + dt : 0;
    this.glide = this.glideT > 0.3 && t - this.lastFlapT > 0.4;
  }
}

class PoseTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.aspect = 16 / 9;
    this.gestures = new BodyGestures();
    this.landmarks = null;
    this.lastSeen = -1e9;
  }

  async init(onStatus) {
    onStatus('카메라 권한을 요청하는 중…');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
    onStatus('몸 인식 모델을 불러오는 중… (처음 한 번은 조금 걸려요)');
    const { FilesetResolver, PoseLandmarker } = await import(MP_BUNDLE);
    const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MP_MODEL, delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
    }
  }

  update(nowMs) {
    if (!this.landmarker || this.video.readyState < 2) return;
    const t = this.video.currentTime;
    if (t === this.lastVideoTime) return;
    const dt = this.lastVideoTime < 0 ? 1 / 30 : Math.min(0.1, t - this.lastVideoTime);
    this.lastVideoTime = t;
    this.aspect = (this.video.videoWidth / this.video.videoHeight) || 16 / 9;
    const res = this.landmarker.detectForVideo(this.video, nowMs);
    const lm = res.landmarks && res.landmarks[0];
    if (!lm) {
      if (nowMs - this.lastSeen > 500) this.gestures.present = false;
      return;
    }
    this.lastSeen = nowMs;
    this.landmarks = lm.map((p) => ({ x: (1 - p.x) * this.aspect, y: p.y, visibility: p.visibility }));
    this.gestures.update(this.landmarks, nowMs / 1000, dt);
  }
}

window.PoseTracker = PoseTracker;
window.BodyGestures = BodyGestures;
window.POSE_LINKS = POSE_LINKS;
})();
