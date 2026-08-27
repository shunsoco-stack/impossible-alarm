/** Pure, versioned alarm state. Nothing in this module needs browser storage. */
export type Difficulty = "normal" | "crap" | "hell";

export const DIFFICULTIES = {
  normal: { label: "普通", total: 5, caption: "まずは、脳を起こす5問。" },
  crap: { label: "クソ", total: 20, caption: "昨日の自分を恨む20問。" },
  hell: { label: "地獄", total: 100, caption: "朝から人生を考える100問。" },
} as const satisfies Record<
  Difficulty,
  { label: string; total: number; caption: string }
>;

export const STORAGE_KEY = "impossible-alarm:v1";
export const MAX_HISTORY = 100;
export const MAX_ALARMS = 8;
export const MAX_NAME_LENGTH = 60;
export const SNOOZE_MS = 5 * 60 * 1000;
const MAX_STORAGE_CHARACTERS = 256_000;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_COUNTER = 1_000_000;
const MAX_OPERAND = 999;

export interface Alarm {
  id: string;
  name: string;
  time: string;
  difficulty: Difficulty;
  volume: number;
  enabled: boolean;
  nextAt: number | null;
}

export interface Question {
  left: number;
  right: number;
  operator: "+" | "-" | "×";
  answer: number;
}

export interface Session {
  id: string;
  alarmId: string;
  name: string;
  difficulty: Difficulty;
  volume: number;
  total: number;
  solved: number;
  question: Question;
  status: "ringing" | "solving" | "glitch" | "snoozed";
  startedAt: number;
  snoozeUntil: number | null;
  snoozes: number;
  mistakes: number;
  isDemo: boolean;
}

export interface HistoryEntry {
  id: string;
  name: string;
  difficulty: Difficulty;
  total: number;
  solved: number;
  snoozes: number;
  mistakes: number;
  startedAt: number;
  endedAt: number;
  result: "completed" | "emergency";
  isDemo: boolean;
}

export interface AppState {
  version: 1;
  alarms: Alarm[];
  session: Session | null;
  history: HistoryEntry[];
}

export interface CreateAlarmInput {
  name: string;
  time: string;
  difficulty: Difficulty;
  volume: number;
}

export const EMPTY_STATE: AppState = {
  version: 1,
  alarms: [],
  session: null,
  history: [],
};

function emptyState(): AppState {
  return { version: 1, alarms: [], session: null, history: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDifficulty(value: unknown): value is Difficulty {
  return value === "normal" || value === "crap" || value === "hell";
}

function isInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isTimestamp(value: unknown): value is number {
  return isInteger(value, 0, MAX_TIMESTAMP);
}

function isVolume(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

function isText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isTime(value: unknown): value is string {
  return (
    typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)
  );
}

/** The next occurrence in the device's local time zone; alarms are one-shot. */
export function nextAlarmAt(time: string, now: number = Date.now()): number {
  if (!isTime(time) || !isTimestamp(now))
    throw new Error("有効な時刻を設定してください。");
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now) {
    next.setDate(next.getDate() + 1);
    // Reapply the requested wall-clock time after calendar/DST normalization.
    next.setHours(hours, minutes, 0, 0);
  }
  const result = next.getTime();
  if (!isTimestamp(result))
    throw new Error("この日時にはアラームを設定できません。");
  return result;
}

export function createAlarm(
  input: CreateAlarmInput,
  now: number = Date.now(),
  id: string = crypto.randomUUID(),
): Alarm {
  const name = input.name.trim() || "起きる時間";
  if (
    !isText(name, MAX_NAME_LENGTH) ||
    !isText(id, 128) ||
    !isDifficulty(input.difficulty) ||
    !isVolume(input.volume)
  ) {
    throw new Error("アラームの設定を確認してください。");
  }
  return {
    id,
    name,
    time: input.time,
    difficulty: input.difficulty,
    volume: input.volume,
    enabled: true,
    nextAt: nextAlarmAt(input.time, now),
  };
}

/** A deterministic PRNG seeded by a random session id, so reducers stay pure. */
function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function calculateAnswer(
  question: Pick<Question, "left" | "right" | "operator">,
): number {
  if (question.operator === "+") return question.left + question.right;
  if (question.operator === "-") return question.left - question.right;
  return question.left * question.right;
}

export function createQuestion(difficulty: Difficulty, seed: string): Question {
  const random = seededRandom(seed);
  const operators = ["+", "-", "×"] as const;
  const operator = operators[Math.floor(random() * operators.length)];
  const maximum =
    operator === "×"
      ? { normal: 9, crap: 12, hell: 15 }[difficulty]
      : { normal: 12, crap: 40, hell: 99 }[difficulty];
  let left = 1 + Math.floor(random() * maximum);
  let right = 1 + Math.floor(random() * maximum);
  if (operator === "-" && left < right) [left, right] = [right, left];
  return {
    left,
    right,
    operator,
    answer: calculateAnswer({ left, right, operator }),
  };
}

export function createSession(
  alarm: Alarm,
  now: number = Date.now(),
  isDemo = false,
): Session {
  if (
    !isText(alarm.id, 128) ||
    !isText(alarm.name, MAX_NAME_LENGTH) ||
    !isDifficulty(alarm.difficulty) ||
    !isVolume(alarm.volume) ||
    !isTimestamp(now)
  )
    throw new Error("アラームを開始できません。");
  const id = crypto.randomUUID();
  return {
    id,
    alarmId: alarm.id,
    name: alarm.name,
    difficulty: alarm.difficulty,
    volume: alarm.volume,
    total: DIFFICULTIES[alarm.difficulty].total,
    solved: 0,
    question: createQuestion(alarm.difficulty, `${id}:0`),
    status: "ringing",
    startedAt: now,
    snoozeUntil: null,
    snoozes: 0,
    mistakes: 0,
    isDemo,
  };
}

/** Delayed timer callbacks and returning to a suspended tab must still detect due alarms. */
export function checkAlarmDue(alarm: Alarm, now: number): boolean {
  return (
    alarm.enabled &&
    alarm.nextAt !== null &&
    isTimestamp(alarm.nextAt) &&
    isTimestamp(now) &&
    now >= alarm.nextAt
  );
}

export function finishSession(
  session: Session,
  now: number,
  result: HistoryEntry["result"],
): HistoryEntry {
  if (!isTimestamp(now)) throw new Error("有効な日時が必要です。");
  if (result === "completed" && session.solved !== session.total) {
    throw new Error("すべての問題に正解するまで完了にはできません。");
  }
  return {
    id: session.id,
    name: session.name,
    difficulty: session.difficulty,
    total: session.total,
    solved: session.solved,
    snoozes: session.snoozes,
    mistakes: session.mistakes,
    startedAt: session.startedAt,
    endedAt: Math.max(now, session.startedAt),
    result,
    isDemo: session.isDemo,
  };
}

export function submitAnswer(
  session: Session,
  answer: string,
  now: number,
): { session: Session | null; correct: boolean; entry: HistoryEntry | null } {
  if (session.status !== "solving")
    return { session, correct: false, entry: null };
  const normalized = answer.normalize("NFKC").trim();
  if (normalized.length === 0) return { session, correct: false, entry: null };

  // Accept full-width digits, but never expressions, exponent notation, or decimals.
  if (
    !/^\d{1,6}$/u.test(normalized) ||
    Number(normalized) !== calculateAnswer(session.question)
  ) {
    return {
      session: {
        ...session,
        mistakes: Math.min(MAX_COUNTER, session.mistakes + 1),
      },
      correct: false,
      entry: null,
    };
  }

  const solved = session.solved + 1;
  const nextSession = { ...session, solved };
  if (solved >= session.total) {
    return {
      session: null,
      correct: true,
      entry: finishSession(nextSession, now, "completed"),
    };
  }

  return {
    correct: true,
    entry: null,
    session: {
      ...nextSession,
      question: createQuestion(session.difficulty, `${session.id}:${solved}`),
      status:
        session.difficulty === "hell" && solved === 99 ? "glitch" : "solving",
    },
  };
}

/** The 99th-question "error" is only a presentation state, never an exception. */
export function resumeAfterGlitch(session: Session): Session {
  return session.status === "glitch"
    ? { ...session, status: "solving" }
    : session;
}

export function snoozeSession(session: Session, now: number): Session {
  if (session.status === "snoozed") return session;
  if (!isTimestamp(now) || !isTimestamp(now + SNOOZE_MS))
    throw new Error("スヌーズの日時が無効です。");
  return {
    ...session,
    status: "snoozed",
    snoozeUntil: now + SNOOZE_MS,
    snoozes: Math.min(MAX_COUNTER, session.snoozes + 1),
  };
}

export function wakeSnoozedSession(session: Session, now: number): Session {
  return session.status === "snoozed" &&
    session.snoozeUntil !== null &&
    isTimestamp(now) &&
    now >= session.snoozeUntil
    ? { ...session, status: "ringing", snoozeUntil: null }
    : session;
}

/** Cancellation of a scheduled alarm is not a completed (or emergency) session. */
export function addHistory(
  history: HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  return [entry, ...history.filter((item) => item.id !== entry.id)]
    .sort((left, right) => right.endedAt - left.endedAt)
    .slice(0, MAX_HISTORY);
}

function parseQuestion(value: unknown): Question | null {
  if (
    !isRecord(value) ||
    !isInteger(value.left, 0, MAX_OPERAND) ||
    !isInteger(value.right, 0, MAX_OPERAND) ||
    (value.operator !== "+" &&
      value.operator !== "-" &&
      value.operator !== "×") ||
    (value.operator === "-" && value.left < value.right)
  )
    return null;
  const question: Pick<Question, "left" | "right" | "operator"> = {
    left: value.left,
    right: value.right,
    operator: value.operator,
  };
  // Saved answers are never authoritative; only the validated operands/operator are.
  return { ...question, answer: calculateAnswer(question) };
}

function parseAlarm(value: unknown): Alarm | null {
  if (
    !isRecord(value) ||
    !isText(value.id, 128) ||
    !isText(value.name, MAX_NAME_LENGTH) ||
    !isTime(value.time) ||
    !isDifficulty(value.difficulty) ||
    !isVolume(value.volume) ||
    typeof value.enabled !== "boolean" ||
    (value.nextAt !== null && !isTimestamp(value.nextAt)) ||
    (value.enabled && value.nextAt === null)
  )
    return null;
  return {
    id: value.id,
    name: value.name,
    time: value.time,
    difficulty: value.difficulty,
    volume: value.volume,
    enabled: value.enabled,
    nextAt: value.nextAt,
  };
}

function parseSession(value: unknown): Session | null {
  if (
    !isRecord(value) ||
    !isText(value.id, 128) ||
    !isText(value.alarmId, 128) ||
    !isText(value.name, MAX_NAME_LENGTH) ||
    !isDifficulty(value.difficulty) ||
    !isVolume(value.volume) ||
    !isInteger(value.total, 1, 100) ||
    value.total !== DIFFICULTIES[value.difficulty].total ||
    !isInteger(value.solved, 0, value.total - 1) ||
    !isTimestamp(value.startedAt) ||
    !isInteger(value.snoozes, 0, MAX_COUNTER) ||
    !isInteger(value.mistakes, 0, MAX_COUNTER) ||
    typeof value.isDemo !== "boolean" ||
    (value.status !== "ringing" &&
      value.status !== "solving" &&
      value.status !== "glitch" &&
      value.status !== "snoozed") ||
    (value.status === "glitch" &&
      (value.difficulty !== "hell" || value.solved !== 99)) ||
    (value.status === "snoozed"
      ? !isTimestamp(value.snoozeUntil) || value.snoozes < 1
      : value.snoozeUntil !== null)
  )
    return null;
  const question = parseQuestion(value.question);
  if (!question) return null;
  return {
    id: value.id,
    alarmId: value.alarmId,
    name: value.name,
    difficulty: value.difficulty,
    volume: value.volume,
    total: value.total,
    solved: value.solved,
    question,
    status: value.status,
    startedAt: value.startedAt,
    snoozeUntil:
      value.status === "snoozed" ? (value.snoozeUntil as number) : null,
    snoozes: value.snoozes,
    mistakes: value.mistakes,
    isDemo: value.isDemo,
  };
}

function parseHistoryEntry(value: unknown): HistoryEntry | null {
  if (
    !isRecord(value) ||
    !isText(value.id, 128) ||
    !isText(value.name, MAX_NAME_LENGTH) ||
    !isDifficulty(value.difficulty) ||
    !isInteger(value.total, 1, 100) ||
    value.total !== DIFFICULTIES[value.difficulty].total ||
    !isInteger(value.solved, 0, value.total) ||
    !isInteger(value.snoozes, 0, MAX_COUNTER) ||
    !isInteger(value.mistakes, 0, MAX_COUNTER) ||
    !isTimestamp(value.startedAt) ||
    !isTimestamp(value.endedAt) ||
    value.endedAt < value.startedAt ||
    typeof value.isDemo !== "boolean" ||
    (value.result !== "completed" && value.result !== "emergency") ||
    (value.result === "completed" && value.solved !== value.total)
  )
    return null;
  return {
    id: value.id,
    name: value.name,
    difficulty: value.difficulty,
    total: value.total,
    solved: value.solved,
    snoozes: value.snoozes,
    mistakes: value.mistakes,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    result: value.result,
    isDemo: value.isDemo,
  };
}

/** Treat localStorage as untrusted. A corrupt item must not crash or poison the app. */
export function parseState(raw: string | null): AppState {
  if (raw === null || raw.length > MAX_STORAGE_CHARACTERS) return emptyState();
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !Array.isArray(value.alarms) ||
      !Array.isArray(value.history)
    ) {
      return emptyState();
    }
    const alarmIds = new Set<string>();
    const alarms: Alarm[] = [];
    for (const item of value.alarms) {
      const alarm = parseAlarm(item);
      if (alarm && !alarmIds.has(alarm.id)) {
        alarms.push(alarm);
        alarmIds.add(alarm.id);
      }
      if (alarms.length >= MAX_ALARMS) break;
    }
    const historyIds = new Set<string>();
    const history: HistoryEntry[] = [];
    for (const item of value.history) {
      const entry = parseHistoryEntry(item);
      if (entry && !historyIds.has(entry.id)) {
        history.push(entry);
        historyIds.add(entry.id);
      }
    }
    return {
      version: 1,
      alarms,
      session: parseSession(value.session),
      history: history
        .sort((left, right) => right.endedAt - left.endedAt)
        .slice(0, MAX_HISTORY),
    };
  } catch {
    return emptyState();
  }
}
