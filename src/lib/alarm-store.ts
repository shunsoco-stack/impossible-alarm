"use client";

import {
  EMPTY_STATE,
  DIFFICULTIES,
  MAX_ALARMS,
  addHistory,
  checkAlarmDue,
  createAlarm,
  createSession,
  finishSession,
  nextAlarmAt,
  parseState,
  resumeAfterGlitch,
  snoozeSession,
  submitAnswer,
  wakeSnoozedSession,
  type Alarm,
  type AppState,
  type Difficulty,
  type HistoryEntry,
} from "./alarm";
import { AlarmAudio } from "./audio";
import {
  notificationSupport,
  notifyAlarm,
  requestNotificationPermission,
} from "./notifications";
import { trackAlarmEvent } from "./analytics";

export const STORAGE_KEY = "impossible-alarm:v1";
const THEME_KEY = "impossible-alarm:theme";

type Snapshot = {
  data: AppState;
  ready: boolean;
  now: number;
  primary: boolean;
  storageOk: boolean;
  audioReady: boolean;
  audioPlaying: boolean;
  notification: NotificationPermission | "unsupported";
  theme: "dark" | "light";
  message: string;
  result: HistoryEntry | null;
};

const SERVER_SNAPSHOT: Snapshot = {
  data: EMPTY_STATE,
  ready: false,
  now: 0,
  primary: false,
  storageOk: true,
  audioReady: false,
  audioPlaying: false,
  notification: "default",
  theme: "dark",
  message: "",
  result: null,
};
let snapshot: Snapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let audio: AlarmAudio | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let releaseLock: (() => void) | null = null;
let lockPending = false;
let connected = 0;
let generation = 0;

function emit(update: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...update };
  listeners.forEach((listener) => listener());
}

function commit(data: AppState, extra: Partial<Snapshot> = {}) {
  let storageOk = snapshot.storageOk;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    storageOk = true;
  } catch {
    storageOk = false;
  }
  emit({ data, storageOk, ...extra });
}

function getAudio() {
  if (!audio) {
    audio = new AlarmAudio((state) => {
      emit({ audioReady: state.isReady, audioPlaying: state.isPlaying });
    });
  }
  return audio;
}

function syncSound() {
  const session = snapshot.data.session;
  if (!snapshot.primary || !session || session.status === "snoozed") {
    audio?.stop();
    return;
  }
  getAudio().start(session.volume);
}

function announceFire(source: "scheduled" | "snooze") {
  const session = snapshot.data.session;
  if (!session) return;
  syncSound();
  if (!session.isDemo) void notifyAlarm(session.name);
  trackAlarmEvent(
    "alarm_fire",
    { difficulty: session.difficulty, source },
    session.isDemo,
  );
}

function tick() {
  const now = Date.now();
  emit({ now, notification: notificationSupport() });
  if (!snapshot.primary || !snapshot.ready) return;
  const { data } = snapshot;
  if (data.session?.status === "snoozed") {
    const session = wakeSnoozedSession(data.session, now);
    if (session.status !== "snoozed") {
      commit({ ...data, session });
      announceFire("snooze");
    }
  } else if (!data.session) {
    const due = data.alarms
      .filter((alarm) => checkAlarmDue(alarm, now))
      .sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0))[0];
    if (due) {
      commit(
        {
          ...data,
          alarms: data.alarms.map((alarm) =>
            alarm.id === due.id
              ? { ...alarm, enabled: false, nextAt: null }
              : alarm,
          ),
          session: createSession(due, now),
        },
        {
          result: null,
          message: "アラームの時間です。計算問題を解いて止めましょう。",
        },
      );
      announceFire("scheduled");
    }
  }
}

async function tryLock(expectedGeneration: number) {
  if (lockPending || releaseLock || !connected) return;
  if (!("locks" in navigator)) {
    emit({ primary: true });
    return;
  }
  lockPending = true;
  try {
    await navigator.locks.request(
      "impossible-alarm:active-tab",
      { ifAvailable: true },
      async (lock) => {
        if (!connected || expectedGeneration !== generation) return;
        if (!lock) {
          emit({ primary: false });
          return;
        }
        // Re-read after acquiring leadership: another tab may have advanced progress.
        let data = snapshot.data;
        try {
          data = parseState(localStorage.getItem(STORAGE_KEY));
        } catch {
          /* Memory-only mode. */
        }
        emit({ primary: true, data });
        tick();
        await new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        releaseLock = null;
      },
    );
  } catch {
    // Some private browsers expose Locks but deny access. Use one tab in this case.
    if (connected)
      emit({
        primary: true,
        message:
          "タブ間の排他制御が使えません。このアプリは1つのタブだけで利用してください。",
      });
  } finally {
    lockPending = false;
  }
}

function onStorage(event: StorageEvent) {
  if (event.key === STORAGE_KEY) {
    emit({ data: parseState(event.newValue) });
    if (!snapshot.data.session) audio?.stop();
  }
}

function onVisible() {
  if (document.visibilityState === "visible") {
    tick();
    emit({ audioReady: audio?.isReady ?? false });
  }
}

export const alarmStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => SERVER_SNAPSHOT,
  connect() {
    connected += 1;
    if (connected === 1) {
      generation += 1;
      let data: AppState = EMPTY_STATE;
      let storageOk = true;
      let theme: "dark" | "light" = "dark";
      let message = "";
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        data = parseState(raw);
        if (raw && JSON.stringify(data) !== raw)
          message =
            "保存データを確認し、読み込めない項目を安全に修復しました。設定を確認してください。";
        if (localStorage.getItem(THEME_KEY) === "light") theme = "light";
      } catch {
        storageOk = false;
      }
      document.documentElement.dataset.theme = theme;
      emit({
        data,
        ready: true,
        storageOk,
        theme,
        now: Date.now(),
        message,
        primary: false,
      });
      getAudio();
      void tryLock(generation);
      timer = setInterval(() => {
        tick();
        if (!snapshot.primary) void tryLock(generation);
      }, 1000);
      window.addEventListener("storage", onStorage);
      document.addEventListener("visibilitychange", onVisible);
      if (
        "serviceWorker" in navigator &&
        process.env.NODE_ENV === "production"
      ) {
        void navigator.serviceWorker.register("/sw.js").catch(() => {
          emit({
            message:
              "オフライン機能を準備できませんでした。オンラインでご利用ください。",
          });
        });
      }
    }
    return () => {
      connected = Math.max(0, connected - 1);
      if (!connected) {
        generation += 1;
        emit({ primary: false });
        if (timer) clearInterval(timer);
        timer = null;
        releaseLock?.();
        window.removeEventListener("storage", onStorage);
        document.removeEventListener("visibilitychange", onVisible);
        audio?.dispose();
        audio = null;
      }
    };
  },
  async addAlarm(
    input: Pick<Alarm, "name" | "time" | "difficulty" | "volume">,
  ) {
    if (!snapshot.primary || !connected) return false;
    const startedGeneration = generation;
    if (snapshot.data.alarms.length >= MAX_ALARMS) {
      emit({
        message:
          "保存できるアラームは8件までです。不要なアラームを削除してください。",
      });
      return false;
    }
    try {
      const alarm = createAlarm(input, Date.now(), crypto.randomUUID());
      const ready = await getAudio().unlock();
      if (!snapshot.primary || !connected || generation !== startedGeneration)
        return false;
      if (snapshot.data.alarms.length >= MAX_ALARMS) {
        emit({
          message:
            "保存できるアラームは8件までです。不要なアラームを削除してください。",
        });
        return false;
      }
      commit(
        { ...snapshot.data, alarms: [...snapshot.data.alarms, alarm] },
        {
          audioReady: ready,
          message: ready
            ? "アラームを設定しました。ブラウザやPWAを開いたままお使いください。"
            : "設定を保存しましたが音声を有効にできませんでした。「音を有効にする」を押してください。",
        },
      );
      trackAlarmEvent("alarm_set", { difficulty: alarm.difficulty });
      return true;
    } catch {
      emit({
        message:
          "設定を保存できませんでした。時刻とアラーム名を確認してください。",
      });
      return false;
    }
  },
  async toggleAlarm(id: string) {
    if (!snapshot.primary || !connected) return;
    const startedGeneration = generation;
    const alarm = snapshot.data.alarms.find((item) => item.id === id);
    if (!alarm) return;
    if (!alarm.enabled) await getAudio().unlock();
    if (!snapshot.primary || !connected || generation !== startedGeneration)
      return;
    const current = snapshot.data.alarms.find((item) => item.id === id);
    if (!current || current.enabled !== alarm.enabled) return;
    const alarms = snapshot.data.alarms.map((item) =>
      item.id === id
        ? {
            ...item,
            enabled: !item.enabled,
            nextAt: item.enabled ? null : nextAlarmAt(item.time, Date.now()),
          }
        : item,
    );
    commit({ ...snapshot.data, alarms });
    if (!current.enabled)
      trackAlarmEvent("alarm_set", {
        difficulty: current.difficulty,
        source: "reenable",
      });
  },
  removeAlarm(id: string) {
    if (!snapshot.primary || snapshot.data.session?.alarmId === id) return;
    commit(
      {
        ...snapshot.data,
        alarms: snapshot.data.alarms.filter((alarm) => alarm.id !== id),
      },
      { message: "アラームを削除しました。" },
    );
  },
  async preview(volume: number) {
    if (!snapshot.primary || !connected || snapshot.data.session) return;
    const startedGeneration = generation;
    if (audio?.isPlaying) {
      audio.stop();
      return;
    }
    const ready = await getAudio().preview(volume);
    if (!connected || generation !== startedGeneration) return;
    if (!ready)
      emit({
        message:
          "このブラウザで音を再生できません。端末の音量とブラウザの権限を確認してください。",
      });
  },
  setPreviewVolume(volume: number) {
    audio?.setVolume(volume);
  },
  async enableAudio() {
    if (!snapshot.primary || !connected) return;
    const startedGeneration = generation;
    const ready = await getAudio().unlock();
    if (!connected || generation !== startedGeneration || !snapshot.primary)
      return;
    emit({
      audioReady: ready,
      message: ready
        ? "音声を有効にしました。端末の音量も確認してください。"
        : "音声を有効にできませんでした。端末とブラウザの設定を確認してください。",
    });
    if (ready && snapshot.data.session?.status !== "snoozed") syncSound();
  },
  async startDemo(difficulty: Difficulty, glitch = false) {
    if (!snapshot.primary || !connected || snapshot.data.session) return false;
    const startedGeneration = generation;
    // Call in the click event, before yielding, to satisfy browser autoplay policies.
    if (!glitch) await getAudio().unlock();
    if (
      !snapshot.primary ||
      !connected ||
      generation !== startedGeneration ||
      snapshot.data.session
    )
      return false;
    const alarm = createAlarm(
      {
        name: glitch ? "99問目の、悪夢。" : "朝の予行演習",
        time: "07:00",
        difficulty: glitch ? "hell" : difficulty,
        volume: glitch ? 0 : 35,
      },
      Date.now(),
      "demo",
    );
    let session = createSession(alarm, Date.now(), true);
    if (glitch) {
      session = { ...session, status: "solving" };
      for (let i = 0; i < 99; i += 1) {
        const next = submitAnswer(
          session,
          String(session.question.answer),
          Date.now(),
        );
        if (next.session) session = next.session;
      }
    }
    commit(
      { ...snapshot.data, session },
      {
        result: null,
        message: "体験モードです。実際の設定アラームは変更しません。",
      },
    );
    syncSound();
    return true;
  },
  beginSolving() {
    const session = snapshot.data.session;
    if (!snapshot.primary || !session || session.status !== "ringing") return;
    commit({ ...snapshot.data, session: { ...session, status: "solving" } });
    if (!audio?.isReady) void alarmStore.enableAudio();
    else syncSound();
  },
  answer(answer: string) {
    const session = snapshot.data.session;
    if (!snapshot.primary || !session) return false;
    const result = submitAnswer(session, answer, Date.now());
    if (result.entry) {
      audio?.stop();
      commit(
        {
          ...snapshot.data,
          session: null,
          history: addHistory(snapshot.data.history, result.entry),
        },
        { result: result.entry },
      );
      trackAlarmEvent(
        "alarm_stop",
        { difficulty: session.difficulty, result: "completed" },
        session.isDemo,
      );
    } else if (result.session) {
      commit({ ...snapshot.data, session: result.session });
    }
    return result.correct;
  },
  resumeGlitch() {
    const session = snapshot.data.session;
    if (!snapshot.primary || !session) return;
    commit({ ...snapshot.data, session: resumeAfterGlitch(session) });
  },
  snooze() {
    const session = snapshot.data.session;
    if (!snapshot.primary || !session || session.status === "snoozed") return;
    audio?.stop();
    const now = Date.now();
    const next = snoozeSession(session, now);
    commit(
      { ...snapshot.data, session: next },
      { now, message: "5分だけ、逃がしてあげます。進捗は保存済みです。" },
    );
    trackAlarmEvent(
      "alarm_snooze",
      { difficulty: session.difficulty, snoozes: next.snoozes },
      session.isDemo,
    );
  },
  resumeNow() {
    const session = snapshot.data.session;
    if (!snapshot.primary || !session || session.status !== "snoozed") return;
    commit({
      ...snapshot.data,
      session: { ...session, status: "ringing", snoozeUntil: null },
    });
    void alarmStore.enableAudio();
  },
  emergencyStop() {
    const session = snapshot.data.session;
    if (!snapshot.primary || !session) return;
    audio?.stop();
    const entry = finishSession(session, Date.now(), "emergency");
    commit(
      {
        ...snapshot.data,
        session: null,
        history: addHistory(snapshot.data.history, entry),
      },
      {
        result: null,
        message: session.isDemo
          ? "体験を終了しました。"
          : "安全のため緊急停止しました。起床成功にはカウントされません。",
      },
    );
    trackAlarmEvent(
      "alarm_stop",
      { difficulty: session.difficulty, result: "emergency" },
      session.isDemo,
    );
  },
  async requestNotifications() {
    const permission = await requestNotificationPermission();
    emit({
      notification: permission,
      message:
        permission === "granted"
          ? "通知を許可しました。通知も配信を保証するものではありません。"
          : permission === "denied"
            ? "通知は許可されていません。変更する場合はブラウザのサイト設定を開いてください。"
            : "通知は有効になっていません。音と画面だけでも利用できます。",
    });
  },
  toggleTheme() {
    const theme = snapshot.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* Optional preference. */
    }
    emit({ theme });
  },
  dismissResult() {
    emit({ result: null });
  },
  dismissMessage() {
    emit({ message: "" });
  },
};

export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function difficultyLabel(difficulty: Difficulty) {
  return DIFFICULTIES[difficulty].label;
}
