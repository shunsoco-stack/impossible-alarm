export type AlarmAudioState = Readonly<{
  isReady: boolean;
  isPlaying: boolean;
}>;

type Voice = { oscillator: OscillatorNode; envelope: GainNode };
type Playback = {
  mode: "alarm" | "preview";
  master: GainNode;
  voices: Set<Voice>;
  loopTimer: ReturnType<typeof setInterval> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
};

const MOTIF_INTERVAL_MS = 1_400;
const PREVIEW_DURATION_MS = 3_000;
const RESUME_TIMEOUT_MS = 1_500;
const MAX_GAIN = 0.22;
const FREQUENCIES = [523.25, 659.25, 880] as const;

function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : 0;
}

function disconnect(node: AudioNode | null): void {
  try {
    node?.disconnect();
  } catch {
    // An interrupted or already-closed audio context may reject cleanup.
  }
}

/**
 * A locally synthesized, original three-note alarm; no recordings or remote audio.
 * Call unlock()/preview() directly from a user gesture. Never persist readiness:
 * browser autoplay rules and OS power saving may suspend audio at any time.
 */
export class AlarmAudio {
  private context: AudioContext | null = null;
  private unlocked = false;
  private disposed = false;
  private volume = 50;
  private generation = 0;
  private playback: Playback | null = null;
  private retiring = new Set<Playback>();
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private unlocking: Promise<boolean> | null = null;
  private cancelUnlock: (() => void) | null = null;
  private lastState = "";

  constructor(
    private readonly onStateChange?: (state: AlarmAudioState) => void,
  ) {}

  get isReady(): boolean {
    return !this.disposed && this.unlocked && this.context?.state === "running";
  }

  /** Whether the synthesis loop is running; volume 0 is intentionally silent. */
  get isPlaying(): boolean {
    return this.isReady && this.playback !== null;
  }

  unlock(): Promise<boolean> {
    if (this.disposed || typeof window === "undefined")
      return Promise.resolve(false);
    if (this.isReady) return Promise.resolve(true);
    if (this.unlocking) return this.unlocking;

    let context: AudioContext;
    try {
      if (!this.context || this.context.state === "closed") {
        const AudioContextConstructor =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioContextConstructor) return Promise.resolve(false);
        if (this.context) this.context.onstatechange = null;
        this.unlocked = false;
        this.context = new AudioContextConstructor({
          latencyHint: "interactive",
        });
        this.context.onstatechange = () => {
          if (this.context?.state !== "running") {
            this.clearPreviewTimer();
            this.releasePlayback(true);
          }
          this.emitState();
        };
      }
      context = this.context;
      if (context.state === "running") {
        this.unlocked = true;
        this.emitState();
        return Promise.resolve(true);
      }

      // Keep resume() inside the original gesture, before any asynchronous work.
      const resume = context.resume();
      this.unlocking = new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (resumed: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.cancelUnlock = null;
          this.unlocking = null;
          const ready =
            resumed &&
            !this.disposed &&
            this.context === context &&
            context.state === "running";
          this.unlocked = ready;
          this.emitState();
          resolve(ready);
        };
        const timeout = setTimeout(() => finish(false), RESUME_TIMEOUT_MS);
        this.cancelUnlock = () => finish(false);
        Promise.resolve(resume).then(
          () => finish(true),
          () => finish(false),
        );
      });
      return this.unlocking;
    } catch {
      this.unlocked = false;
      this.emitState();
      return Promise.resolve(false);
    }
  }

  /** Does not request autoplay permission or resume a suspended context. */
  start(volume: number): boolean {
    this.generation += 1;
    this.clearPreviewTimer();
    if (!this.isReady) {
      this.releasePlayback(true);
      this.emitState();
      return false;
    }
    if (this.playback?.mode === "alarm") {
      this.setVolume(volume);
      return this.isPlaying;
    }
    this.releasePlayback();
    this.volume = clampVolume(volume);
    return this.beginPlayback("alarm");
  }

  /** A three-second preview never takes over an already active alarm. */
  async preview(volume: number): Promise<boolean> {
    if (this.disposed || this.playback?.mode === "alarm") return false;
    const generation = ++this.generation;
    this.clearPreviewTimer();
    this.releasePlayback();
    this.emitState();
    const ready = await this.unlock();
    if (!ready || generation !== this.generation || this.disposed) return false;
    this.volume = clampVolume(volume);
    if (!this.beginPlayback("preview")) return false;
    this.previewTimer = setTimeout(() => {
      if (generation === this.generation && this.playback?.mode === "preview")
        this.stop();
    }, PREVIEW_DURATION_MS);
    return true;
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    if (!this.context || !this.playback) return;
    try {
      const now = this.context.currentTime;
      this.playback.master.gain.cancelScheduledValues(now);
      this.playback.master.gain.setTargetAtTime(this.outputGain(), now, 0.025);
    } catch {
      this.releasePlayback(true);
      this.emitState();
    }
  }

  stop(): void {
    this.generation += 1;
    this.clearPreviewTimer();
    this.releasePlayback();
    this.emitState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.cancelUnlock?.();
    for (const playback of this.retiring) this.destroyPlayback(playback);
    const context = this.context;
    this.context = null;
    this.unlocked = false;
    if (!context) return;
    context.onstatechange = null;
    try {
      if (context.state !== "closed")
        void Promise.resolve(context.close()).catch(() => undefined);
    } catch {
      // Browser teardown can race component cleanup; no audio is left connected.
    }
  }

  private outputGain(): number {
    // A perceptual volume curve plus headroom; each note has its own envelope.
    return (this.volume / 100) ** 2 * MAX_GAIN;
  }

  private beginPlayback(mode: Playback["mode"]): boolean {
    const context = this.context;
    if (!context || !this.isReady) return false;
    try {
      const playback: Playback = {
        mode,
        master: context.createGain(),
        voices: new Set(),
        loopTimer: null,
        cleanupTimer: null,
        disposed: false,
      };
      this.playback = playback;
      playback.master.gain.setValueAtTime(0, context.currentTime);
      playback.master.gain.linearRampToValueAtTime(
        this.outputGain(),
        context.currentTime + 0.04,
      );
      playback.master.connect(context.destination);
      this.playMotif(playback);
      playback.loopTimer = setInterval(() => {
        if (this.playback !== playback) return;
        if (!this.isReady) {
          this.releasePlayback(true);
          this.emitState();
          return;
        }
        try {
          // Schedule from "now", never replay a burst of missed background ticks.
          this.playMotif(playback);
        } catch {
          this.releasePlayback(true);
          this.emitState();
        }
      }, MOTIF_INTERVAL_MS);
      this.emitState();
      return true;
    } catch {
      this.releasePlayback(true);
      this.emitState();
      return false;
    }
  }

  private playMotif(playback: Playback): void {
    const context = this.context;
    if (!context) return;
    const beginning = context.currentTime + 0.05;
    FREQUENCIES.forEach((frequency, index) => {
      let oscillator: OscillatorNode | null = null;
      let envelope: GainNode | null = null;
      let voice: Voice | null = null;
      try {
        oscillator = context.createOscillator();
        envelope = context.createGain();
        voice = { oscillator, envelope };
        playback.voices.add(voice);
        const start = beginning + index * 0.23;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(0.7, start + 0.035);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
        envelope.gain.linearRampToValueAtTime(0, start + 0.32);
        oscillator.connect(envelope);
        envelope.connect(playback.master);
        const activeVoice = voice;
        oscillator.onended = () => {
          this.destroyVoice(activeVoice);
          playback.voices.delete(activeVoice);
        };
        oscillator.start(start);
        oscillator.stop(start + 0.34);
      } catch (error) {
        if (voice) {
          this.destroyVoice(voice);
          playback.voices.delete(voice);
        } else {
          disconnect(oscillator);
          disconnect(envelope);
        }
        throw error;
      }
    });
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }

  private releasePlayback(immediately = false): void {
    const playback = this.playback;
    if (!playback) return;
    this.playback = null;
    if (playback.loopTimer !== null) clearInterval(playback.loopTimer);
    playback.loopTimer = null;
    if (immediately || !this.context || this.context.state !== "running") {
      this.destroyPlayback(playback);
      return;
    }
    try {
      const now = this.context.currentTime;
      playback.master.gain.cancelScheduledValues(now);
      playback.master.gain.setTargetAtTime(0, now, 0.008);
      for (const voice of playback.voices) voice.oscillator.stop(now + 0.04);
      this.retiring.add(playback);
      // The short fade prevents clicks. A wall-clock fallback also releases nodes
      // if the OS suspends the audio timeline before their onended events fire.
      playback.cleanupTimer = setTimeout(
        () => this.destroyPlayback(playback),
        60,
      );
    } catch {
      this.destroyPlayback(playback);
    }
  }

  private destroyVoice(voice: Voice): void {
    voice.oscillator.onended = null;
    try {
      voice.oscillator.stop();
    } catch {
      // An ended or never-started oscillator is safe to disconnect regardless.
    }
    disconnect(voice.oscillator);
    disconnect(voice.envelope);
  }

  private destroyPlayback(playback: Playback): void {
    if (playback.disposed) return;
    playback.disposed = true;
    if (playback.loopTimer !== null) clearInterval(playback.loopTimer);
    if (playback.cleanupTimer !== null) clearTimeout(playback.cleanupTimer);
    for (const voice of playback.voices) this.destroyVoice(voice);
    playback.voices.clear();
    disconnect(playback.master);
    this.retiring.delete(playback);
  }

  private emitState(): void {
    const state = { isReady: this.isReady, isPlaying: this.isPlaying };
    const key = `${state.isReady}:${state.isPlaying}`;
    if (key === this.lastState) return;
    this.lastState = key;
    try {
      this.onStateChange?.(state);
    } catch {
      // UI callbacks must never prevent audio cleanup.
    }
  }
}
