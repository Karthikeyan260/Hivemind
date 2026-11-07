/**
 * What the theatre needs from a player, so a film file and a YouTube video are kept in step the same way:
 * play, pause, seek, and where it is now. `YtPlayer` drives YouTube's IFrame player; `filePlayer` wraps a <video>.
 */
export interface Player {
  play(): void;
  pause(): void;
  seek(t: number): void;
  time(): number;
  paused(): boolean;
  /** 0 to 1. */
  volume(): number;
  setVolume(v: number): void;
  muted(): boolean;
  setMuted(on: boolean): void;
}

export const filePlayer = (v: HTMLVideoElement): Player => ({
  play: () => void v.play().catch(() => {}),
  pause: () => v.pause(),
  seek: (t) => {
    v.currentTime = Math.min(t, v.duration || t);
  },
  time: () => v.currentTime,
  paused: () => v.paused,
  volume: () => v.volume,
  setVolume: (x) => {
    v.volume = Math.min(1, Math.max(0, x));
    if (x > 0) v.muted = false;
  },
  muted: () => v.muted,
  setMuted: (on) => {
    v.muted = on;
  },
});

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(t: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  getVolume(): number;
  setVolume(v: number): void;
  isMuted(): boolean;
  mute(): void;
  unMute(): void;
  destroy(): void;
};
type YTNamespace = { Player: new (el: HTMLElement, opts: unknown) => YTPlayer };

let apiReady: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    const w = window as unknown as { YT?: YTNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
    if (w.YT?.Player) return resolve(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT as YTNamespace);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      apiReady = null;
      reject(new Error("YouTube blocked"));
    };
    document.head.appendChild(s);
  });
  return apiReady;
}

export type YtHooks = {
  onReady(): void;
  onPlay(): void;
  onPause(): void;
  onSeek(t: number): void;
  /** 101 / 150: the channel doesn't allow this video to play outside YouTube; others: unavailable, removed or blocked. */
  onError(code: number): void;
};

/** YouTube's player with the same play / pause / seek the room uses. It has no "seeked" event, so seeks are noticed as jumps in the clock. */
export class YtPlayer implements Player {
  private p: YTPlayer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastT = 0;
  private lastAt = 0;
  private dead = false;

  constructor(
    host: HTMLElement,
    private id: string,
    private hooks: YtHooks,
  ) {
    void loadYouTubeApi()
      .then((YT) => {
        if (this.dead) return;
        const mount = document.createElement("div");
        host.appendChild(mount);
        this.p = new YT.Player(mount, {
          videoId: this.id,
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
          events: {
            onReady: () => {
              this.hooks.onReady();
              this.timer = setInterval(() => this.watch(), 500);
            },
            onStateChange: (e: { data: number }) => {
              if (e.data === 1) {
                this.mark();
                this.hooks.onPlay();
              } else if (e.data === 2) {
                this.mark();
                this.hooks.onPause();
              }
            },
            onError: (e: { data: number }) => this.hooks.onError(e.data),
          },
        });
      })
      .catch(() => this.hooks.onError(-1));
  }

  private mark() {
    this.lastT = this.time();
    this.lastAt = performance.now();
  }

  /** A jump in the clock that playing doesn't explain is a seek. */
  private watch() {
    if (!this.p) return;
    const now = performance.now();
    const t = this.time();
    const expected = this.lastT + (this.paused() ? 0 : (now - this.lastAt) / 1000);
    if (Math.abs(t - expected) > 1.8 && this.lastAt) this.hooks.onSeek(t);
    this.lastT = t;
    this.lastAt = now;
  }

  play() {
    this.p?.playVideo();
  }
  pause() {
    this.p?.pauseVideo();
  }
  seek(t: number) {
    this.p?.seekTo(t, true);
    this.mark();
  }
  time() {
    return this.p?.getCurrentTime?.() ?? 0;
  }
  paused() {
    return this.p ? this.p.getPlayerState() !== 1 : true;
  }
  volume() {
    return (this.p?.getVolume?.() ?? 100) / 100;
  }
  setVolume(v: number) {
    this.p?.setVolume(Math.round(Math.min(1, Math.max(0, v)) * 100));
    if (v > 0) this.p?.unMute();
  }
  muted() {
    return this.p?.isMuted?.() ?? false;
  }
  setMuted(on: boolean) {
    if (on) this.p?.mute();
    else this.p?.unMute();
  }
  destroy() {
    this.dead = true;
    if (this.timer) clearInterval(this.timer);
    try {
      this.p?.destroy();
    } catch {}
    this.p = null;
  }
}
