let ctx = null;
let noiseBuffer = null;

function ensureContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

export function primeAudio() {
  ensureContext();
}

function getNoiseBuffer(context) {
  if (noiseBuffer) return noiseBuffer;
  const length = Math.floor(context.sampleRate * 0.3);
  noiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function tone(context, { freq, start, duration, type = "sine", gain = 0.2, endFreq }) {
  const osc = context.createOscillator();
  const gainNode = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
  }
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.linearRampToValueAtTime(gain, start + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gainNode);
  gainNode.connect(context.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function playTear() {
  const context = ensureContext();
  const now = context.currentTime;

  const noise = context.createBufferSource();
  noise.buffer = getNoiseBuffer(context);

  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1200, now);
  filter.frequency.exponentialRampToValueAtTime(300, now + 0.25);
  filter.Q.value = 1.2;

  const gainNode = context.createGain();
  gainNode.gain.setValueAtTime(0.35, now);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

  noise.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(context.destination);
  noise.start(now);
  noise.stop(now + 0.3);
}

export function playFlip() {
  const context = ensureContext();
  tone(context, { freq: 700, start: context.currentTime, duration: 0.06, type: "triangle", gain: 0.12, endFreq: 500 });
}

export function playChime() {
  const context = ensureContext();
  const now = context.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    tone(context, { freq, start: now + i * 0.09, duration: 0.35, type: "sine", gain: 0.16 });
  });
}

export function playFanfare() {
  const context = ensureContext();
  const now = context.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const isLast = i === notes.length - 1;
    const duration = isLast ? 0.8 : 0.2;
    tone(context, { freq, start: now + i * 0.12, duration, type: "sine", gain: 0.18 });
    tone(context, { freq: freq * 1.5, start: now + i * 0.12, duration, type: "sine", gain: 0.08 });
  });
}
