import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  createAlarm,
  createSession,
  EMPTY_STATE,
  MAX_ALARMS,
  parseState,
  SNOOZE_MS,
  type Alarm,
  type AppState,
  type Session,
} from "../src/lib/alarm";
import type { alarmStore as AlarmStoreType } from "../src/lib/alarm-store";

type Store = typeof AlarmStoreType;
type AudioState = { isReady: boolean; isPlaying: boolean };
type AudioDouble = {
  isReady: boolean;
  isPlaying: boolean;
  disposed: boolean;
  unlock: Mock<() => Promise<boolean>>;
  start: Mock<(volume: number) => boolean>;
  preview: Mock<(volume: number) => Promise<boolean>>;
  setVolume: Mock<(volume: number) => void>;
  stop: Mock<() => void>;
  dispose: Mock<() => void>;
};

const doubles = vi.hoisted(() => ({
  audioInstances: [] as AudioDouble[],
  unlock: vi.fn<() => Promise<boolean>>(),
  preview: vi.fn<(volume: number) => Promise<boolean>>(),
  notificationSupport: vi.fn<() => NotificationPermission | "unsupported">(),
  requestNotificationPermission:
    vi.fn<() => Promise<NotificationPermission | "unsupported">>(),
  notifyAlarm: vi.fn<(name: string) => Promise<boolean>>(),
  trackAlarmEvent: vi.fn(),
}));

vi.mock("../src/lib/audio", () => ({
  AlarmAudio: class {
    isReady = false;
    isPlaying = false;
    disposed = false;
    volume = 0;

    constructor(private readonly onStateChange: (state: AudioState) => void) {
      doubles.audioInstances.push(this);
    }

    unlock = vi.fn(async () => {
      const ready = await doubles.unlock();
      this.isReady = ready && !this.disposed;
      this.publish();
      return this.isReady;
    });

    start = vi.fn((volume: number) => {
      this.volume = volume;
      this.isPlaying = this.isReady && !this.disposed;
      this.publish();
      return this.isPlaying;
    });

    preview = vi.fn(async (volume: number) => {
      const ready = await doubles.preview(volume);
      this.isReady = ready && !this.disposed;
      this.isPlaying = this.isReady;
      this.publish();
      return this.isPlaying;
    });

    setVolume = vi.fn((volume: number) => {
      this.volume = volume;
    });
    stop = vi.fn(() => {
      this.isPlaying = false;
      this.publish();
    });
    dispose = vi.fn(() => {
      this.disposed = true;
      this.isReady = false;
      this.stop();
    });

    private publish() {
      this.onStateChange({ isReady: this.isReady, isPlaying: this.isPlaying });
    }
  },
}));

vi.mock("../src/lib/notifications", () => ({
  notificationSupport: doubles.notificationSupport,
  requestNotificationPermission: doubles.requestNotificationPermission,
  notifyAlarm: doubles.notifyAlarm,
}));
vi.mock("../src/lib/analytics", () => ({
  trackAlarmEvent: doubles.trackAlarmEvent,
}));

const NOW = new Date(2026, 7, 27, 6, 0, 0).getTime();
const STORAGE_KEY = "impossible-alarm:v1";
const INPUT = {
  name: "朝のアラーム",
  time: "07:00",
  difficulty: "normal" as const,
  volume: 35,
};
type LockCallback = (lock: Lock | null) => Promise<void>;
type LockRequest = (
  name: string,
  options: { ifAvailable: boolean },
  callback: LockCallback,
) => Promise<void>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function lockManager(initiallyHeld = false) {
  const state = { held: initiallyHeld };
  const request = vi.fn<LockRequest>(async (name, _options, callback) => {
    if (state.held) {
      await callback(null);
      return;
    }
    state.held = true;
    try {
      await callback({ name, mode: "exclusive" } as Lock);
    } finally {
      state.held = false;
    }
  });
  return { state, request };
}

function storageHarness() {
  const values = new Map<string, string>();
  const failures = { read: false, write: false };
  return {
    values,
    failures,
    getItem: vi.fn((key: string) => {
      if (failures.read)
        throw new DOMException("Storage is unavailable", "SecurityError");
      return values.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (failures.write)
        throw new DOMException("Storage is full", "QuotaExceededError");
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  };
}

function makeAlarm(index = 0): Alarm {
  return createAlarm(INPUT, NOW, "alarm-" + index);
}

function makeSession(): Session {
  return { ...createSession(makeAlarm(), NOW), status: "solving" };
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return { version: 1, alarms: [], session: null, history: [], ...overrides };
}

let storage: ReturnType<typeof storageHarness>;
let locks: ReturnType<typeof lockManager>;
let fakeWindow: EventTarget;
let fakeDocument: EventTarget & {
  visibilityState: string;
  documentElement: { dataset: Record<string, string> };
};
let fakeNavigator: { locks?: ReturnType<typeof lockManager> };
let disconnectors: (() => void)[];

async function loadStore() {
  return (await import("../src/lib/alarm-store")).alarmStore;
}

function connect(store: Store) {
  const disconnect = store.connect();
  let active = true;
  const once = () => {
    if (!active) return;
    active = false;
    disconnect();
  };
  disconnectors.push(once);
  return once;
}

async function flushPromises() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function writeState(state: AppState) {
  storage.values.set(STORAGE_KEY, JSON.stringify(state));
}

function storageEvent(state: AppState) {
  const event = new Event("storage");
  Object.defineProperties(event, {
    key: { value: STORAGE_KEY },
    newValue: { value: JSON.stringify(state) },
  });
  fakeWindow.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.resetModules();
  doubles.audioInstances.length = 0;
  doubles.unlock.mockReset().mockResolvedValue(true);
  doubles.preview.mockReset().mockResolvedValue(true);
  doubles.notificationSupport.mockReset().mockReturnValue("default");
  doubles.requestNotificationPermission
    .mockReset()
    .mockResolvedValue("granted");
  doubles.notifyAlarm.mockReset().mockResolvedValue(true);
  doubles.trackAlarmEvent.mockReset();
  storage = storageHarness();
  locks = lockManager();
  fakeWindow = new EventTarget();
  fakeDocument = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    documentElement: { dataset: {} as Record<string, string> },
  });
  fakeNavigator = { locks };
  disconnectors = [];
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("navigator", fakeNavigator);
  vi.stubGlobal("localStorage", storage);
});

afterEach(async () => {
  for (const disconnect of disconnectors.reverse()) disconnect();
  await flushPromises();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("store lifecycle and single-tab leadership", () => {
  it("exposes a stable server snapshot and reads storage only on connection", async () => {
    const store = await loadStore();
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
    expect(store.getServerSnapshot()).toMatchObject({
      ready: false,
      primary: false,
      audioReady: false,
      now: 0,
    });
    expect(storage.getItem).not.toHaveBeenCalled();
    connect(store);
    expect(store.getSnapshot()).toMatchObject({
      ready: true,
      primary: true,
      now: NOW,
    });
    expect(doubles.unlock).not.toHaveBeenCalled();
    expect(doubles.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it("shares one connection/timer/audio engine until the last subscriber leaves", async () => {
    const store = await loadStore();
    const first = connect(store);
    const second = connect(store);
    expect(doubles.audioInstances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    first();
    expect(doubles.audioInstances[0].dispose).not.toHaveBeenCalled();
    second();
    await flushPromises();
    expect(doubles.audioInstances[0].dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(locks.state.held).toBe(false);
  });

  it("survives StrictMode connect → cleanup → connect without duplicate ticking", async () => {
    const store = await loadStore();
    const first = connect(store);
    first();
    connect(store);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().primary).toBe(true);
    expect(doubles.audioInstances).toHaveLength(2);
    expect(doubles.audioInstances[0].dispose).toHaveBeenCalledOnce();
    expect(doubles.audioInstances[1].dispose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    expect(doubles.unlock).not.toHaveBeenCalled();
  });

  it("ignores a stale lock result from the previous StrictMode generation", async () => {
    const gate = deferred<void>();
    locks.request.mockImplementationOnce(async (name, _options, callback) => {
      await gate.promise;
      await callback({ name, mode: "exclusive" } as Lock);
    });
    const store = await loadStore();
    const first = connect(store);
    first();
    connect(store);
    expect(store.getSnapshot().primary).toBe(false);
    gate.resolve();
    await flushPromises();
    expect(store.getSnapshot().primary).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().primary).toBe(true);
    expect(locks.request).toHaveBeenCalledTimes(2);
  });

  it("keeps a follower read-only and never unlocks its audio", async () => {
    locks.state.held = true;
    writeState(makeState({ alarms: [makeAlarm()] }));
    const store = await loadStore();
    connect(store);
    await flushPromises();
    expect(store.getSnapshot().primary).toBe(false);
    expect(await store.addAlarm(INPUT)).toBe(false);
    expect(await store.startDemo("normal")).toBe(false);
    await store.toggleAlarm("alarm-0");
    await store.preview(50);
    await store.enableAudio();
    store.removeAlarm("alarm-0");
    expect(store.getSnapshot().data.alarms).toHaveLength(1);
    expect(doubles.unlock).not.toHaveBeenCalled();
    expect(doubles.preview).not.toHaveBeenCalled();
    expect(doubles.trackAlarmEvent).not.toHaveBeenCalled();
  });

  it("transfers leadership between independent store instances and rereads latest progress", async () => {
    const session = makeSession();
    writeState(makeState({ session }));
    const first = await loadStore();
    const leaveFirst = connect(first);
    vi.resetModules();
    const second = await loadStore();
    connect(second);
    await flushPromises();
    expect(first.getSnapshot().primary).toBe(true);
    expect(second.getSnapshot().primary).toBe(false);
    first.answer(String(session.question.answer));
    expect(first.getSnapshot().data.session?.solved).toBe(1);
    expect(second.getSnapshot().data.session?.solved).toBe(0);
    leaveFirst();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.getSnapshot().primary).toBe(true);
    expect(second.getSnapshot().data.session?.solved).toBe(1);
    expect(doubles.unlock).not.toHaveBeenCalled();
  });

  it("does not fire the same scheduled alarm twice across two connected tabs", async () => {
    writeState(makeState({ alarms: [{ ...makeAlarm(), nextAt: NOW + 500 }] }));
    const first = await loadStore();
    connect(first);
    vi.resetModules();
    const second = await loadStore();
    connect(second);
    await vi.advanceTimersByTimeAsync(2000);
    expect(first.getSnapshot().data.session?.status).toBe("ringing");
    expect(second.getSnapshot().data.session).toBeNull();
    expect(doubles.notifyAlarm).toHaveBeenCalledOnce();
    expect(
      doubles.trackAlarmEvent.mock.calls.filter(
        ([event]) => event === "alarm_fire",
      ),
    ).toHaveLength(1);
  });

  it("removes lifecycle listeners when disconnected", async () => {
    const store = await loadStore();
    const leave = connect(store);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    leave();
    await flushPromises();
    listener.mockClear();
    storageEvent(makeState({ alarms: [makeAlarm()] }));
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("runs in a single-tab fallback when Web Locks is absent", async () => {
    delete fakeNavigator.locks;
    const store = await loadStore();
    connect(store);
    expect(store.getSnapshot().primary).toBe(true);
    expect(await store.addAlarm(INPUT)).toBe(true);
  });

  it("falls back with a warning when Web Locks rejects", async () => {
    locks.request.mockRejectedValue(new Error("Locks are denied"));
    const store = await loadStore();
    connect(store);
    await flushPromises();
    expect(store.getSnapshot().primary).toBe(true);
    expect(store.getSnapshot().message).toContain("1つのタブ");
  });
});

describe("async gesture operations and state consistency", () => {
  it("calls unlock synchronously within the gesture and preserves changes made while waiting", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    writeState(makeState({ alarms: [makeAlarm()] }));
    const store = await loadStore();
    connect(store);
    const pending = store.addAlarm({ ...INPUT, name: "追加" });
    expect(doubles.unlock).toHaveBeenCalledOnce();
    store.removeAlarm("alarm-0");
    gate.resolve(true);
    expect(await pending).toBe(true);
    expect(store.getSnapshot().data.alarms.map((alarm) => alarm.name)).toEqual([
      "追加",
    ]);
  });

  it("rechecks the eight-alarm limit after concurrent unlock operations", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValue(gate.promise);
    writeState(
      makeState({
        alarms: Array.from({ length: MAX_ALARMS - 1 }, (_, index) =>
          makeAlarm(index),
        ),
      }),
    );
    const store = await loadStore();
    connect(store);
    const first = store.addAlarm({ ...INPUT, name: "8件目" });
    const second = store.addAlarm({ ...INPUT, name: "9件目にしない" });
    gate.resolve(true);
    const results = await Promise.all([first, second]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(store.getSnapshot().data.alarms).toHaveLength(MAX_ALARMS);
  });

  it("does not commit a pending add after the connection was disposed", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const store = await loadStore();
    const leave = connect(store);
    const pending = store.addAlarm(INPUT);
    leave();
    gate.resolve(false);
    expect(await pending).toBe(false);
    expect(store.getSnapshot().data.alarms).toEqual([]);
    expect(doubles.trackAlarmEvent).not.toHaveBeenCalled();
  });

  it("does not apply a previous connection's pending add after reconnection", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const store = await loadStore();
    const leave = connect(store);
    const pending = store.addAlarm(INPUT);
    leave();
    connect(store);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().primary).toBe(true);
    gate.resolve(false);
    expect(await pending).toBe(false);
    expect(store.getSnapshot().data.alarms).toEqual([]);
  });

  it("does not replace a scheduled session that fired while demo unlock was pending", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const scheduled = { ...makeAlarm(), nextAt: NOW + 500 };
    writeState(makeState({ alarms: [scheduled] }));
    const store = await loadStore();
    connect(store);
    const pending = store.startDemo("hell");
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().data.session?.isDemo).toBe(false);
    gate.resolve(true);
    expect(await pending).toBe(false);
    expect(store.getSnapshot().data.session?.alarmId).toBe(scheduled.id);
  });

  it("does not start an awaited demo after its connection was disposed", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const store = await loadStore();
    const leave = connect(store);
    const pending = store.startDemo("normal");
    leave();
    gate.resolve(false);
    expect(await pending).toBe(false);
    expect(store.getSnapshot().data.session).toBeNull();
    expect(doubles.audioInstances).toHaveLength(1);
  });

  it("does not reenable an alarm from a previous connection's pending gesture", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const disabled = { ...makeAlarm(), enabled: false, nextAt: null };
    writeState(makeState({ alarms: [disabled] }));
    const store = await loadStore();
    const leave = connect(store);
    const pending = store.toggleAlarm(disabled.id);
    leave();
    connect(store);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    gate.resolve(false);
    await pending;
    expect(store.getSnapshot().data.alarms[0].enabled).toBe(false);
    expect(doubles.trackAlarmEvent).not.toHaveBeenCalled();
  });

  it("does not restore or count an alarm deleted while reenable unlock is pending", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const disabled = { ...makeAlarm(), enabled: false, nextAt: null };
    writeState(makeState({ alarms: [disabled] }));
    const store = await loadStore();
    connect(store);
    const pending = store.toggleAlarm(disabled.id);
    store.removeAlarm(disabled.id);
    gate.resolve(true);
    await pending;
    expect(store.getSnapshot().data.alarms).toEqual([]);
    expect(doubles.trackAlarmEvent).not.toHaveBeenCalled();
    expect(parseState(storage.values.get(STORAGE_KEY)!).alarms).toEqual([]);
  });

  it("deduplicates concurrent reenables instead of toggling back or counting twice", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValue(gate.promise);
    const disabled = { ...makeAlarm(), enabled: false, nextAt: null };
    writeState(makeState({ alarms: [disabled] }));
    const store = await loadStore();
    connect(store);
    const first = store.toggleAlarm(disabled.id);
    const second = store.toggleAlarm(disabled.id);
    gate.resolve(true);
    await Promise.all([first, second]);
    expect(store.getSnapshot().data.alarms[0]).toMatchObject({
      enabled: true,
      nextAt: new Date(2026, 7, 27, 7).getTime(),
    });
    expect(doubles.trackAlarmEvent).toHaveBeenCalledExactlyOnceWith(
      "alarm_set",
      { difficulty: "normal", source: "reenable" },
    );
  });

  it("uses the latest alarm fields after a pending reenable resumes", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const disabled = { ...makeAlarm(), enabled: false, nextAt: null };
    writeState(makeState({ alarms: [disabled] }));
    const store = await loadStore();
    connect(store);
    const pending = store.toggleAlarm(disabled.id);
    const edited: Alarm = {
      ...disabled,
      time: "08:00",
      difficulty: "hell",
      volume: 70,
    };
    storageEvent(makeState({ alarms: [edited] }));
    gate.resolve(true);
    await pending;
    expect(store.getSnapshot().data.alarms[0]).toMatchObject({
      enabled: true,
      nextAt: new Date(2026, 7, 27, 8).getTime(),
      difficulty: "hell",
      volume: 70,
    });
    expect(doubles.trackAlarmEvent).toHaveBeenCalledExactlyOnceWith(
      "alarm_set",
      { difficulty: "hell", source: "reenable" },
    );
  });

  it("persists an alarm with an explicit warning if gesture audio unlock fails", async () => {
    doubles.unlock.mockResolvedValue(false);
    const store = await loadStore();
    connect(store);
    expect(await store.addAlarm(INPUT)).toBe(true);
    expect(store.getSnapshot().audioReady).toBe(false);
    expect(store.getSnapshot().data.alarms).toHaveLength(1);
    expect(store.getSnapshot().message).toContain("音声を有効にできません");
  });
});

describe("problem-entry audio and snooze clock boundaries", () => {
  it("does not unlock or replace the message when already-ready audio enters solving", async () => {
    const ringing: Session = { ...makeSession(), status: "ringing" };
    writeState(makeState({ session: ringing }));
    const store = await loadStore();
    connect(store);
    await store.enableAudio();
    store.dismissMessage();
    doubles.unlock.mockClear();
    store.beginSolving();
    await flushPromises();
    expect(store.getSnapshot().data.session?.status).toBe("solving");
    expect(store.getSnapshot().audioPlaying).toBe(true);
    expect(doubles.unlock).not.toHaveBeenCalled();
    expect(store.getSnapshot().message).toBe("");
  });

  it("unlocks once from the problem-entry gesture when audio is not ready", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const ringing: Session = { ...makeSession(), status: "ringing" };
    writeState(makeState({ session: ringing }));
    const store = await loadStore();
    connect(store);
    store.beginSolving();
    expect(store.getSnapshot().data.session?.status).toBe("solving");
    expect(doubles.unlock).toHaveBeenCalledOnce();
    store.beginSolving();
    expect(doubles.unlock).toHaveBeenCalledOnce();
    gate.resolve(true);
    await flushPromises();
    expect(store.getSnapshot().audioPlaying).toBe(true);
  });

  it("consults the audio engine rather than a stale ready snapshot", async () => {
    const ringing: Session = { ...makeSession(), status: "ringing" };
    writeState(makeState({ session: ringing }));
    const store = await loadStore();
    connect(store);
    await store.enableAudio();
    doubles.unlock.mockClear();
    // Model a browser suspension before its state-change callback arrives.
    doubles.audioInstances[0].isReady = false;
    doubles.audioInstances[0].isPlaying = false;
    expect(store.getSnapshot().audioReady).toBe(true);
    store.beginSolving();
    expect(doubles.unlock).toHaveBeenCalledOnce();
    await flushPromises();
    expect(store.getSnapshot().audioPlaying).toBe(true);
  });

  it("shows exactly 05:00 immediately after snoozing between timer ticks", async () => {
    writeState(makeState({ session: makeSession() }));
    const store = await loadStore();
    connect(store);
    vi.setSystemTime(NOW + 999);
    expect(store.getSnapshot().now).toBe(NOW);
    store.snooze();
    const current = store.getSnapshot();
    const { formatDuration } = await import("../src/lib/alarm-store");
    expect(current.now).toBe(NOW + 999);
    expect(current.data.session?.snoozeUntil).toBe(NOW + 999 + SNOOZE_MS);
    expect(
      formatDuration(current.data.session!.snoozeUntil! - current.now),
    ).toBe("05:00");
  });

  it("uses a single clock sample for the deadline and displayed snooze start", async () => {
    writeState(makeState({ session: makeSession() }));
    const store = await loadStore();
    connect(store);
    let clockReads = 0;
    const clock = vi
      .spyOn(Date, "now")
      .mockImplementation(() => NOW + 987 + clockReads++);
    try {
      store.snooze();
      store.snooze();
      expect(clockReads).toBe(1);
      expect(store.getSnapshot().now).toBe(NOW + 987);
      expect(store.getSnapshot().data.session?.snoozeUntil).toBe(
        NOW + 987 + SNOOZE_MS,
      );
      expect(store.getSnapshot().data.session?.snoozes).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("alarm, snooze, restore, and completion", () => {
  it("fires the earliest overdue one-shot alarm exactly once on a delayed tick", async () => {
    const early = { ...makeAlarm(1), nextAt: NOW - 10_000 };
    const later = { ...makeAlarm(2), nextAt: NOW - 1000 };
    writeState(makeState({ alarms: [later, early] }));
    const store = await loadStore();
    connect(store);
    expect(store.getSnapshot().data.session).toMatchObject({
      alarmId: early.id,
      status: "ringing",
      isDemo: false,
    });
    expect(
      store.getSnapshot().data.alarms.find((alarm) => alarm.id === early.id),
    ).toMatchObject({ enabled: false, nextAt: null });
    expect(
      store.getSnapshot().data.alarms.find((alarm) => alarm.id === later.id)
        ?.enabled,
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(doubles.notifyAlarm).toHaveBeenCalledTimes(1);
    expect(doubles.trackAlarmEvent).toHaveBeenCalledWith(
      "alarm_fire",
      { difficulty: "normal", source: "scheduled" },
      false,
    );
    expect(doubles.unlock).not.toHaveBeenCalled();
  });

  it("detects a due alarm when visibility returns before another timer tick", async () => {
    writeState(
      makeState({ alarms: [{ ...makeAlarm(), nextAt: NOW + 10_000 }] }),
    );
    const store = await loadStore();
    connect(store);
    vi.setSystemTime(NOW + 60_000);
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    expect(store.getSnapshot().data.session?.status).toBe("ringing");
    expect(doubles.notifyAlarm).toHaveBeenCalledOnce();
  });

  it("restores progress but never restores or requests audio permission automatically", async () => {
    const session = { ...makeSession(), solved: 3, mistakes: 2 };
    storage.values.set(
      STORAGE_KEY,
      JSON.stringify({ ...makeState({ session }), audioReady: true }),
    );
    const store = await loadStore();
    connect(store);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getSnapshot().data.session).toEqual(session);
    expect(store.getSnapshot().audioReady).toBe(false);
    expect(store.getSnapshot().audioPlaying).toBe(false);
    expect(doubles.unlock).not.toHaveBeenCalled();
    await store.enableAudio();
    expect(doubles.unlock).toHaveBeenCalledOnce();
    expect(doubles.audioInstances[0].start).toHaveBeenCalledWith(
      session.volume,
    );
    expect(store.getSnapshot().audioPlaying).toBe(true);
  });

  it("stops audio for five minutes while preserving progress and counting snoozes", async () => {
    const session = { ...makeSession(), solved: 2, mistakes: 1 };
    writeState(makeState({ session }));
    const store = await loadStore();
    connect(store);
    await store.enableAudio();
    store.snooze();
    expect(store.getSnapshot().data.session).toMatchObject({
      status: "snoozed",
      solved: 2,
      mistakes: 1,
      snoozes: 1,
      snoozeUntil: NOW + SNOOZE_MS,
    });
    expect(store.getSnapshot().audioPlaying).toBe(false);
    store.snooze();
    expect(store.getSnapshot().data.session?.snoozes).toBe(1);
    await vi.advanceTimersByTimeAsync(SNOOZE_MS - 1000);
    expect(store.getSnapshot().data.session?.status).toBe("snoozed");
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().data.session).toMatchObject({
      status: "ringing",
      solved: 2,
      snoozes: 1,
      snoozeUntil: null,
    });
    expect(store.getSnapshot().data.session?.question).toEqual(
      session.question,
    );
    expect(store.getSnapshot().audioPlaying).toBe(true);
    expect(doubles.trackAlarmEvent).toHaveBeenCalledWith(
      "alarm_snooze",
      { difficulty: "normal", snoozes: 1 },
      false,
    );
    expect(doubles.trackAlarmEvent).toHaveBeenCalledWith(
      "alarm_fire",
      { difficulty: "normal", source: "snooze" },
      false,
    );
    expect(doubles.unlock).toHaveBeenCalledTimes(1);
  });

  it("does not play when explicitly enabling audio during a snooze", async () => {
    const session: Session = {
      ...makeSession(),
      status: "snoozed",
      snoozes: 1,
      snoozeUntil: NOW + SNOOZE_MS,
    };
    writeState(makeState({ session }));
    const store = await loadStore();
    connect(store);
    await store.enableAudio();
    expect(store.getSnapshot().audioReady).toBe(true);
    expect(store.getSnapshot().audioPlaying).toBe(false);
    expect(doubles.audioInstances[0].start).not.toHaveBeenCalled();
  });

  it("finishes five correct answers, persists history, and emits no private fields", async () => {
    writeState(makeState({ session: makeSession() }));
    const store = await loadStore();
    connect(store);
    for (let index = 0; index < 5; index += 1) {
      const session = store.getSnapshot().data.session!;
      expect(store.answer(String(session.question.answer))).toBe(true);
    }
    expect(store.getSnapshot().data.session).toBeNull();
    expect(store.getSnapshot().result).toMatchObject({
      result: "completed",
      solved: 5,
      total: 5,
    });
    expect(store.getSnapshot().data.history).toHaveLength(1);
    expect(parseState(storage.values.get(STORAGE_KEY)!).history[0].result).toBe(
      "completed",
    );
    expect(doubles.trackAlarmEvent).toHaveBeenCalledWith(
      "alarm_stop",
      { difficulty: "normal", result: "completed" },
      false,
    );
    for (const [, properties] of doubles.trackAlarmEvent.mock.calls) {
      expect(properties).not.toHaveProperty("name");
      expect(properties).not.toHaveProperty("time");
      expect(properties).not.toHaveProperty("answer");
      expect(properties).not.toHaveProperty("id");
    }
  });

  it("separates emergency-stop history from successful completion", async () => {
    writeState(makeState({ session: { ...makeSession(), solved: 2 } }));
    const store = await loadStore();
    connect(store);
    store.emergencyStop();
    expect(store.getSnapshot().data.session).toBeNull();
    expect(store.getSnapshot().result).toBeNull();
    expect(store.getSnapshot().data.history[0]).toMatchObject({
      result: "emergency",
      solved: 2,
      total: 5,
    });
  });

  it("runs a silent 99-question demo and reaches a real 100th-question completion", async () => {
    const existing = makeAlarm();
    writeState(makeState({ alarms: [existing] }));
    const store = await loadStore();
    connect(store);
    expect(await store.startDemo("normal", true)).toBe(true);
    const glitch = store.getSnapshot().data.session!;
    expect(glitch).toMatchObject({
      difficulty: "hell",
      solved: 99,
      total: 100,
      status: "glitch",
      volume: 0,
      isDemo: true,
    });
    expect(store.getSnapshot().data.alarms).toEqual([existing]);
    expect(doubles.unlock).not.toHaveBeenCalled();
    expect(doubles.notifyAlarm).not.toHaveBeenCalled();
    store.resumeGlitch();
    expect(store.getSnapshot().data.session?.status).toBe("solving");
    expect(store.answer(String(glitch.question.answer))).toBe(true);
    expect(store.getSnapshot().data.session).toBeNull();
    expect(store.getSnapshot().data.history[0]).toMatchObject({
      result: "completed",
      total: 100,
      solved: 100,
      isDemo: true,
    });
    expect(doubles.trackAlarmEvent).toHaveBeenCalledWith(
      "alarm_stop",
      { difficulty: "hell", result: "completed" },
      true,
    );
  });
});

describe("queued alarms and interactions with an active session", () => {
  it("adds another alarm without overwriting progress changed during audio unlock", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const session = { ...makeSession(), solved: 2 };
    writeState(makeState({ session }));
    const store = await loadStore();
    connect(store);
    const pending = store.addAlarm({ ...INPUT, name: "次の予定" });
    store.answer(String(session.question.answer));
    const progressed = store.getSnapshot().data.session;
    gate.resolve(true);
    expect(await pending).toBe(true);
    expect(store.getSnapshot().data.session).toEqual(progressed);
    expect(store.getSnapshot().data.session?.solved).toBe(3);
    expect(store.getSnapshot().data.alarms[0].name).toBe("次の予定");
  });

  it("does not resurrect a completed session when a pending add finishes", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const session = { ...makeSession(), solved: 4 };
    writeState(makeState({ session }));
    const store = await loadStore();
    connect(store);
    const pending = store.addAlarm(INPUT);
    store.answer(String(session.question.answer));
    expect(store.getSnapshot().data.session).toBeNull();
    gate.resolve(true);
    expect(await pending).toBe(true);
    expect(store.getSnapshot().data.session).toBeNull();
    expect(store.getSnapshot().data.history[0]).toMatchObject({
      result: "completed",
      solved: 5,
    });
    expect(store.getSnapshot().data.alarms).toHaveLength(1);
  });

  it("processes overdue alarms in order after completion or emergency stop", async () => {
    const first = { ...makeAlarm(1), nextAt: NOW - 30_000 };
    const second = { ...makeAlarm(2), nextAt: NOW - 20_000 };
    const third = { ...makeAlarm(3), nextAt: NOW - 10_000 };
    writeState(makeState({ alarms: [third, first, second] }));
    const store = await loadStore();
    connect(store);
    expect(store.getSnapshot().data.session?.alarmId).toBe(first.id);
    store.beginSolving();
    for (let index = 0; index < 5; index += 1) {
      store.answer(String(store.getSnapshot().data.session!.question.answer));
    }
    expect(store.getSnapshot().data.history).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().data.session?.alarmId).toBe(second.id);
    store.emergencyStop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().data.session?.alarmId).toBe(third.id);
    expect(
      store.getSnapshot().data.history.map((entry) => entry.result),
    ).toEqual(["emergency", "completed"]);
    expect(
      store
        .getSnapshot()
        .data.alarms.every((alarm) => !alarm.enabled && alarm.nextAt === null),
    ).toBe(true);
    expect(doubles.notifyAlarm).toHaveBeenCalledTimes(3);
  });

  it("preserves a snoozed session while later alarms wait, including manual early resume", async () => {
    const active: Session = {
      ...makeSession(),
      solved: 2,
      status: "snoozed",
      snoozes: 1,
      snoozeUntil: NOW + SNOOZE_MS,
    };
    const waiting = { ...makeAlarm(2), nextAt: NOW + 500 };
    writeState(makeState({ session: active, alarms: [waiting] }));
    const store = await loadStore();
    connect(store);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().data.session).toEqual(active);
    expect(store.getSnapshot().data.alarms[0].enabled).toBe(true);
    expect(doubles.notifyAlarm).not.toHaveBeenCalled();
    store.resumeNow();
    await flushPromises();
    expect(store.getSnapshot().data.session).toMatchObject({
      id: active.id,
      solved: 2,
      snoozes: 1,
      status: "ringing",
      snoozeUntil: null,
    });
    store.emergencyStop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().data.session).toMatchObject({
      alarmId: waiting.id,
      solved: 0,
      snoozes: 0,
      isDemo: false,
    });
    expect(store.getSnapshot().data.history[0]).toMatchObject({
      id: active.id,
      result: "emergency",
      solved: 2,
      snoozes: 1,
    });
  });

  it("keeps a real scheduled alarm queued during a demo and fires it after the demo ends", async () => {
    const waiting = { ...makeAlarm(), nextAt: NOW + 500 };
    writeState(makeState({ alarms: [waiting] }));
    const store = await loadStore();
    connect(store);
    expect(await store.startDemo("normal")).toBe(true);
    const demoId = store.getSnapshot().data.session!.id;
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getSnapshot().data.session?.id).toBe(demoId);
    expect(store.getSnapshot().data.session?.isDemo).toBe(true);
    expect(store.getSnapshot().data.alarms[0].enabled).toBe(true);
    store.emergencyStop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().data.session).toMatchObject({
      alarmId: waiting.id,
      isDemo: false,
    });
    expect(doubles.notifyAlarm).toHaveBeenCalledOnce();
  });

  it("protects the active alarm from removal while allowing other settings to change", async () => {
    const activeAlarm = { ...makeAlarm(), enabled: false, nextAt: null };
    const session = makeSession();
    const other = makeAlarm(2);
    writeState(makeState({ alarms: [activeAlarm, other], session }));
    const store = await loadStore();
    connect(store);
    store.removeAlarm(activeAlarm.id);
    expect(store.getSnapshot().data.alarms).toHaveLength(2);
    store.removeAlarm(other.id);
    expect(store.getSnapshot().data.alarms).toHaveLength(1);
    await store.toggleAlarm(activeAlarm.id);
    expect(store.getSnapshot().data.alarms[0]).toMatchObject({
      enabled: true,
      nextAt: new Date(2026, 7, 27, 7).getTime(),
    });
    expect(store.getSnapshot().data.session).toEqual(session);
  });

  it("uses the current queued session volume after an earlier resume unlock resolves", async () => {
    const gate = deferred<boolean>();
    doubles.unlock.mockReturnValueOnce(gate.promise);
    const active: Session = {
      ...makeSession(),
      volume: 10,
      status: "snoozed",
      snoozes: 1,
      snoozeUntil: NOW + SNOOZE_MS,
    };
    const waiting = { ...makeAlarm(2), volume: 70, nextAt: NOW + 500 };
    writeState(makeState({ session: active, alarms: [waiting] }));
    const store = await loadStore();
    connect(store);
    store.resumeNow();
    store.emergencyStop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().data.session?.alarmId).toBe(waiting.id);
    gate.resolve(true);
    await flushPromises();
    expect(doubles.audioInstances[0].start).toHaveBeenLastCalledWith(70);
    expect(store.getSnapshot().audioPlaying).toBe(true);
    expect(store.getSnapshot().data.session?.alarmId).toBe(waiting.id);
  });
});

describe("storage and user-controlled browser features", () => {
  it("keeps in-memory state when writes fail, and recovers when storage returns", async () => {
    storage.failures.write = true;
    const store = await loadStore();
    connect(store);
    expect(await store.addAlarm(INPUT)).toBe(true);
    expect(store.getSnapshot().storageOk).toBe(false);
    expect(store.getSnapshot().data.alarms).toHaveLength(1);
    expect(await store.startDemo("normal")).toBe(true);
    store.beginSolving();
    store.answer(String(store.getSnapshot().data.session!.question.answer));
    expect(store.getSnapshot().data.session?.solved).toBe(1);
    expect(store.getSnapshot().storageOk).toBe(false);
    expect(storage.values.has(STORAGE_KEY)).toBe(false);
    storage.failures.write = false;
    store.answer(String(store.getSnapshot().data.session!.question.answer));
    expect(store.getSnapshot().storageOk).toBe(true);
    expect(parseState(storage.values.get(STORAGE_KEY)!).session?.solved).toBe(
      2,
    );
  });

  it("starts safely with a visible storage flag when localStorage access is denied", async () => {
    storage.failures.read = true;
    storage.failures.write = true;
    const store = await loadStore();
    connect(store);
    expect(store.getSnapshot().data).toEqual(EMPTY_STATE);
    expect(store.getSnapshot().storageOk).toBe(false);
    expect(await store.addAlarm(INPUT)).toBe(true);
    expect(store.getSnapshot().data.alarms).toHaveLength(1);
  });

  it("repairs malformed saved state instead of crashing", async () => {
    storage.values.set(STORAGE_KEY, "not-json");
    const store = await loadStore();
    connect(store);
    expect(store.getSnapshot().data).toEqual(EMPTY_STATE);
    expect(store.getSnapshot().message).toContain("修復");
  });

  it("follows cross-tab storage updates and stops audio when a session disappears", async () => {
    writeState(makeState({ session: makeSession() }));
    const store = await loadStore();
    connect(store);
    await store.enableAudio();
    storageEvent(makeState());
    expect(store.getSnapshot().data.session).toBeNull();
    expect(store.getSnapshot().audioPlaying).toBe(false);
  });

  it("requests notification permission only through the explicit method", async () => {
    const store = await loadStore();
    connect(store);
    await vi.advanceTimersByTimeAsync(3000);
    expect(doubles.requestNotificationPermission).not.toHaveBeenCalled();
    await store.requestNotifications();
    expect(doubles.requestNotificationPermission).toHaveBeenCalledOnce();
    expect(store.getSnapshot().notification).toBe("granted");
  });

  it("restores and persists the explicit light/dark preference", async () => {
    storage.values.set("impossible-alarm:theme", "light");
    const store = await loadStore();
    connect(store);
    expect(store.getSnapshot().theme).toBe("light");
    expect(fakeDocument.documentElement.dataset.theme).toBe("light");
    store.toggleTheme();
    expect(store.getSnapshot().theme).toBe("dark");
    expect(fakeDocument.documentElement.dataset.theme).toBe("dark");
    expect(storage.values.get("impossible-alarm:theme")).toBe("dark");
  });
});
