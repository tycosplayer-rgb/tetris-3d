/** Procedural SFX via Web Audio — no asset files. Loud by default. */

export type SfxKind = 'move' | 'rotate' | 'flip' | 'lock' | 'hard' | 'clear' | 'over' | 'start' | 'pause';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** Master gain — keep high so phone speakers are audible. */
  private readonly masterGain = 1.35;

  unlock(): void {
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.unlock();
    if (this.master) {
      this.master.gain.value = this.muted ? 0 : this.masterGain;
    }
    return this.muted;
  }

  play(kind: SfxKind, detail = 1): void {
    if (this.muted) return;
    this.unlock();
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') return;
    const t0 = ctx.currentTime;

    switch (kind) {
      case 'move':
        this.blip(t0, 280, 0.045, 0.55, 'square');
        break;
      case 'rotate':
        this.blip(t0, 420, 0.05, 0.65, 'square');
        this.blip(t0 + 0.04, 560, 0.05, 0.55, 'square');
        break;
      case 'flip':
        this.blip(t0, 360, 0.06, 0.7, 'sawtooth');
        this.blip(t0 + 0.06, 240, 0.07, 0.65, 'sawtooth');
        break;
      case 'hard':
        this.noiseBurst(t0, 0.08, 0.75);
        this.blip(t0 + 0.02, 140, 0.1, 0.85, 'triangle');
        break;
      case 'lock':
        this.blip(t0, 160, 0.09, 0.8, 'triangle');
        this.noiseBurst(t0, 0.05, 0.45);
        break;
      case 'clear': {
        const n = Math.max(1, Math.min(4, detail));
        const base = 440;
        for (let i = 0; i < n + 1; i++) {
          this.blip(t0 + i * 0.07, base * (1 + i * 0.28), 0.12, 0.9, 'square');
        }
        if (n >= 3) this.noiseBurst(t0 + 0.05, 0.12, 0.55);
        break;
      }
      case 'over':
        this.blip(t0, 320, 0.18, 0.85, 'sawtooth');
        this.blip(t0 + 0.16, 220, 0.2, 0.85, 'sawtooth');
        this.blip(t0 + 0.34, 140, 0.28, 0.9, 'triangle');
        break;
      case 'start':
        this.blip(t0, 330, 0.08, 0.7, 'square');
        this.blip(t0 + 0.08, 440, 0.08, 0.75, 'square');
        this.blip(t0 + 0.16, 554, 0.12, 0.85, 'square');
        break;
      case 'pause':
        this.blip(t0, 300, 0.06, 0.5, 'sine');
        break;
      default:
        break;
    }
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.masterGain;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private dest(): AudioNode {
    this.ensureCtx();
    return this.master!;
  }

  private blip(
    when: number,
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType,
  ): void {
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    // Punchy envelope, high peak for loudness on phone speakers.
    const peak = Math.min(1, gain * 1.15);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(this.dest());
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  private noiseBurst(when: number, dur: number, gain: number): void {
    const ctx = this.ensureCtx();
    const sampleRate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.min(1, gain), when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.dest());
    src.start(when);
    src.stop(when + dur + 0.02);
  }
}

export const gameAudio = new GameAudio();
