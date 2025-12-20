// Morse Card Player - vanilla HTML/CSS/JS + Web Components + Web Audio API
// Drop your festive frame image at: /images/festive-card.png (or change background-src in index.html)

const MORSE_TO_TEXT = {
  ".-": "A",
  "-...": "B",
  "-.-.": "C",
  "-..": "D",
  ".": "E",
  "..-.": "F",
  "--.": "G",
  "....": "H",
  "..": "I",
  ".---": "J",
  "-.-": "K",
  ".-..": "L",
  "--": "M",
  "-.": "N",
  "---": "O",
  ".--.": "P",
  "--.-": "Q",
  ".-.": "R",
  "...": "S",
  "-": "T",
  "..-": "U",
  "...-": "V",
  ".--": "W",
  "-..-": "X",
  "-.--": "Y",
  "--..": "Z",
  "-----": "0",
  ".----": "1",
  "..---": "2",
  "...--": "3",
  "....-": "4",
  ".....": "5",
  "-....": "6",
  "--...": "7",
  "---..": "8",
  "----.": "9",
  ".-.-.-": ".",
  "--..--": ",",
  "..--..": "?",
  "-.-.--": "!",
  "-..-.": "/",
  "-.--.": "(",
  "-.--.-": ")",
  ".----.": "'",
  "-....-": "-",
  ".-..-.": '"',
  ".-.-.": "+",
  "-.-.-.": ";",
  "---...": ":",
  "..--.-": "_",
  ".-...": "&",
  "...-..-": "$",
  "...---...": "SOS",
};

function decodeMorse(morse) {
  return morse
    .trim()
    .split(" / ")
    .map((word) =>
      word
        .split(" ")
        .map((ch) => MORSE_TO_TEXT[ch] ?? "�")
        .join("")
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Audio utilities ---
function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

class MorseAudioEngine {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.osc = null;

    this.isPlaying = false;
    this.events = []; // [{t0,t1,spanIndex}]
    this.eventPtr = 0;

    this.startAt = 0; // AudioContext time
    this.offsetSec = 0; // playback offset in seconds (for pause/resume)
    this.totalSec = 0;

    this._raf = null;
    this._onTick = null;
  }

  _ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;

    this.osc = this.ctx.createOscillator();
    this.osc.type = "sine";
    this.osc.frequency.value = 550;

    this.osc.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.osc.start();
  }

  setTone(freqHz) {
    this._ensureContext();
    this.osc.frequency.setValueAtTime(
      clamp(freqHz, 200, 1200),
      this.ctx.currentTime
    );
  }

  setVolume(vol01) {
    this._ensureContext();
    // volume is applied as peak key-down gain; actual keying ramps handle clicks
    this._volume = clamp(vol01, 0, 1);
  }

  stop() {
    if (!this.ctx) return;
    this.isPlaying = false;
    this.offsetSec = 0;
    this.events = [];
    this.eventPtr = 0;
    this.totalSec = 0;
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    this._cancelTick();
  }

  pause() {
    if (!this.ctx || !this.isPlaying) return;
    const now = this.ctx.currentTime;
    const played = now - this.startAt;
    this.offsetSec = clamp(this.offsetSec + played, 0, this.totalSec);
    this.isPlaying = false;

    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);

    this._cancelTick();
  }

  resume(scheduleFn) {
    if (!this.ctx) this._ensureContext();
    if (this.isPlaying) return;
    scheduleFn(this.offsetSec);
  }

  _cancelTick() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _tick() {
    if (!this.isPlaying) return;
    const t = this.ctx.currentTime - this.startAt + this.offsetSec;

    // advance pointer
    while (
      this.eventPtr < this.events.length &&
      t > this.events[this.eventPtr].t1
    ) {
      this.eventPtr++;
    }
    if (this._onTick) {
      const active =
        this.eventPtr < this.events.length ? this.events[this.eventPtr] : null;
      this._onTick({ t, active, total: this.totalSec });
    }

    if (t >= this.totalSec) {
      this.isPlaying = false;
      this.offsetSec = 0;
      if (this._onTick)
        this._onTick({
          t: this.totalSec,
          active: null,
          total: this.totalSec,
          ended: true,
        });
      this._cancelTick();
      return;
    }
    this._raf = requestAnimationFrame(() => this._tick());
  }

  onTick(fn) {
    this._onTick = fn;
  }

  // Build schedule from "timeline" items: [{type:'dot'|'dash'|'gap', dur, spanIndex?}]
  // Settings: {wpm, farnsworth, toneHz, volume01}
  schedule(timeline, settings, startOffsetSec = 0) {
    this._ensureContext();
    const now = this.ctx.currentTime;

    // cancel any previous schedule
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);

    this.setTone(settings.toneHz);
    this.setVolume(settings.volume01);

    // Build absolute time events for highlighting (key-down only)
    let t = 0;
    this.events = [];
    this.eventPtr = 0;

    // schedule keying from time = now + 0.05
    const start = now + 0.05;
    const vol = this._volume ?? settings.volume01;

    // clickless envelope
    const attack = 0.004;
    const release = 0.006;

    for (const item of timeline) {
      if (item.type === "tone") {
        const t0 = t;
        const t1 = t + item.dur;

        if (item.spanIndex != null) {
          this.events.push({ t0, t1, spanIndex: item.spanIndex });
        }

        // key down
        this.gain.gain.setValueAtTime(0, start + t0);
        this.gain.gain.linearRampToValueAtTime(vol, start + t0 + attack);
        // hold then release
        this.gain.gain.setValueAtTime(
          vol,
          start + Math.max(t1 - release, t0 + attack)
        );
        this.gain.gain.linearRampToValueAtTime(0, start + t1);

        t = t1;
      } else {
        // gap
        t += item.dur;
      }
    }

    this.totalSec = t;

    // apply start offset
    this.offsetSec = clamp(startOffsetSec, 0, this.totalSec);
    this.startAt = this.ctx.currentTime;
    this.isPlaying = true;

    // Jump pointer to current offset
    while (
      this.eventPtr < this.events.length &&
      this.events[this.eventPtr].t1 < this.offsetSec
    ) {
      this.eventPtr++;
    }

    // Start ticking
    this._cancelTick();
    this._raf = requestAnimationFrame(() => this._tick());
  }
}

// Build a timeline from a morse string.
// Uses dot based on WPM, and Farnsworth spacing (simple) by scaling inter-letter and inter-word gaps.
function buildTimeline(morse, { wpm, farnsworth }) {
  const charWpm = clamp(Number(wpm) || 20, 5, 60);
  const fw = clamp(Number(farnsworth) || charWpm, 5, 60);

  const dot = 1.2 / charWpm; // seconds
  const dash = 3 * dot;

  const scale = fw >= charWpm ? 1 : charWpm / fw;
  const gapElem = dot; // between elements inside a character (fixed)
  const gapChar = 3 * dot * scale; // between letters
  const gapWord = 7 * dot * scale; // between words

  // Build spans: one per visible token (dot/dash inside each character)
  // We'll highlight per character span group (each morse character cell).
  const words = morse
    .trim()
    .split(" / ")
    .map((w) => w.trim())
    .filter(Boolean);

  const timeline = [];
  const spans = []; // [{text, isGapWord, charIndex}]
  let spanIndex = 0;

  let charIndexGlobal = 0;
  for (let wi = 0; wi < words.length; wi++) {
    const letters = words[wi].split(" ").filter(Boolean);
    for (let li = 0; li < letters.length; li++) {
      const code = letters[li];

      spans.push({ kind: "char", code, spanIndex, charIndex: charIndexGlobal });
      const currentSpanIndex = spanIndex;
      spanIndex++;
      charIndexGlobal++;

      // elements
      for (let ei = 0; ei < code.length; ei++) {
        const sym = code[ei];
        if (sym === ".") {
          timeline.push({
            type: "tone",
            dur: dot,
            spanIndex: currentSpanIndex,
          });
        } else if (sym === "-") {
          timeline.push({
            type: "tone",
            dur: dash,
            spanIndex: currentSpanIndex,
          });
        }
        // intra-element gap (not after last element)
        if (ei !== code.length - 1) {
          timeline.push({ type: "gap", dur: gapElem });
        }
      }

      // inter-character gap (not after last letter in word)
      if (li !== letters.length - 1) {
        timeline.push({ type: "gap", dur: gapChar });
      }
    }

    // inter-word gap (not after last word)
    if (wi !== words.length - 1) {
      timeline.push({ type: "gap", dur: gapWord });
      spans.push({ kind: "wordgap" });
    }
  }

  return { timeline, spans, dot, dash, gapChar, gapWord, gapElem, scale };
}

class MorsePlayer extends HTMLElement {
  static get observedAttributes() {
    return ["morse", "background-src"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this.state = {
      morse: "",
      decoded: "",
      wpm: 20,
      farnsworth: 20,
      toneHz: 550,
      volume: 80, // percent
      revealed: false,
      showRevealModal: false,
    };

    this.engine = new MorseAudioEngine();
    this._spansMeta = [];
    this._spanEls = [];
    this._currentSpan = -1;
    this._wordData = [];
    this._revealedWordIndices = new Set();
    this._confettiLayer = null;
    this._hasCelebrated = false;
    this._modalFocusRestore = null;

    this.engine.onTick(({ active, t, total, ended }) => {
      // highlight
      const idx = active ? active.spanIndex : -1;
      this._setActiveSpan(idx);

      // progress
      const prog = this.shadowRoot.querySelector("progress");
      if (prog) prog.value = total ? t / total : 0;

      if (ended) {
        this._setPlayingUI(false);
        this._setActiveSpan(-1);
      }
    });
  }

  connectedCallback() {
    this._render();
    this._hydrateFromAttributes();
    this._wire();
    this._refresh();
  }

  attributeChangedCallback() {
    if (!this.shadowRoot) return;
    this._hydrateFromAttributes();
    this._refresh();
  }

  _hydrateFromAttributes() {
    const morse = this.getAttribute("morse") || "";
    this.state.morse = morse;
    this.state.decoded = decodeMorse(morse);
    this.state.revealed = false;
    this.state.showRevealModal = false;
    this._revealedWordIndices = new Set();
    this._hasCelebrated = false;
    this._setMinimized(false);

    const bg = this.getAttribute("background-src") || "";
    const card = this.shadowRoot.querySelector(".card");
    if (card && bg) {
      card.style.setProperty("--card-bg", `url('${bg}')`);
    }
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host{ display:block; }

        .card{
          --card-bg: none;
          position: relative;
          border-radius: calc(var(--radius) + 10px);
          padding: 18px;
          background: var(--card-bg);
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          border: 6px solid rgba(199, 47, 56, 0.45);
          box-shadow: var(--shadow);
          overflow: visible;
          transition: transform 180ms ease, padding 180ms ease;
        }

        .card.minimized{
          padding: 14px;
        }

        .card::before{
          content: "";
          position: absolute;
          inset: 14px;
          border-radius: calc(var(--radius) - 2px);
          background: linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,234,210,0.12));
          border: 2px solid rgba(62, 110, 76, 0.35);
          box-shadow: inset 0 0 0 3px rgba(255,255,255,0.6);
          z-index: 0;
        }

        .card::after{
          content: "";
          position: absolute;
          inset: 0;
          border-radius: calc(var(--radius) + 10px);
          pointer-events: none;
          background:
            radial-gradient(120px 120px at 44px 46px, rgba(199,47,56,0.32), transparent 70%),
            radial-gradient(120px 120px at calc(100% - 44px) 46px, rgba(62,110,76,0.28), transparent 70%),
            radial-gradient(120px 120px at 44px calc(100% - 44px), rgba(62,110,76,0.28), transparent 70%),
            radial-gradient(120px 120px at calc(100% - 44px) calc(100% - 44px), rgba(199,47,56,0.28), transparent 70%);
          opacity: 0.55;
          mix-blend-mode: screen;
        }

        .content{
          position: relative;
          z-index: 1;
          padding: 24px 20px;
          border-radius: calc(var(--radius) - 6px);
          background: rgba(255, 248, 240, 0.68);
          box-shadow: inset 0 0 28px rgba(255, 239, 220, 0.55);
        }

        .card.minimized .content{
          display: none;
        }

        .minimizedNotice{
          position: relative;
          z-index: 1;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 18px;
          border-radius: calc(var(--radius) - 2px);
          background: linear-gradient(160deg, rgba(255,255,255,0.95), rgba(255, 236, 213, 0.9));
          border: 2px dashed rgba(62, 110, 76, 0.45);
          box-shadow: inset 0 0 18px rgba(62, 110, 76, 0.18);
          text-align: center;
          gap: 14px;
          flex-direction: column;
        }

        .minimizedNotice h3{
          margin: 0;
          font-size: 20px;
          font-family: var(--serif);
          color: #2f4f3a;
        }

        .minimizedNotice p{
          margin: 0;
          font-size: 14px;
          color: rgba(109, 73, 51, 0.82);
        }

        .card.minimized .minimizedNotice{
          display: flex;
        }

        .grid{
          display: grid;
          gap: 18px;
        }

        .panel{
          background: linear-gradient(160deg, rgba(255,255,255,0.92), rgba(255, 236, 213, 0.88));
          border: 2px solid rgba(199, 47, 56, 0.22);
          border-radius: var(--radius);
          padding: 18px;
          box-shadow: 0 18px 32px rgba(0, 0, 0, 0.08);
        }

        .row{
          display:flex;
          align-items:center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .title{
          display:flex;
          align-items:baseline;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }
        .title h2{
          margin:0;
          font-family: var(--serif);
          font-size: 18px;
          letter-spacing: 0.4px;
          color: #b02a31;
        }
        .badge{
          font-family: var(--mono);
          font-size: 12px;
          padding: 5px 10px;
          border-radius: 999px;
          background: rgba(62, 110, 76, 0.16);
          border: 1px solid rgba(62, 110, 76, 0.32);
          color: rgba(51, 91, 63, 0.9);
          white-space: nowrap;
        }

        .decoded{
          font-size: 15px;
          line-height: 1.45;
          display: grid;
          gap: 10px;
        }

        .hiddenMessage{
          font-size: 14px;
          color: rgba(109, 73, 51, 0.85);
        }

        .wordStream{
          display:flex;
          flex-wrap: wrap;
          gap: 8px 10px;
        }

        .decodedWord{
          position: relative;
          display:inline-flex;
          align-items:center;
          padding: 3px 8px;
          border-radius: 12px;
          border: 1px dashed rgba(199, 47, 56, 0.35);
          background: rgba(255,255,255,0.65);
          color: rgba(109, 73, 51, 0.8);
          pointer-events: none;
          filter: blur(6px);
          opacity: 0.6;
          transition: filter 160ms ease, opacity 160ms ease, color 160ms ease, background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
        }

        .decodedWord::after{
          content: "";
        }

        .decodedWord.revealed{
          filter: none;
          opacity: 1;
          background: rgba(62, 110, 76, 0.18);
          border-color: rgba(62, 110, 76, 0.45);
          color: var(--accent);
          box-shadow: 0 10px 18px rgba(62, 110, 76, 0.18);
        }

        .decodedWord.revealed strong{
          color: inherit;
        }

        .revealRow{
          display:flex;
          align-items:center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .revealRow button{
          flex: 0 0 auto;
          padding: 10px 16px;
        }

        .morse{
          font-family: var(--mono);
          font-size: 13px;
          line-height: 1.6;
          word-break: break-word;
          background: rgba(255,255,255,0.78);
          border-radius: 14px;
          padding: 12px;
          border: 1px solid rgba(109, 73, 51, 0.28);
          box-shadow: inset 0 0 22px rgba(255, 235, 210, 0.8);
        }

        .cell{
          display:inline-block;
          padding: 2px 5px;
          margin: 1px 3px;
          border-radius: 10px;
          border: 1px solid rgba(199, 47, 56, 0.28);
          background: rgba(199, 47, 56, 0.12);
          transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
        }
        .cell.active{
          background: rgba(199, 47, 56, 0.32);
          border-color: rgba(199, 47, 56, 0.6);
          transform: translateY(-1px);
          box-shadow: 0 12px 20px rgba(199, 47, 56, 0.24);
        }
        .wordgap{
          display:inline-block;
          width: 12px;
        }

        .controls{
          display:grid;
          gap: 12px;
        }

        .guess{
          display:grid;
          gap: 10px;
        }

        .guess label{
          font-size: 13px;
          color: rgba(109, 73, 51, 0.85);
        }

        .guess input[type="text"]{
          appearance: none;
          padding: 11px 14px;
          border-radius: 16px;
          border: 1px solid rgba(109, 73, 51, 0.35);
          background: rgba(255,255,255,0.88);
          color: var(--text);
          font-size: 14px;
          box-shadow: inset 0 2px 6px rgba(0,0,0,0.05);
        }

        .guess input[type="text"]:focus{
          outline: none;
          border-color: rgba(62, 110, 76, 0.55);
          box-shadow: 0 0 0 3px rgba(62, 110, 76, 0.25);
        }

        .guess .guessControls{
          display:flex;
          align-items:center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .guess .guessControls input[type="text"]{
          flex: 1 1 220px;
          min-width: 160px;
        }

        .guess .guessControls button{
          padding: 11px 18px;
        }

        .hint.success{
          color: rgba(63, 143, 99, 0.9);
        }

        .hint.error{
          color: rgba(179, 57, 57, 0.9);
        }

        .modalBackdrop{
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(43, 24, 12, 0.55);
          backdrop-filter: blur(4px);
          z-index: 20;
          padding: 20px;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition: opacity 180ms ease, visibility 180ms ease;
        }

        .modalBackdrop.show{
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
        }

        .modal{
          width: min(420px, 100%);
          background: linear-gradient(150deg, rgba(255,255,255,0.96), rgba(255, 238, 216, 0.9));
          border-radius: var(--radius);
          padding: 24px;
          border: 2px solid rgba(199, 47, 56, 0.25);
          box-shadow: 0 24px 45px rgba(0,0,0,0.25);
        }

        .modal h3{
          margin: 0 0 12px 0;
          font-size: 19px;
          color: #b02a31;
          font-family: var(--serif);
        }

        .modal p{
          margin: 0 0 18px 0;
          font-size: 14px;
          color: rgba(109, 73, 51, 0.85);
        }

        .modalActions{
          display:flex;
          align-items:center;
          justify-content:flex-end;
          gap: 12px;
          flex-wrap: wrap;
        }

        .modalActions button{
          padding: 11px 18px;
        }

        .modalBackdrop[hidden]{
          display: none !important;
        }

        .confettiLayer{
          position:absolute;
          inset:0;
          pointer-events:none;
          overflow:visible;
          z-index:25;
        }

        .confettiBatch{
          position:absolute;
          inset:0;
        }

        .confettiPiece{
          position:absolute;
          top:-12%;
          width: var(--confetti-size, 10px);
          height: calc(var(--confetti-size, 10px) * 0.65);
          border-radius: 3px;
          background: var(--confetti-color, #ffffff);
          opacity: 0;
          animation: confettiFall var(--confetti-duration, 2.8s) linear forwards;
          animation-delay: var(--confetti-delay, 0s);
        }

        .confettiPiece.is-circle{
          border-radius: 999px;
          height: var(--confetti-size, 10px);
        }

        @keyframes confettiFall{
          0%{
            top: -12%;
            transform: translateX(0px) rotate(0deg);
            opacity: 0;
          }
          10%{
            opacity: 1;
          }
          100%{
            top: 112%;
            transform: translateX(var(--confetti-sway, 0px)) rotate(var(--confetti-rotate, 720deg));
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce){
          .confettiLayer{
            display: none;
          }
        }

        button{
          appearance: none;
          border: 1px solid rgba(199, 47, 56, 0.35);
          background: linear-gradient(145deg, rgba(255,255,255,0.85), rgba(255, 223, 207, 0.85));
          color: var(--accent);
          border-radius: 999px;
          padding: 12px 18px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
          box-shadow: 0 10px 18px rgba(0,0,0,0.08);
        }
        button:active{ transform: translateY(1px) scale(0.99); }
        button:hover{ box-shadow: 0 16px 26px rgba(0,0,0,0.15); }
        button.primary{
          background: linear-gradient(145deg, rgba(62, 110, 76, 0.2), rgba(62, 110, 76, 0.36));
          border-color: rgba(62, 110, 76, 0.45);
          color: #1f4f33;
        }
        button.danger{
          background: linear-gradient(145deg, rgba(199, 47, 56, 0.24), rgba(199, 47, 56, 0.34));
          border-color: rgba(199, 47, 56, 0.55);
          color: #5f0e16;
        }

        .sliders{
          display:grid;
          gap: 14px;
        }
        .field{
          display:grid;
          gap: 6px;
        }
        .field label{
          font-size: 12px;
          color: rgba(109, 73, 51, 0.85);
          display:flex;
          align-items:center;
          justify-content: space-between;
          gap: 10px;
        }
        .val{
          font-family: var(--mono);
          font-size: 12px;
          color: rgba(51, 91, 63, 0.95);
          padding: 2px 10px;
          border-radius: 999px;
          background: rgba(62, 110, 76, 0.15);
          border: 1px solid rgba(62, 110, 76, 0.32);
        }
        input[type="range"]{
          width: 100%;
          accent-color: #c72f38;
        }

        .progressRow{
          display:flex;
          align-items:center;
          gap: 12px;
        }
        progress{
          width: 100%;
          height: 12px;
          border-radius: 999px;
          overflow: hidden;
          background: rgba(199, 47, 56, 0.12);
          border: 1px solid rgba(199, 47, 56, 0.28);
        }
        progress::-webkit-progress-bar{
          background: rgba(255,255,255,0.85);
        }
        progress::-webkit-progress-value{
          background: linear-gradient(90deg, rgba(199, 47, 56, 0.75), rgba(62, 110, 76, 0.75));
        }
        progress::-moz-progress-bar{
          background: linear-gradient(90deg, rgba(199, 47, 56, 0.75), rgba(62, 110, 76, 0.75));
        }

        .hint{
          color: rgba(109, 73, 51, 0.8);
          font-size: 12px;
          margin-top: 6px;
        }

        @media (max-width: 520px){
          .card{ padding: 14px; }
          .card::before{ inset: 10px; }
          .content{ padding: 20px 16px; }
        }

        @media (min-width: 760px){
          .content{ padding: 30px 26px; }
          .grid{
            grid-template-columns: 1.25fr 0.75fr;
            align-items: start;
          }
          button{ padding: 12px 20px; }
        }
      </style>

      <section class="card" aria-label="Morse Player Card">
        <div class="confettiLayer" id="confettiLayer" aria-hidden="true"></div>
        <div class="minimizedNotice" id="minimizedNotice" hidden aria-hidden="true">
          <h3>Message decoded!</h3>
          <p>The gallery is now open. Scroll down to enjoy the memories.</p>
          <button id="restoreBtn" type="button">Reopen puzzle</button>
        </div>
        <div class="content" id="cardContent" aria-hidden="false">
          <div class="grid">
            <div class="panel">
              <div class="title">
                <h2>Decoded message</h2>
                <span class="badge">Morse → Text</span>
              </div>
              <div class="decoded" id="decodedContainer">
                <div class="hiddenMessage" id="hiddenMessage">Message hidden. Decode it yourself or reveal it.</div>
                <div class="wordStream" id="decodedWords" hidden aria-live="polite"></div>
                <div class="revealRow">
                  <button id="revealBtn" type="button">Reveal message</button>
                  <span class="hint" id="revealHint">Reveal shows the answer instantly.</span>
                </div>
              </div>

              <div class="title" style="margin-top:12px;">
                <h2>Morse being sent</h2>
                <span class="badge" id="timingBadge"></span>
              </div>
              <div class="morse" id="morseView" aria-label="Morse sequence"></div>

              <div class="progressRow" style="margin-top:10px;">
                <progress max="1" value="0"></progress>
              </div>
              <div class="hint">Highlight follows the character currently being keyed.</div>
            </div>

            <div class="panel">
              <div class="title">
                <h2>Controls</h2>
                <span class="badge">Web Audio</span>
              </div>

              <div class="controls">
                <div class="row">
                  <button class="primary" id="playBtn" type="button">Play</button>
                  <button class="danger" id="stopBtn" type="button">Stop</button>
                </div>

                <div class="guess" id="guessSection">
                  <label for="guessInput">Your decoded text guess</label>
                  <div class="guessControls">
                    <input id="guessInput" type="text" aria-describedby="guessStatus" placeholder="Type what you think it says" />
                    <button id="guessBtn" type="button">Check guess</button>
                  </div>
                  <p class="hint" id="guessStatus" role="status" aria-live="polite"></p>
                </div>

                <div class="sliders">
                  <div class="field">
                    <label>
                      <span>WPM (character speed)</span>
                      <span class="val" id="wpmVal">20</span>
                    </label>
                    <input id="wpm" type="range" min="5" max="60" step="1" value="20" />
                  </div>

                  <div class="field">
                    <label>
                      <span>Farnsworth WPM (spacing)</span>
                      <span class="val" id="fwVal">20</span>
                    </label>
                    <input id="fw" type="range" min="5" max="60" step="1" value="20" />
                  </div>

                  <div class="field">
                    <label>
                      <span>Tone</span>
                      <span class="val" id="toneVal">550 Hz</span>
                    </label>
                    <input id="tone" type="range" min="200" max="1200" step="1" value="550" />
                  </div>

                  <div class="field">
                    <label>
                      <span>Volume</span>
                      <span class="val" id="volVal">80%</span>
                    </label>
                    <input id="vol" type="range" min="0" max="100" step="1" value="80" />
                  </div>
                </div>
              </div>

              <div class="hint" style="margin-top:10px;">
                Changing settings while playing will continue from the current character (approx).
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="modalBackdrop" id="revealModal" hidden>
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="revealModalTitle" aria-describedby="revealModalBody">
          <h3 id="revealModalTitle">Reveal the full message?</h3>
          <p id="revealModalBody">Revealing will show every word without solving it manually. Are you sure you want to unblur the entire message?</p>
          <div class="modalActions">
            <button id="modalCancel" type="button">Keep guessing</button>
            <button class="danger" id="modalConfirm" type="button">Reveal message</button>
          </div>
        </div>
      </div>
    `;
  }

  _wire() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);

    this._decodedWords = $("#decodedWords");
    this._hiddenMessageEl = $("#hiddenMessage");
    this._revealBtn = $("#revealBtn");
    this._revealHint = $("#revealHint");
    this._guessInput = $("#guessInput");
    this._guessBtn = $("#guessBtn");
    this._guessStatus = $("#guessStatus");
    this._revealModal = $("#revealModal");
    this._modalConfirm = $("#modalConfirm");
    this._modalCancel = $("#modalCancel");
    this._confettiLayer = $("#confettiLayer");
    this._cardSection = this.shadowRoot.querySelector(".card");
    this._cardContent = $("#cardContent");
    this._minimizedNotice = $("#minimizedNotice");
    this._restoreBtn = $("#restoreBtn");

    const playBtn = $("#playBtn");
    const stopBtn = $("#stopBtn");

    const wpm = $("#wpm");
    const fw = $("#fw");
    const tone = $("#tone");
    const vol = $("#vol");

    const updateLabels = () => {
      $("#wpmVal").textContent = String(wpm.value);
      $("#fwVal").textContent = String(fw.value);
      $("#toneVal").textContent = `${tone.value} Hz`;
      $("#volVal").textContent = `${vol.value}%`;
    };

    const applySettings = (maybeResume = true) => {
      // remember current active span so we can resume from that char
      const activeSpan = this._currentSpan;

      this.state.wpm = Number(wpm.value);
      this.state.farnsworth = Number(fw.value);
      this.state.toneHz = Number(tone.value);
      this.state.volume = Number(vol.value);

      this._refreshTimingBadge();

      // If playing, pause then reschedule from current char
      if (this.engine.isPlaying) {
        this.engine.pause();

        // compute a best-effort offset: jump to the start of the current highlighted span
        const offset = this._offsetAtSpan(activeSpan);
        this._scheduleFromOffset(offset);
        this._setPlayingUI(true);
      } else if (maybeResume === false) {
        // nothing
      }
    };

    const onInput = () => {
      updateLabels();
      applySettings(true);
    };

    wpm.addEventListener("input", onInput);
    fw.addEventListener("input", onInput);
    tone.addEventListener("input", onInput);
    vol.addEventListener("input", onInput);

    updateLabels();
    this._resetGuessUI();
    this._updateDecodeVisibility();

    const handleReveal = () => {
      if (this.state.revealed) return;
      this._openRevealModal();
    };

    if (this._revealBtn) {
      this._revealBtn.addEventListener("click", handleReveal);
    }

    const submitGuess = () => {
      if (!this._guessInput) return;
      const raw = this._guessInput.value.trim();
      if (!raw) {
        this._setGuessStatus("Enter your guess before checking.", "error");
        return;
      }
      this._processGuess(raw);
    };

    if (this._guessBtn) {
      this._guessBtn.addEventListener("click", submitGuess);
    }

    if (this._guessInput) {
      this._guessInput.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          submitGuess();
        }
      });
    }

    if (this._modalCancel) {
      this._modalCancel.addEventListener("click", () =>
        this._closeRevealModal()
      );
    }

    if (this._modalConfirm) {
      this._modalConfirm.addEventListener("click", () => this._confirmReveal());
    }

    if (this._revealModal) {
      this._revealModal.addEventListener("click", (evt) => {
        if (evt.target === this._revealModal) {
          this._closeRevealModal();
        }
      });
    }

    this.shadowRoot.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape" && this.state.showRevealModal) {
        evt.preventDefault();
        this._closeRevealModal();
      }
    });

    if (this._restoreBtn) {
      this._restoreBtn.addEventListener("click", () => this.restore());
    }

    this._setMinimized(this.classList.contains("minimized"));

    this._applyModalState();

    playBtn.addEventListener("click", async () => {
      // Audio contexts require a user gesture to start/resume
      this.engine._ensureContext();
      if (this.engine.ctx.state === "suspended") {
        await this.engine.ctx.resume();
      }

      if (this.engine.isPlaying) {
        this.engine.pause();
        this._setPlayingUI(false);
        this._setActiveSpan(-1);
      } else {
        // resume from pause offset
        this.engine.resume((offset) => this._scheduleFromOffset(offset));
        this._setPlayingUI(true);
      }
    });

    stopBtn.addEventListener("click", () => {
      this.engine.stop();
      this._setPlayingUI(false);
      this._setActiveSpan(-1);
      const prog = this.shadowRoot.querySelector("progress");
      if (prog) prog.value = 0;
    });
  }

  _refresh() {
    // Rebuild UI spans and (if playing) reschedule from current spot
    const view = this.shadowRoot.querySelector("#morseView");
    if (!view) return;

    // decode update
    this._resetGuessUI();
    this._renderDecodedWords();
    this._updateDecodeVisibility();
    this._applyModalState();

    // build spans
    const { spans } = buildTimeline(this.state.morse, {
      wpm: this.state.wpm,
      farnsworth: this.state.farnsworth,
    });
    this._spansMeta = spans;

    view.innerHTML = "";
    this._spanEls = [];
    let spanIdx = 0;

    // Render by words/letters to match spacing
    const words = this.state.morse
      .trim()
      .split(" / ")
      .map((w) => w.trim())
      .filter(Boolean);
    for (let wi = 0; wi < words.length; wi++) {
      const letters = words[wi].split(" ").filter(Boolean);
      for (let li = 0; li < letters.length; li++) {
        const code = letters[li];
        const span = document.createElement("span");
        span.className = "cell";
        span.textContent = code;
        span.dataset.idx = String(spanIdx);
        view.appendChild(span);
        this._spanEls.push(span);
        spanIdx++;
      }
      if (wi !== words.length - 1) {
        const gap = document.createElement("span");
        gap.className = "wordgap";
        gap.textContent = " ";
        view.appendChild(gap);
      }
    }

    this._refreshTimingBadge();
  }

  _refreshTimingBadge() {
    const badge = this.shadowRoot.querySelector("#timingBadge");
    if (!badge) return;
    const { dot, scale } = buildTimeline(this.state.morse, {
      wpm: this.state.wpm,
      farnsworth: this.state.farnsworth,
    });
    badge.textContent = `dot=${(dot * 1000).toFixed(
      0
    )}ms • spacing×${scale.toFixed(2)}`;
  }

  _setPlayingUI(isPlaying) {
    const playBtn = this.shadowRoot.querySelector("#playBtn");
    if (playBtn) playBtn.textContent = isPlaying ? "Pause" : "Play";
  }

  _setActiveSpan(idx) {
    if (this._currentSpan === idx) return;

    if (this._currentSpan >= 0 && this._spanEls[this._currentSpan]) {
      this._spanEls[this._currentSpan].classList.remove("active");
    }
    this._currentSpan = idx;
    if (idx >= 0 && this._spanEls[idx]) {
      this._spanEls[idx].classList.add("active");
      // keep it in view on small screens
      this._spanEls[idx].scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });
    }
  }

  _offsetAtSpan(spanIdx) {
    if (spanIdx == null || spanIdx < 0) return this.engine.offsetSec || 0;

    // Rebuild timeline and find first event for that span
    const { timeline } = buildTimeline(this.state.morse, {
      wpm: this.state.wpm,
      farnsworth: this.state.farnsworth,
    });
    let t = 0;
    for (const item of timeline) {
      if (item.type === "tone" && item.spanIndex === spanIdx) {
        return t; // start time of first tone in that character
      }
      t += item.dur;
    }
    return this.engine.offsetSec || 0;
  }

  _scheduleFromOffset(offsetSec) {
    const settings = {
      wpm: this.state.wpm,
      farnsworth: this.state.farnsworth,
      toneHz: this.state.toneHz,
      volume01: clamp((this.state.volume ?? 80) / 100, 0, 1),
    };

    const { timeline } = buildTimeline(this.state.morse, settings);
    this.engine.schedule(timeline, settings, offsetSec);
  }

  _updateDecodeVisibility() {
    const totalWords = this._wordData.length;
    if (this.state.revealed && totalWords) {
      const revealAll = new Set();
      for (let i = 0; i < totalWords; i++) {
        revealAll.add(i);
      }
      this._revealedWordIndices = revealAll;
    }

    const anyRevealed =
      this.state.revealed || this._revealedWordIndices.size > 0;

    if (this._decodedWords) {
      this._decodedWords.hidden = !anyRevealed;
      this._wordData.forEach((word, idx) => {
        if (!word.span) return;
        const revealed =
          this.state.revealed || this._revealedWordIndices.has(idx);
        word.span.classList.toggle("revealed", revealed);
      });
    }

    if (this._hiddenMessageEl) {
      this._hiddenMessageEl.hidden = anyRevealed ? true : false;
    }

    if (this._revealBtn) {
      this._revealBtn.disabled = this.state.revealed;
      this._revealBtn.setAttribute(
        "aria-pressed",
        this.state.revealed ? "true" : "false"
      );
    }

    if (this._revealHint) {
      if (this.state.revealed) {
        this._revealHint.textContent = "Answer visible above.";
      } else if (this._revealedWordIndices.size > 0) {
        this._revealHint.textContent =
          "Correct words stay sharp; others stay blurred.";
      } else {
        this._revealHint.textContent = "Reveal shows the answer instantly.";
      }
    }

    if (
      this.state.revealed &&
      !this._hasCelebrated &&
      totalWords &&
      this._revealedWordIndices.size >= totalWords
    ) {
      this._triggerCelebration();
    }
  }

  _renderDecodedWords() {
    if (!this._decodedWords) return;

    const words = this._splitIntoWords(this.state.decoded);
    this._wordData = words.map((raw) => ({
      raw,
      normalized: this._normalizeWord(raw),
      span: null,
    }));

    this._decodedWords.innerHTML = "";
    this._wordData.forEach((word, idx) => {
      const span = document.createElement("span");
      span.className = "decodedWord";
      span.textContent = word.raw;
      this._decodedWords.appendChild(span);
      this._wordData[idx].span = span;
    });

    const updated = new Set();
    this._revealedWordIndices.forEach((idx) => {
      if (idx < this._wordData.length) {
        updated.add(idx);
      }
    });
    this._revealedWordIndices = updated;
  }

  _processGuess(raw) {
    const attempt = raw.trim();
    if (!attempt) {
      this._setGuessStatus("Enter your guess before checking.", "error");
      return;
    }

    const target = this._normalizeText(this.state.decoded);
    const attemptNorm = this._normalizeText(attempt);

    if (attemptNorm && attemptNorm === target) {
      this._revealAllWords(true);
      this._setGuessStatus("Great job! You decoded it.", "success");
      return;
    }

    const guessWords = attempt
      .split(/\s+/)
      .map((part) => this._normalizeWord(part))
      .filter(Boolean);

    if (!guessWords.length) {
      this._setGuessStatus(
        "Try entering a whole word from the message.",
        "error"
      );
      return;
    }

    const guessSet = new Set(guessWords);
    const matchedIndices = [];

    this._wordData.forEach((word, idx) => {
      if (!word.normalized) return;
      if (guessSet.has(word.normalized)) {
        matchedIndices.push(idx);
      }
    });

    if (!matchedIndices.length) {
      this._setGuessStatus("No matching words found. Keep trying!", "error");
      return;
    }

    this._revealWordIndices(matchedIndices);

    if (this._isFullyRevealed()) {
      this.state.revealed = true;
      this._updateDecodeVisibility();
      this._triggerCelebration();
      this._setGuessStatus("Great job! You decoded it.", "success");
      return;
    }

    const uniqueWords = Array.from(
      new Set(matchedIndices.map((idx) => this._wordData[idx].raw.trim()))
    ).filter(Boolean);

    this._setGuessStatus(
      `Nice! Revealed ${uniqueWords.join(", ")}.`,
      "success"
    );
  }

  _openRevealModal() {
    const globalDoc = typeof document !== "undefined" ? document : null;
    this._modalFocusRestore =
      this.shadowRoot.activeElement || globalDoc?.activeElement || null;
    this.state.showRevealModal = true;
    this._applyModalState();
  }

  _closeRevealModal() {
    this.state.showRevealModal = false;
    this._applyModalState();
  }

  _confirmReveal() {
    if (this.state.revealed) {
      this._closeRevealModal();
      return;
    }
    this._hasCelebrated = true;
    this._revealAllWords();
    this._setGuessStatus("Message revealed.");
    this._closeRevealModal();
  }

  _applyModalState() {
    if (!this._revealModal) return;
    const show = !!this.state.showRevealModal;
    this._revealModal.hidden = !show;
    this._revealModal.classList.toggle("show", show);
    this._revealModal.setAttribute("aria-hidden", show ? "false" : "true");
    if (show) {
      requestAnimationFrame(() => {
        if (this._modalConfirm) {
          this._modalConfirm.focus({ preventScroll: true });
        }
      });
    } else if (this._modalFocusRestore && this._modalFocusRestore.focus) {
      requestAnimationFrame(() => {
        try {
          this._modalFocusRestore.focus({ preventScroll: true });
        } catch (err) {
          // ignore focus errors (element might be gone)
        }
        this._modalFocusRestore = null;
      });
    }
  }

  _revealAllWords(celebrate = false) {
    const indices = [];
    for (let i = 0; i < this._wordData.length; i++) {
      indices.push(i);
    }
    this._revealWordIndices(indices);
    this.state.revealed = true;
    this._updateDecodeVisibility();
    if (celebrate) {
      this._triggerCelebration();
    }
  }

  _revealWordIndices(indices) {
    let changed = false;
    indices.forEach((idx) => {
      if (!this._revealedWordIndices.has(idx)) {
        this._revealedWordIndices.add(idx);
        changed = true;
      }
    });
    if (changed) {
      this._updateDecodeVisibility();
    }
  }

  _isFullyRevealed() {
    return (
      this._wordData.length > 0 &&
      this._revealedWordIndices.size >= this._wordData.length
    );
  }

  _splitIntoWords(text) {
    if (!text) return [];
    return text.split(/\s+/).filter(Boolean);
  }

  _resetGuessUI() {
    if (this._guessInput) {
      this._guessInput.value = "";
    }
    this._setGuessStatus("");
  }

  _setGuessStatus(message, kind) {
    if (!this._guessStatus) return;
    this._guessStatus.textContent = message || "";
    this._guessStatus.classList.toggle("success", kind === "success");
    this._guessStatus.classList.toggle("error", kind === "error");
  }

  _triggerCelebration() {
    if (this._hasCelebrated) return;
    this._hasCelebrated = true;
    this._setMinimized(true);
    this._launchConfetti();
    this.dispatchEvent(
      new CustomEvent("morse-solved", { bubbles: true, composed: true })
    );
  }

  minimize() {
    this._setMinimized(true);
  }

  restore() {
    this._setMinimized(false);
    if (this._guessInput) {
      this._guessInput.focus({ preventScroll: true });
    }
  }

  _setMinimized(minimize) {
    const minimized = !!minimize;
    if (minimized) {
      this.classList.add("minimized");
      this.setAttribute("data-minimized", "true");
    } else {
      this.classList.remove("minimized");
      this.removeAttribute("data-minimized");
    }

    if (this._cardSection) {
      this._cardSection.classList.toggle("minimized", minimized);
    }

    if (this._cardContent) {
      this._cardContent.hidden = minimized;
      this._cardContent.setAttribute(
        "aria-hidden",
        minimized ? "true" : "false"
      );
    }

    if (this._minimizedNotice) {
      if (minimized) {
        this._minimizedNotice.hidden = false;
        this._minimizedNotice.removeAttribute("hidden");
        this._minimizedNotice.setAttribute("aria-hidden", "false");
        requestAnimationFrame(() => {
          if (this._restoreBtn) {
            this._restoreBtn.focus({ preventScroll: true });
          }
        });
      } else {
        this._minimizedNotice.hidden = true;
        this._minimizedNotice.setAttribute("hidden", "");
        this._minimizedNotice.setAttribute("aria-hidden", "true");
      }
    }
  }

  _launchConfetti() {
    if (!this._confettiLayer) return;
    if (this._prefersReducedMotion()) return;
    const win = typeof window !== "undefined" ? window : null;
    if (!win) return;

    const batch = document.createElement("div");
    batch.className = "confettiBatch";

    const colors = ["#c72f38", "#f5c75a", "#2f855a", "#ffffff"]; // festive palette
    const count = 60;

    for (let i = 0; i < count; i++) {
      const piece = document.createElement("span");
      piece.className = "confettiPiece";
      if (Math.random() < 0.3) {
        piece.classList.add("is-circle");
      }

      const size = (6 + Math.random() * 6).toFixed(1);
      const duration = (2.4 + Math.random() * 1.4).toFixed(2);
      const delay = (Math.random() * 0.6).toFixed(2);
      const sway = (Math.random() * 80 - 40).toFixed(1);
      const rotation = (360 + Math.random() * 720).toFixed(0);
      const color = colors[Math.floor(Math.random() * colors.length)];

      piece.style.setProperty("--confetti-size", `${size}px`);
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.setProperty("--confetti-color", color);
      piece.style.setProperty("--confetti-duration", `${duration}s`);
      piece.style.setProperty("--confetti-delay", `${delay}s`);
      piece.style.setProperty("--confetti-sway", `${sway}px`);
      piece.style.setProperty("--confetti-rotate", `${rotation}deg`);

      batch.appendChild(piece);
    }

    this._confettiLayer.appendChild(batch);

    win.setTimeout(() => {
      batch.remove();
    }, 4000);
  }

  _prefersReducedMotion() {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  _normalizeWord(word) {
    return (word || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  _normalizeText(text) {
    return this._normalizeWord(text).trim();
  }
}

customElements.define("morse-player", MorsePlayer);

class PhotoGallery extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._photos = [];
  }

  static get observedAttributes() {
    return ["data-images"];
  }

  connectedCallback() {
    this._applyHiddenState();
    this._hydratePhotos(this.getAttribute("data-images"));
    this._render();
  }

  attributeChangedCallback(name, _oldVal, newVal) {
    if (name === "data-images") {
      this._hydratePhotos(newVal);
      this._render();
    }
  }

  reveal() {
    if (!this.hasAttribute("hidden")) return;
    this.removeAttribute("hidden");
    this.classList.add("is-visible");
  }

  _applyHiddenState() {
    if (!this.hasAttribute("hidden")) {
      this.setAttribute("hidden", "");
    }
  }

  _hydratePhotos(raw) {
    if (!raw) {
      this._photos = [
        {
          src: "images/festive-card.png",
          alt: "Festive holiday postcard illustration",
          title: "Holiday Keepsake",
          description:
            "Pappy's treasured Morse card framed for our family album.",
        },
      ];
      return;
    }

    const parsed = raw
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [src, title = "", description = "", alt = ""] = entry
          .split("|")
          .map((part) => part.trim());
        return {
          src,
          title: title || "Holiday memory",
          description: description || "",
          alt: alt || title || "Gallery photo",
        };
      })
      .filter((item) => !!item.src);

    this._photos = parsed.length ? parsed : this._photos;
  }

  _render() {
    const photos = this._photos;
    this.shadowRoot.innerHTML = `
      <style>
        :host{
          display:block;
          margin: 40px auto 0;
          max-width: 900px;
          padding: 0 20px 40px;
        }

        :host([hidden]){
          display:none !important;
        }

        :host(.is-visible) .gallery{
          animation: galleryReveal 420ms ease-out forwards;
        }

        h2{
          font-family: var(--serif, 'Cormorant Garamond', serif);
          font-size: 28px;
          color: #b02a31;
          text-align:center;
          margin: 0 0 12px 0;
        }

        p.lead{
          text-align:center;
          color: rgba(109, 73, 51, 0.82);
          margin: 0 0 26px 0;
          font-size: 15px;
        }

        .gallery{
          display:grid;
          gap: 16px;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          opacity: 0;
          transform: translateY(12px);
        }

        figure{
          margin:0;
          background: linear-gradient(160deg, rgba(255,255,255,0.94), rgba(255,237,216,0.86));
          border-radius: 18px;
          padding: 14px;
          border: 1px solid rgba(199, 47, 56, 0.24);
          box-shadow: 0 16px 28px rgba(0,0,0,0.08);
          display:flex;
          flex-direction:column;
          gap: 12px;
        }

        img{
          width:100%;
          height: 180px;
          object-fit: cover;
          border-radius: 12px;
          border: 2px solid rgba(62, 110, 76, 0.32);
          background: rgba(62,110,76,0.08);
        }

        figcaption{
          display:grid;
          gap:6px;
        }

        figcaption strong{
          font-family: var(--serif, 'Cormorant Garamond', serif);
          font-size: 18px;
          color: #2f4f3a;
        }

        figcaption span{
          font-size: 13px;
          color: rgba(109, 73, 51, 0.78);
          line-height: 1.5;
        }

        @keyframes galleryReveal{
          0%{
            opacity: 0;
            transform: translateY(12px);
          }
          100%{
            opacity: 1;
            transform: translateY(0);
          }
        }
      </style>
      <section aria-label="Family photo gallery">
        <h2>Holiday Photo Gallery</h2>
        <p class="lead">A peek behind the scenes once the Morse puzzle is cracked.</p>
        <div class="gallery">
          ${photos
            .map(
              (photo) => `
                <figure>
                  <img src="${photo.src}" alt="${photo.alt}" loading="lazy" />
                  <figcaption>
                    <strong>${photo.title}</strong>
                    <span>${photo.description}</span>
                  </figcaption>
                </figure>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }
}

customElements.define("photo-gallery", PhotoGallery);

class PrizeModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._rendered = false;
    this._handleKeydown = this._handleKeydown.bind(this);
    this._hideAfterTransition = this._hideAfterTransition.bind(this);
    this._hideTimer = null;
    this._previousFocus = null;
  }

  connectedCallback() {
    if (!this._rendered) {
      this._render();
      this._rendered = true;
    }
  }

  show(message = "See Benny Boo For Your Prize") {
    if (!this._rendered) {
      this._render();
    }
    if (this._hideTimer && typeof window !== "undefined") {
      window.clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    this._setMessage(message);
    this.removeAttribute("hidden");
    if (this._backdrop) this._backdrop.classList.add("show");
    if (this._dialog) this._dialog.classList.add("show");
    this._previousFocus =
      (typeof document !== "undefined" && document.activeElement) || null;
    requestAnimationFrame(() => {
      if (this._closeBtn) {
        this._closeBtn.focus({ preventScroll: true });
      }
    });
    if (typeof document !== "undefined") {
      document.addEventListener("keydown", this._handleKeydown);
    }
  }

  hide() {
    if (!this._rendered || this.hasAttribute("hidden")) return;
    if (this._backdrop) this._backdrop.classList.remove("show");
    if (this._dialog) this._dialog.classList.remove("show");
    if (typeof document !== "undefined") {
      document.removeEventListener("keydown", this._handleKeydown);
    }
    if (typeof window !== "undefined") {
      this._hideTimer = window.setTimeout(this._hideAfterTransition, 220);
    } else {
      this._hideAfterTransition();
    }
  }

  _hideAfterTransition() {
    this._hideTimer = null;
    this.setAttribute("hidden", "");
    if (this._previousFocus && this._previousFocus.focus) {
      try {
        this._previousFocus.focus({ preventScroll: true });
      } catch (err) {
        // ignore focus errors if element is gone
      }
    }
    this._previousFocus = null;
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host{
          position: fixed;
          inset: 0;
          display: none;
          z-index: 60;
        }

        :host(:not([hidden])){
          display: block;
        }

        .backdrop{
          position: absolute;
          inset: 0;
          background: rgba(33, 20, 12, 0.65);
          backdrop-filter: blur(3px);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          visibility: hidden;
          transition: opacity 200ms ease, visibility 200ms ease;
        }

        .backdrop.show{
          opacity: 1;
          visibility: visible;
        }

        .dialog{
          background: linear-gradient(150deg, rgba(255,255,255,0.97), rgba(255, 235, 214, 0.92));
          border-radius: 18px;
          padding: 26px;
          border: 2px solid rgba(199, 47, 56, 0.35);
          box-shadow: 0 30px 45px rgba(0,0,0,0.22);
          width: min(360px, 88%);
          text-align: center;
          transform: translateY(10px) scale(0.95);
          opacity: 0;
          transition: transform 200ms ease, opacity 200ms ease;
        }

        .dialog.show{
          transform: translateY(0) scale(1);
          opacity: 1;
        }

        h3{
          margin: 0 0 12px 0;
          font-family: var(--serif, 'Cormorant Garamond', serif);
          font-size: 22px;
          color: #b02a31;
        }

        p{
          margin: 0 0 18px 0;
          font-size: 15px;
          color: rgba(109, 73, 51, 0.88);
        }

        button{
          padding: 11px 22px;
        }
      </style>
      <div class="backdrop" part="backdrop">
        <div class="dialog" part="dialog" role="dialog" aria-modal="true" aria-labelledby="prizeTitle" aria-describedby="prizeMessage">
          <h3 id="prizeTitle">Puzzle Complete!</h3>
          <p id="prizeMessage">See Benny Boo For Your Prize</p>
          <button type="button" id="prizeClose">Got it!</button>
        </div>
      </div>
    `;

    this._backdrop = this.shadowRoot.querySelector(".backdrop");
    this._dialog = this.shadowRoot.querySelector(".dialog");
    this._messageEl = this.shadowRoot.querySelector("#prizeMessage");
    this._closeBtn = this.shadowRoot.querySelector("#prizeClose");

    if (this._backdrop) {
      this._backdrop.addEventListener("click", (evt) => {
        if (evt.target === this._backdrop) {
          this.hide();
        }
      });
    }

    if (this._closeBtn) {
      this._closeBtn.addEventListener("click", () => this.hide());
    }
  }

  _setMessage(msg) {
    if (this._messageEl) {
      this._messageEl.textContent = msg;
    }
  }

  _handleKeydown(evt) {
    if (evt.key === "Escape") {
      evt.preventDefault();
      this.hide();
    }
  }
}

customElements.define("prize-modal", PrizeModal);

if (typeof document !== "undefined") {
  document.addEventListener("morse-solved", () => {
    const player = document.querySelector("morse-player");
    if (player && typeof player.minimize === "function") {
      player.minimize();
    }
    const gallery = document.querySelector("photo-gallery");
    if (gallery && typeof gallery.reveal === "function") {
      gallery.reveal();
    }
    const prize = document.querySelector("prize-modal");
    if (prize && typeof prize.show === "function") {
      prize.show("See Benny Boo For Your Prize");
    }
  });
}
