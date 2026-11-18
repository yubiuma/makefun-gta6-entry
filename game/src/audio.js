// All sound is synthesised with WebAudio: no audio files, nothing to load. Short one-shot
// voices (gunshot, impacts, pickups, jingles) are built per call from oscillators and a
// shared noise buffer; two loops run underneath, a police siren whose loudness follows the
// wanted level and an engine hum whose pitch follows the car's speed. M mutes everything.

export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let siren = null;
  let engine = null;
  let muted = false;

  /** Create the context on the first user gesture; safe to call again and again. */
  function unlock() {
    if (context !== null) {
      if (context.state === 'suspended') context.resume();
      return;
    }
    try {
      context = new (window.AudioContext || window.webkitAudioContext)();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(context.destination);
      const length = context.sampleRate * 0.5;
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      context = null;
    }
  }

  function noiseBurst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (context === null) return;
    const t = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  function tone(freqFrom, freqTo, duration, gainValue, type = 'sine', delay = 0) {
    if (context === null) return;
    const t = context.currentTime + delay;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function ensureSiren() {
    if (context === null || siren !== null) return;
    const osc = context.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 760;
    const lfo = context.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.55;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain).connect(osc.frequency);
    const gain = context.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(master);
    osc.start();
    lfo.start();
    siren = { gain };
  }

  function ensureEngine() {
    if (context === null || engine !== null) return;
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const gain = context.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(master);
    osc.start();
    engine = { osc, gain };
  }

  return {
    unlock,
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master !== null && context !== null) {
        master.gain.setTargetAtTime(muted ? 0 : 0.5, context.currentTime, 0.02);
      }
      return muted;
    },
    /** A pistol shot: a crack of noise over a dropping square blip. */
    shot() {
      noiseBurst(0.09, 3200, 0.5, 'highpass');
      tone(220, 55, 0.09, 0.35, 'square');
    },
    /** A bullet or body thudding into a car, scaled by how hard. */
    hit(intensity) {
      noiseBurst(0.12, 500, 0.25 + intensity * 0.4);
      tone(120, 45, 0.12, 0.3 * intensity + 0.1, 'sine');
    },
    /** A proper crash: longer, lower, louder. */
    crash() {
      noiseBurst(0.32, 340, 0.8);
      tone(90, 32, 0.3, 0.5, 'sine');
    },
    pickup() {
      tone(660, 660, 0.07, 0.25, 'sine');
      tone(990, 990, 0.1, 0.25, 'sine', 0.07);
    },
    success() {
      tone(523, 523, 0.11, 0.28, 'triangle');
      tone(659, 659, 0.11, 0.28, 'triangle', 0.11);
      tone(784, 784, 0.2, 0.3, 'triangle', 0.22);
    },
    fail() {
      tone(220, 110, 0.35, 0.3, 'sawtooth');
    },
    click() {
      tone(880, 660, 0.05, 0.18, 'sine');
    },
    /** The siren loop's loudness, 0 (silent) to 1; call every frame with the wanted level. */
    sirenSet(level) {
      if (context === null) return;
      ensureSiren();
      if (siren !== null) siren.gain.gain.setTargetAtTime(level * 0.055, context.currentTime, 0.25);
    },
    /** The engine loop: null when on foot, else the car's speed as a 0..1 ratio. */
    engineSet(ratio) {
      if (context === null) return;
      ensureEngine();
      if (engine === null) return;
      const t = context.currentTime;
      if (ratio === null) {
        engine.gain.gain.setTargetAtTime(0, t, 0.1);
      } else {
        engine.osc.frequency.setTargetAtTime(52 + ratio * 150, t, 0.08);
        engine.gain.gain.setTargetAtTime(0.045, t, 0.1);
      }
    },
  };
}
