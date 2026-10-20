// 음성 지휘: Web Speech API(ko-KR)로 들은 말에서 명령어를 찾아 순서대로 넘겨준다.
// 중간 인식 결과(interim)도 읽어서 말이 끝나기 전에 반응하고, 같은 명령이 두 번 실행되지 않게 결과마다 처리한 개수를 기억한다.
(() => {

// 명령 id → 알아들을 말. 음성 인식이 자주 바꿔 적는 표기도 함께 넣는다.
const COMMANDS = {
  advance: ['전진', '앞으로', '진격', '전친'],
  retreat: ['후퇴', '뒤로', '물러나', '퇴각'],
  halt: ['정지', '멈춰', '그만', '스톱', '제자리'],
  left: ['왼쪽', '좌로', '좌측'],
  right: ['오른쪽', '우로', '우측'],
  shield: ['방패', '방어', '막아', '실드'],
  spread: ['산개', '흩어져', '퍼져'],
  gather: ['모여', '집합', '뭉쳐', '대형'],
  attack: ['공격', '쳐라', '싸워', '찔러'],
  charge: ['돌격', '돌진', '차지'],
  javelin: ['투창', '창던져', '던져', '발사'],
  warcry: ['스파르타', '함성', '파이팅'],
};

function normalize(text) {
  return text.replace(/[\s.,!?~'"“”‘’·…-]/g, '');
}

// 문장 안의 명령을 나온 순서대로 돌려준다. 겹치는 표기(예: '창던져'와 '던져')는 먼저 시작하고 더 긴 쪽 하나만 센다.
function parseCommands(text) {
  const t = normalize(text);
  const hits = [];
  for (const [id, words] of Object.entries(COMMANDS)) {
    for (const w of words) {
      let i = t.indexOf(w);
      while (i !== -1) {
        hits.push({ id, start: i, end: i + w.length });
        i = t.indexOf(w, i + 1);
      }
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start < lastEnd) continue;
    // '모여 대형'처럼 같은 명령을 붙여 말하면 한 번만 센다
    if (out[out.length - 1] !== h.id) out.push(h.id);
    lastEnd = h.end;
  }
  return out;
}

class VoiceCommander {
  constructor({ onCommand, onTranscript, onState }) {
    this.onCommand = onCommand;
    this.onTranscript = onTranscript || (() => {});
    this.onState = onState || (() => {});
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    this.wanted = false;
    this.running = false;
    this.done = new Map();
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => { this.running = true; this.done.clear(); this.onState('listening'); };
    rec.onend = () => {
      this.running = false;
      // 크롬은 일정 시간이 지나거나 조용하면 스스로 끝나므로 다시 켠다
      if (this.wanted) setTimeout(() => this.start(), 150);
      else this.onState('off');
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wanted = false;
        this.onState('denied');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.onState('error', e.error);
      }
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        const cmds = parseCommands(text);
        const already = this.done.get(i) || 0;
        for (let k = already; k < cmds.length; k++) this.onCommand(cmds[k], text);
        this.done.set(i, Math.max(already, cmds.length));
        this.onTranscript(text, r.isFinal);
      }
    };
    this.rec = rec;
  }

  start() {
    if (!this.supported) return;
    this.wanted = true;
    if (this.running) return;
    try { this.rec.start(); } catch { /* 이미 시작 중 */ }
  }

  stop() {
    this.wanted = false;
    if (this.supported && this.running) this.rec.stop();
  }
}

window.VoiceCommander = VoiceCommander;
window.parseCommands = parseCommands;
window.VOICE_COMMANDS = COMMANDS;
})();
