import type { BoardEvent, BoardState } from '../machine/controller';

/** Synthesised machine sounds (WebAudio, no asset files). */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private motorOsc: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private volume: number;

  constructor(volume: number) {
    this.volume = volume;
  }

  /** Browsers only allow audio after a user gesture. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.motorOsc = this.ctx.createOscillator();
      this.motorOsc.type = 'sawtooth';
      this.motorOsc.frequency.value = 95;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      this.motorGain = this.ctx.createGain();
      this.motorGain.gain.value = 0;
      this.motorOsc.connect(lp).connect(this.motorGain).connect(this.master);
      this.motorOsc.start();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.12, delay = 0): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private melody(notes: number[], step = 0.12, type: OscillatorType = 'square'): void {
    notes.forEach((n, i) => n > 0 && this.tone(440 * 2 ** ((n - 69) / 12), step * 0.95, type, 0.08, i * step));
  }

  coin(): void {
    this.tone(1318, 0.08, 'square', 0.1);
    this.tone(1760, 0.18, 'square', 0.1, 0.07);
  }

  /** Claw bumping glass/tube/prizes — the "扣扣扣" from the video. */
  knock(strength: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime;
    const buf = c.createBuffer(1, c.sampleRate * 0.05, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.15));
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.5 * strength, t);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
  }

  /** Gantry/winch motor hum while anything is moving. */
  motor(state: BoardState): void {
    if (!this.ctx || !this.motorGain || !this.motorOsc) return;
    const moving = ['dropping', 'lifting', 'topPull', 'returning', 'lowering', 'rewind', 'retry'].includes(state);
    const target = moving ? 0.05 : 0;
    this.motorGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    this.motorOsc.frequency.setTargetAtTime(state === 'dropping' ? 80 : state === 'returning' ? 110 : 95, this.ctx.currentTime, 0.1);
  }

  boardEvent(e: BoardEvent): void {
    switch (e.type) {
      case 'start':
        this.melody([72, 76, 79, 84], 0.09);
        break;
      case 'grab':
        this.tone(140, 0.12, 'square', 0.15);
        break;
      case 'win':
        this.melody([72, 76, 79, 84, 0, 79, 84, 88], 0.11);
        break;
      case 'music':
        // A5 展示音樂: a short idle jingle.
        this.melody([76, 79, 81, 79, 76, 72, 74, 76], 0.16, 'triangle');
        break;
      case 'error':
        this.melody([60, 0, 60, 0, 60], 0.15);
        break;
      default:
        break;
    }
  }
}
