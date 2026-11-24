/**
 * The tower's ambient sound, made in the browser (no audio files): a low city hum always, rain on the glass when it is
 * really raining at home, and a slow wind swell when it is windy. Starts only from a click (browsers require that) and
 * fades in and out. Nothing is recorded or sent anywhere.
 */
export type AmbienceWeather = { rain_mm: number; wind_kmh: number; code: number };

const FADE_S = 1.2;

/** A few seconds of noise, looped. Brown noise for the hum, white noise for rain. */
function noise(ctx: AudioContext, brown: boolean) {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rain: GainNode | null = null;
  private wind: GainNode | null = null;
  private srcs: AudioScheduledSourceNode[] = [];

  /** Is it raining (WMO drizzle, rain, showers, thunder) or wet right now? */
  private static wet(w: AmbienceWeather | null) {
    if (!w) return 0;
    const raining = w.rain_mm > 0 || (w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 99);
    return raining ? Math.min(1, 0.35 + w.rain_mm / 4) : 0;
  }

  start(w: AmbienceWeather | null) {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;

    // the hum: brown noise, low-passed, very quiet
    const hum = noise(ctx, true);
    const humLp = ctx.createBiquadFilter();
    humLp.type = "lowpass";
    humLp.frequency.value = 260;
    const humG = ctx.createGain();
    humG.gain.value = 0.5;
    hum.connect(humLp).connect(humG).connect(master);

    // rain: white noise through a band around the patter on glass
    const rain = noise(ctx, false);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    const rainG = ctx.createGain();
    rainG.gain.value = 0;
    rain.connect(hp).connect(lp).connect(rainG).connect(master);
    this.rain = rainG;

    // wind: brown noise through a band whose level swells slowly (an LFO on the gain)
    const wind = noise(ctx, true);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 480;
    bp.Q.value = 0.7;
    const windG = ctx.createGain();
    windG.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0;
    lfo.connect(lfoG).connect(windG.gain);
    wind.connect(bp).connect(windG).connect(master);
    this.wind = windG;
    this.windLfo = lfoG;

    this.srcs = [hum, rain, wind, lfo];
    for (const s of this.srcs) s.start();
    master.gain.setTargetAtTime(0.22, ctx.currentTime, FADE_S / 3);
    this.setWeather(w);
  }

  private windLfo: GainNode | null = null;

  setWeather(w: AmbienceWeather | null) {
    const ctx = this.ctx;
    if (!ctx || !this.rain || !this.wind || !this.windLfo) return;
    const t = ctx.currentTime;
    this.rain.gain.setTargetAtTime(Ambience.wet(w) * 0.55, t, 1.5);
    const wind = Math.min(1, Math.max(0, ((w?.wind_kmh ?? 0) - 8) / 30));
    this.wind.gain.setTargetAtTime(wind * 0.35, t, 1.5);
    this.windLfo.gain.setTargetAtTime(wind * 0.25, t, 1.5);
  }

  /** Thunder after a lightning flash: a low rumble that arrives a second or two later and rolls away. */
  thunder() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const src = ctx.createBufferSource();
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 170;
    const g = ctx.createGain();
    const at = ctx.currentTime + 0.8 + Math.random() * 1.4; // light arrives first
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1.6, at + 0.18);
    g.gain.setTargetAtTime(0, at + 0.5, 0.9);
    src.connect(lp).connect(g).connect(this.master);
    src.start(ctx.currentTime);
    src.stop(at + 4);
  }

  /** Quiet while the tab is hidden, back when it returns. */
  pause(on: boolean) {
    if (!this.ctx) return;
    void (on ? this.ctx.suspend() : this.ctx.resume());
  }

  stop() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, FADE_S / 3);
    const srcs = this.srcs;
    this.ctx = null;
    this.master = this.rain = this.wind = this.windLfo = null;
    this.srcs = [];
    setTimeout(() => {
      for (const s of srcs) {
        try {
          s.stop();
        } catch {}
      }
      void ctx.close();
    }, FADE_S * 1000 + 200);
  }
}
