import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlarmAudio } from "../src/lib/audio";
import {
  notificationSupport,
  notifyAlarm,
  requestNotificationPermission,
} from "../src/lib/notifications";

class MockParam {
  value = 0;
  setValueAtTime = vi.fn<(value: number, time: number) => void>((value) => {
    this.value = value;
  });
  linearRampToValueAtTime = vi.fn<(value: number, time: number) => void>(
    (value) => {
      this.value = value;
    },
  );
  exponentialRampToValueAtTime = vi.fn<(value: number, time: number) => void>();
  setTargetAtTime =
    vi.fn<(value: number, time: number, constant: number) => void>();
  cancelScheduledValues = vi.fn<(time: number) => void>();
}

class MockGain {
  gain = new MockParam();
  connect = vi.fn<(target: unknown) => void>();
  disconnect = vi.fn();
}

class MockOscillator {
  type: OscillatorType = "sine";
  frequency = new MockParam();
  onended: (() => void) | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  connect = vi.fn<(target: unknown) => void>();
  start = vi.fn<(time: number) => void>();
  disconnect = vi.fn(() => {
    if (this.endTimer !== null) clearTimeout(this.endTimer);
    this.endTimer = null;
  });
  stop = vi.fn((time = Date.now() / 1000) => {
    if (this.endTimer !== null) clearTimeout(this.endTimer);
    this.endTimer = setTimeout(
      () => {
        this.endTimer = null;
        this.onended?.();
      },
      Math.max(0, time * 1000 - Date.now()),
    );
  });
}

type AudioOptions = { state?: AudioContextState; resume?: () => Promise<void> };

class MockAudioContext {
  state: AudioContextState;
  onstatechange: (() => void) | null = null;
  destination = {};
  gains: MockGain[] = [];
  oscillators: MockOscillator[] = [];
  get currentTime() {
    return Date.now() / 1000;
  }
  changeState(state: AudioContextState) {
    this.state = state;
    this.onstatechange?.();
  }
  createGain = vi.fn(() => {
    const gain = new MockGain();
    this.gains.push(gain);
    return gain;
  });
  createOscillator = vi.fn(() => {
    const oscillator = new MockOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  });
  resume;
  close = vi.fn(async () => {
    this.changeState("closed");
  });

  constructor(options: AudioOptions = {}) {
    this.state = options.state ?? "suspended";
    this.resume = vi.fn(() => {
      const pending = options.resume?.() ?? Promise.resolve();
      return pending.then(() => {
        this.changeState("running");
      });
    });
  }
}

function installAudio(options: AudioOptions = {}) {
  const contexts: MockAudioContext[] = [];
  const constructor = vi.fn(function () {
    const context = new MockAudioContext(options);
    contexts.push(context);
    return context;
  });
  vi.stubGlobal("window", { AudioContext: constructor });
  return { contexts, constructor };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("AlarmAudio", () => {
  it("does not create a context or play before an explicit unlock", () => {
    const { constructor } = installAudio();
    const audio = new AlarmAudio();
    expect(audio.start(50)).toBe(false);
    expect(audio.isReady).toBe(false);
    expect(audio.isPlaying).toBe(false);
    expect(constructor).not.toHaveBeenCalled();
  });

  it("unlocks once and synthesizes three enveloped sine tones", async () => {
    const { contexts } = installAudio();
    const onState = vi.fn();
    const audio = new AlarmAudio(onState);
    expect(await audio.unlock()).toBe(true);
    expect(await audio.unlock()).toBe(true);
    expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    expect(audio.start(50)).toBe(true);
    expect(contexts[0].oscillators).toHaveLength(3);
    expect(contexts[0].oscillators.map((node) => node.frequency.value)).toEqual(
      [523.25, 659.25, 880],
    );
    for (const oscillator of contexts[0].oscillators)
      expect(oscillator.type).toBe("sine");
    for (const gain of contexts[0].gains.slice(1)) {
      expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(
        0,
        expect.any(Number),
      );
      expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        0.7,
        expect.any(Number),
      );
      expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
        0.0001,
        expect.any(Number),
      );
    }
    expect(onState).toHaveBeenLastCalledWith({
      isReady: true,
      isPlaying: true,
    });
    audio.dispose();
  });

  it("clamps volume, preserves headroom, and smooths changes", async () => {
    const { contexts } = installAudio();
    const audio = new AlarmAudio();
    await audio.unlock();
    audio.start(999);
    const master = contexts[0].gains[0].gain;
    expect(master.linearRampToValueAtTime).toHaveBeenCalledWith(0.22, 0.04);
    audio.setVolume(-1);
    expect(master.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.025);
    audio.setVolume(50);
    expect(master.setTargetAtTime).toHaveBeenLastCalledWith(0.055, 0, 0.025);
    audio.setVolume(Number.NaN);
    expect(master.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.025);
    audio.setVolume(Number.POSITIVE_INFINITY);
    expect(master.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.025);
    audio.dispose();
  });

  it("repeats once per 1.4 seconds and reclaims naturally-ended nodes", async () => {
    const { contexts } = installAudio();
    const audio = new AlarmAudio();
    await audio.unlock();
    audio.start(50);
    vi.advanceTimersByTime(1000);
    expect(contexts[0].oscillators).toHaveLength(3);
    expect(
      contexts[0].oscillators.every(
        (node) => node.disconnect.mock.calls.length === 1,
      ),
    ).toBe(true);
    vi.advanceTimersByTime(400);
    expect(contexts[0].oscillators).toHaveLength(6);
    audio.dispose();
  });

  it("stops a preview at three seconds and cleans its nodes and timers", async () => {
    const { contexts } = installAudio();
    const audio = new AlarmAudio();
    expect(await audio.preview(35)).toBe(true);
    vi.advanceTimersByTime(2999);
    expect(audio.isPlaying).toBe(true);
    vi.advanceTimersByTime(1);
    expect(audio.isPlaying).toBe(false);
    expect(audio.isReady).toBe(true);
    vi.advanceTimersByTime(60);
    expect(vi.getTimerCount()).toBe(0);
    expect(
      contexts[0].gains.every((gain) => gain.disconnect.mock.calls.length > 0),
    ).toBe(true);
    audio.dispose();
  });

  it("never lets an old preview timeout stop a newly started alarm", async () => {
    installAudio();
    const audio = new AlarmAudio();
    await audio.preview(30);
    vi.advanceTimersByTime(1000);
    expect(audio.start(70)).toBe(true);
    vi.advanceTimersByTime(6000);
    expect(audio.isPlaying).toBe(true);
    audio.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not allow a preview to interrupt a running alarm", async () => {
    const { contexts } = installAudio();
    const audio = new AlarmAudio();
    await audio.unlock();
    audio.start(70);
    expect(await audio.preview(0)).toBe(false);
    expect(contexts[0].gains).toHaveLength(4);
    vi.advanceTimersByTime(4000);
    expect(audio.isPlaying).toBe(true);
    audio.dispose();
  });

  it("keeps an already-running alarm idempotent on repeated start", async () => {
    const { contexts } = installAudio();
    const audio = new AlarmAudio();
    await audio.unlock();
    audio.start(50);
    audio.start(65);
    expect(contexts[0].oscillators).toHaveLength(3);
    expect(contexts[0].gains[0].gain.setTargetAtTime).toHaveBeenCalled();
    audio.dispose();
  });

  it.each(["stop", "start"] as const)(
    "invalidates a pending preview when %s is requested",
    async (operation) => {
      const pending = deferred<void>();
      installAudio({ resume: () => pending.promise });
      const audio = new AlarmAudio();
      const preview = audio.preview(50);
      if (operation === "stop") audio.stop();
      else expect(audio.start(70)).toBe(false);
      pending.resolve();
      expect(await preview).toBe(false);
      expect(audio.isPlaying).toBe(false);
      audio.dispose();
    },
  );

  it("keeps only the newest concurrently requested preview", async () => {
    const { contexts } = installAudio();
    const audio = new AlarmAudio();
    const first = audio.preview(20);
    const second = audio.preview(80);
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    expect(contexts[0].oscillators).toHaveLength(3);
    audio.dispose();
  });

  it("reports browser suspension honestly and requires explicit resumption", async () => {
    const { contexts } = installAudio();
    const onState = vi.fn();
    const audio = new AlarmAudio(onState);
    await audio.unlock();
    audio.start(50);
    contexts[0].changeState("suspended");
    expect(audio.isReady).toBe(false);
    expect(audio.isPlaying).toBe(false);
    expect(audio.start(50)).toBe(false);
    expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenLastCalledWith({
      isReady: false,
      isPlaying: false,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(await audio.unlock()).toBe(true);
    expect(audio.start(50)).toBe(true);
    audio.dispose();
  });

  it("handles unsupported and server environments without throwing", async () => {
    vi.stubGlobal("window", undefined);
    const audio = new AlarmAudio();
    expect(await audio.unlock()).toBe(false);
    vi.stubGlobal("window", {});
    expect(await audio.preview(30)).toBe(false);
    audio.stop();
    audio.dispose();
  });

  it("supports the legacy webkit AudioContext constructor", async () => {
    const { constructor } = installAudio();
    vi.stubGlobal("window", { webkitAudioContext: constructor });
    const audio = new AlarmAudio();
    expect(await audio.unlock()).toBe(true);
    audio.dispose();
  });

  it.each(["reject", "throw"])("handles a browser resume %s", async (kind) => {
    installAudio({
      resume: () => {
        if (kind === "throw") throw new Error("blocked");
        return Promise.reject(new Error("blocked"));
      },
    });
    const audio = new AlarmAudio();
    expect(await audio.unlock()).toBe(false);
    expect(audio.start(50)).toBe(false);
    audio.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a blocked resume and does not enable sound after a late resolution", async () => {
    const pending = deferred<void>();
    installAudio({ resume: () => pending.promise });
    const audio = new AlarmAudio();
    const unlock = audio.unlock();
    vi.advanceTimersByTime(1500);
    expect(await unlock).toBe(false);
    pending.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(audio.isReady).toBe(false);
    expect(audio.start(50)).toBe(false);
    audio.dispose();
  });

  it("cancels pending unlocks and closes only once when disposed", async () => {
    const pending = deferred<void>();
    const { contexts, constructor } = installAudio({
      resume: () => pending.promise,
    });
    const audio = new AlarmAudio();
    const preview = audio.preview(30);
    audio.dispose();
    audio.dispose();
    expect(await preview).toBe(false);
    expect(await audio.unlock()).toBe(false);
    expect(await audio.preview(50)).toBe(false);
    expect(audio.start(50)).toBe(false);
    expect(contexts[0].close).toHaveBeenCalledTimes(1);
    expect(contexts[0].onstatechange).toBeNull();
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns false and disconnects partial audio graphs on synthesis failure", async () => {
    const { contexts } = installAudio();
    const audio = new AlarmAudio();
    await audio.unlock();
    contexts[0].createOscillator.mockImplementationOnce(() => {
      throw new Error("unavailable");
    });
    expect(audio.start(50)).toBe(false);
    expect(audio.isPlaying).toBe(false);
    expect(contexts[0].gains[0].disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    audio.dispose();
  });

  it("does not let an observer exception prevent cleanup", async () => {
    installAudio();
    const audio = new AlarmAudio(() => {
      throw new Error("observer");
    });
    expect(await audio.unlock()).toBe(true);
    expect(audio.start(50)).toBe(true);
    expect(() => audio.dispose()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function installNotifications(permission: NotificationPermission = "default") {
  const instances: {
    title: string;
    options: NotificationOptions;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  const requestPermission = vi.fn(
    async () => "granted" as NotificationPermission,
  );
  class MockNotification {
    static permission = permission;
    static requestPermission = requestPermission;
    close = vi.fn();
    onclick: (() => void) | null = null;
    constructor(
      readonly title: string,
      readonly options: NotificationOptions = {},
    ) {
      instances.push(this);
    }
  }
  vi.stubGlobal("window", {
    Notification: MockNotification,
    focus: vi.fn(),
    isSecureContext: true,
  });
  vi.stubGlobal("navigator", { userActivation: { isActive: true } });
  return { MockNotification, instances, requestPermission };
}

describe("alarm notifications", () => {
  it("reports unsupported on the server or without the API", async () => {
    vi.stubGlobal("window", undefined);
    expect(notificationSupport()).toBe("unsupported");
    expect(await requestNotificationPermission()).toBe("unsupported");
    expect(await notifyAlarm("朝")).toBe(false);
    vi.stubGlobal("window", {});
    expect(notificationSupport()).toBe("unsupported");
  });

  it("only requests permission when explicitly invoked in an active user gesture", async () => {
    const { requestPermission } = installNotifications();
    expect(notificationSupport()).toBe("default");
    expect(await notifyAlarm("朝")).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(await requestNotificationPermission()).toBe("granted");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("refuses accidental permission requests without user activation", async () => {
    const { requestPermission } = installNotifications();
    vi.stubGlobal("navigator", { userActivation: { isActive: false } });
    expect(await requestNotificationPermission()).toBe("default");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it.each(["denied", "granted"] as const)(
    "does not re-prompt for %s permission",
    async (permission) => {
      const { requestPermission } = installNotifications(permission);
      expect(await requestNotificationPermission()).toBe(permission);
      expect(requestPermission).not.toHaveBeenCalled();
    },
  );

  it("handles a rejected permission prompt", async () => {
    const { requestPermission } = installNotifications();
    requestPermission.mockRejectedValueOnce(new Error("blocked"));
    expect(await requestNotificationPermission()).toBe("default");
  });

  it("prefers delivery through an active service worker without waiting for ready", async () => {
    const { instances } = installNotifications("granted");
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const getRegistration = vi
      .fn()
      .mockResolvedValue({ active: {}, showNotification });
    const serviceWorker = {
      getRegistration,
      get ready() {
        throw new Error("must not await ready");
      },
    };
    vi.stubGlobal("navigator", { serviceWorker });
    expect(await notifyAlarm("朝の会議")).toBe(true);
    expect(showNotification).toHaveBeenCalledWith(
      "起きられない目覚まし",
      expect.objectContaining({
        body: expect.stringContaining("朝の会議"),
        silent: true,
        tag: "impossible-alarm",
        data: { url: "/" },
      }),
    );
    expect(instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back to the desktop API when no worker is registered", async () => {
    const { instances } = installNotifications("granted");
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: vi.fn().mockResolvedValue(undefined) },
    });
    expect(await notifyAlarm(" ")).toBe(true);
    expect(instances).toHaveLength(1);
    expect(instances[0].options.body).toContain("アラームの時間です");
  });

  it("falls back if service-worker delivery is rejected", async () => {
    const { instances } = installNotifications("granted");
    const showNotification = vi
      .fn()
      .mockRejectedValue(new Error("not allowed"));
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi
          .fn()
          .mockResolvedValue({ active: {}, showNotification }),
      },
    });
    expect(await notifyAlarm("朝")).toBe(true);
    expect(instances).toHaveLength(1);
  });

  it("bounds a non-resolving registration lookup", async () => {
    const { instances } = installNotifications("granted");
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: () => new Promise(() => undefined) },
    });
    const delivery = notifyAlarm("朝");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await delivery).toBe(true);
    expect(instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not duplicate a service-worker notification that may finish after a timeout", async () => {
    const { instances } = installNotifications("granted");
    const showNotification = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi
          .fn()
          .mockResolvedValue({ active: {}, showNotification }),
      },
    });
    const delivery = notifyAlarm("朝");
    await vi.advanceTimersByTimeAsync(1500);
    expect(await delivery).toBe(false);
    expect(instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks permission again after asynchronous service-worker lookup", async () => {
    const { MockNotification, instances } = installNotifications("granted");
    const registration = deferred<undefined>();
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: () => registration.promise },
    });
    const delivery = notifyAlarm("朝");
    MockNotification.permission = "denied";
    registration.resolve(undefined);
    expect(await delivery).toBe(false);
    expect(instances).toHaveLength(0);
  });

  it("returns false if the browser rejects the desktop constructor", async () => {
    const { MockNotification } = installNotifications("granted");
    const constructor = vi.fn(function () {
      throw new Error("service worker required");
    });
    Object.assign(constructor, { permission: MockNotification.permission });
    vi.stubGlobal("window", { Notification: constructor });
    expect(await notifyAlarm("朝")).toBe(false);
  });
});
