import { describe, expect, it } from "vitest";
import {
  addHistory,
  checkAlarmDue,
  createAlarm,
  createQuestion,
  createSession,
  DIFFICULTIES,
  EMPTY_STATE,
  finishSession,
  MAX_ALARMS,
  MAX_HISTORY,
  nextAlarmAt,
  parseState,
  resumeAfterGlitch,
  SNOOZE_MS,
  snoozeSession,
  submitAnswer,
  wakeSnoozedSession,
  type Alarm,
  type AppState,
  type Difficulty,
  type HistoryEntry,
  type Session,
} from "../src/lib/alarm";

const NOW = new Date(2026, 7, 27, 6, 0, 0).getTime();

function alarm(difficulty: Difficulty = "normal"): Alarm {
  return createAlarm(
    { name: "絶対に起きる", time: "07:00", difficulty, volume: 35 },
    NOW,
    "test-alarm",
  );
}

function solvingSession(difficulty: Difficulty = "normal"): Session {
  return { ...createSession(alarm(difficulty), NOW, true), status: "solving" };
}

function requireSession(session: Session | null): Session {
  if (session === null)
    throw new Error("A session was expected to remain active");
  return session;
}

function stateWith(session: Session | null = null): AppState {
  return { version: 1, alarms: [alarm()], session, history: [] };
}

function emergencyEntry(
  id = "history-entry",
  endedAt = NOW + 1000,
): HistoryEntry {
  return { ...finishSession(solvingSession(), endedAt, "emergency"), id };
}

describe("one-shot scheduling", () => {
  it("schedules a later time on the same local calendar day", () => {
    expect(nextAlarmAt("07:00", NOW)).toBe(new Date(2026, 7, 27, 7).getTime());
  });

  it("rolls an elapsed time over to tomorrow", () => {
    expect(nextAlarmAt("05:59", NOW)).toBe(
      new Date(2026, 7, 28, 5, 59).getTime(),
    );
  });

  it("schedules tomorrow when the minute is already reached", () => {
    expect(nextAlarmAt("06:00", NOW)).toBe(new Date(2026, 7, 28, 6).getTime());
    expect(nextAlarmAt("06:00", NOW + 500)).toBe(
      new Date(2026, 7, 28, 6).getTime(),
    );
  });

  it("handles midnight and the year boundary", () => {
    const now = new Date(2026, 11, 31, 23, 59, 30).getTime();
    expect(nextAlarmAt("00:00", now)).toBe(new Date(2027, 0, 1, 0).getTime());
  });

  it("uses calendar-day arithmetic at a leap-day boundary", () => {
    const now = new Date(2028, 1, 28, 23, 59, 30).getTime();
    expect(nextAlarmAt("00:00", now)).toBe(new Date(2028, 1, 29, 0).getTime());
  });

  it.each([
    "",
    "7:00",
    "24:00",
    "12:60",
    "-1:00",
    "00:00:00",
    " 07:00",
    "07:00 ",
    "１２:００",
  ])("rejects invalid time %j", (time) => {
    expect(() => nextAlarmAt(time, NOW)).toThrow();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, Number.MAX_VALUE])(
    "rejects invalid timestamp %j",
    (now) => {
      expect(() => nextAlarmAt("07:00", now)).toThrow();
    },
  );

  it("detects the exact deadline and late timer callbacks", () => {
    const scheduled = alarm();
    const deadline = scheduled.nextAt!;
    expect(checkAlarmDue(scheduled, deadline - 1)).toBe(false);
    expect(checkAlarmDue(scheduled, deadline)).toBe(true);
    expect(checkAlarmDue(scheduled, deadline + 90_000)).toBe(true);
    expect(checkAlarmDue({ ...scheduled, enabled: false }, deadline)).toBe(
      false,
    );
    expect(checkAlarmDue({ ...scheduled, nextAt: null }, deadline)).toBe(false);
    expect(checkAlarmDue(scheduled, Number.NaN)).toBe(false);
  });

  it("trims names and supplies a safe default", () => {
    expect(
      createAlarm(
        { name: "  朝  ", time: "07:00", difficulty: "normal", volume: 0 },
        NOW,
      ).name,
    ).toBe("朝");
    expect(
      createAlarm(
        { name: "   ", time: "07:00", difficulty: "normal", volume: 100 },
        NOW,
      ).name,
    ).toBe("起きる時間");
  });

  it("does not accept invalid volume or an oversized name", () => {
    expect(() =>
      createAlarm(
        { name: "朝", time: "07:00", difficulty: "normal", volume: 101 },
        NOW,
      ),
    ).toThrow();
    expect(() =>
      createAlarm(
        { name: "朝", time: "07:00", difficulty: "normal", volume: -1 },
        NOW,
      ),
    ).toThrow();
    expect(() =>
      createAlarm(
        {
          name: "朝".repeat(61),
          time: "07:00",
          difficulty: "normal",
          volume: 10,
        },
        NOW,
      ),
    ).toThrow();
  });
});

describe("math questions and completion", () => {
  it.each([
    ["normal", 5],
    ["crap", 20],
    ["hell", 100],
  ] as const)(
    "requires exactly %s's %i correct answers",
    (difficulty, total) => {
      let session = solvingSession(difficulty);
      expect(DIFFICULTIES[difficulty].total).toBe(total);
      for (let answerNumber = 1; answerNumber <= total; answerNumber += 1) {
        session = resumeAfterGlitch(session);
        const result = submitAnswer(
          session,
          String(session.question.answer),
          NOW + answerNumber * 1000,
        );
        expect(result.correct).toBe(true);
        if (answerNumber < total) {
          expect(result.entry).toBeNull();
          session = requireSession(result.session);
          expect(session.solved).toBe(answerNumber);
        } else {
          expect(result.session).toBeNull();
          expect(result.entry).toMatchObject({
            result: "completed",
            total,
            solved: total,
            isDemo: true,
            mistakes: 0,
          });
        }
      }
    },
  );

  it.each(["normal", "crap", "hell"] as const)(
    "generates all three operators and nonnegative integer answers for %s",
    (difficulty) => {
      const operators = new Set<string>();
      for (let index = 0; index < 400; index += 1) {
        const question = createQuestion(difficulty, `fixed-seed:${index}`);
        operators.add(question.operator);
        expect(Number.isInteger(question.answer)).toBe(true);
        expect(question.answer).toBeGreaterThanOrEqual(0);
        expect(question.left).toBeLessThanOrEqual(99);
        expect(question.right).toBeLessThanOrEqual(99);
        if (question.operator === "+")
          expect(question.answer).toBe(question.left + question.right);
        if (question.operator === "-")
          expect(question.answer).toBe(question.left - question.right);
        if (question.operator === "×")
          expect(question.answer).toBe(question.left * question.right);
      }
      expect(operators).toEqual(new Set(["+", "-", "×"]));
    },
  );

  it("keeps reducer transitions deterministic without additional random IDs", () => {
    const session = solvingSession();
    expect(submitAnswer(session, String(session.question.answer), NOW)).toEqual(
      submitAnswer(session, String(session.question.answer), NOW),
    );
    expect(createQuestion("hell", "same-seed")).toEqual(
      createQuestion("hell", "same-seed"),
    );
    expect(createSession(alarm(), NOW).id).not.toBe(
      createSession(alarm(), NOW).id,
    );
  });

  it("keeps the same question and progress on a wrong answer", () => {
    const session = solvingSession();
    const result = submitAnswer(
      session,
      String(session.question.answer + 1),
      NOW,
    );
    expect(result.correct).toBe(false);
    expect(result.entry).toBeNull();
    expect(result.session).toEqual({ ...session, mistakes: 1 });
    expect(session.mistakes).toBe(0);
  });

  it.each(["", " ", "　", "\n\t"])(
    "ignores empty input %j without a penalty",
    (answer) => {
      const session = solvingSession();
      const result = submitAnswer(session, answer, NOW);
      expect(result.session).toBe(session);
      expect(result.correct).toBe(false);
    },
  );

  it.each([
    "NaN",
    "Infinity",
    "1e2",
    "0x10",
    "5.0",
    "1+1",
    "-3",
    "abc",
    "1 2",
    "9999999",
  ])("rejects non-integer/expression input %j", (answer) => {
    const session = solvingSession();
    const result = submitAnswer(session, answer, NOW);
    expect(result.correct).toBe(false);
    expect(result.session?.solved).toBe(0);
    expect(result.session?.mistakes).toBe(1);
  });

  it("accepts full-width numerals and surrounding whitespace", () => {
    const session = solvingSession();
    const fullWidth = String(session.question.answer).replace(/\d/gu, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) + 0xfee0),
    );
    const result = submitAnswer(session, `　${fullWidth}　`, NOW);
    expect(result.correct).toBe(true);
    expect(result.session?.solved).toBe(1);
  });

  it("accepts zero for equal-number subtraction", () => {
    const session: Session = {
      ...solvingSession(),
      question: { left: 8, right: 8, operator: "-", answer: 0 },
    };
    expect(submitAnswer(session, "0", NOW).correct).toBe(true);
  });

  it.each(["ringing", "glitch", "snoozed"] as const)(
    "does not advance from %s",
    (status) => {
      const session = { ...solvingSession(), status };
      const result = submitAnswer(
        session,
        String(session.question.answer),
        NOW,
      );
      expect(result.session).toBe(session);
      expect(result.correct).toBe(false);
    },
  );

  it("keeps demo sessions explicitly distinguishable", () => {
    expect(createSession(alarm(), NOW).isDemo).toBe(false);
    expect(createSession(alarm(), NOW, true).isDemo).toBe(true);
  });
});

describe("safe 99th-question error presentation", () => {
  it("restores the fake error and proceeds to question 100 without restarting", () => {
    let session = solvingSession("hell");
    for (let index = 0; index < 98; index += 1) {
      session = requireSession(
        submitAnswer(session, String(session.question.answer), NOW + index)
          .session,
      );
    }
    expect(session.solved).toBe(98);
    expect(session.status).toBe("solving");

    const ninetyNinth = submitAnswer(
      session,
      String(session.question.answer),
      NOW + 99,
    );
    expect(ninetyNinth.entry).toBeNull();
    session = requireSession(ninetyNinth.session);
    expect(session).toMatchObject({ solved: 99, total: 100, status: "glitch" });

    const restored = requireSession(
      parseState(JSON.stringify(stateWith(session))).session,
    );
    expect(restored).toEqual(session);
    const resumed = resumeAfterGlitch(restored);
    expect(resumed).toMatchObject({ solved: 99, status: "solving" });
    expect(resumed.question).toEqual(session.question);

    const restoredAgain = requireSession(
      parseState(JSON.stringify(stateWith(resumed))).session,
    );
    expect(restoredAgain.status).toBe("solving");
    const final = submitAnswer(
      restoredAgain,
      String(restoredAgain.question.answer),
      NOW + 100,
    );
    expect(final.session).toBeNull();
    expect(final.entry).toMatchObject({
      result: "completed",
      solved: 100,
      total: 100,
    });
  });

  it("does not replay the glitch on ordinary sessions", () => {
    const session = solvingSession();
    expect(resumeAfterGlitch(session)).toBe(session);
  });
});

describe("snoozing", () => {
  it("snoozes exactly five minutes and preserves the same question/progress", () => {
    const session = { ...solvingSession(), solved: 3, mistakes: 2 };
    const snoozed = snoozeSession(session, NOW + 5000);
    expect(snoozed).toEqual({
      ...session,
      status: "snoozed",
      snoozeUntil: NOW + 5000 + SNOOZE_MS,
      snoozes: 1,
    });
    expect(session.status).toBe("solving");
    expect(snoozeSession(snoozed, NOW + 6000)).toBe(snoozed);
  });

  it("wakes once the saved snooze deadline is reached, including a delayed tick", () => {
    const snoozed = snoozeSession(solvingSession(), NOW);
    expect(wakeSnoozedSession(snoozed, NOW + SNOOZE_MS - 1)).toBe(snoozed);
    expect(wakeSnoozedSession(snoozed, NOW + SNOOZE_MS)).toMatchObject({
      status: "ringing",
      snoozeUntil: null,
      snoozes: 1,
    });
    const late = wakeSnoozedSession(snoozed, NOW + SNOOZE_MS + 100_000);
    expect(late.status).toBe("ringing");
    expect(snoozeSession(late, NOW + SNOOZE_MS + 100_000).snoozes).toBe(2);
  });

  it("restores a snoozed session without changing its deadline", () => {
    const session = snoozeSession(
      { ...solvingSession("hell"), solved: 82 },
      NOW + 1000,
    );
    expect(parseState(JSON.stringify(stateWith(session))).session).toEqual(
      session,
    );
  });

  it("rejects invalid snooze dates", () => {
    expect(() => snoozeSession(solvingSession(), Number.NaN)).toThrow();
  });
});

describe("history", () => {
  it("does not mark emergency stopping as solving all questions", () => {
    const session = { ...solvingSession(), solved: 2, snoozes: 3, mistakes: 7 };
    expect(finishSession(session, NOW + 1000, "emergency")).toMatchObject({
      result: "emergency",
      solved: 2,
      total: 5,
      snoozes: 3,
      mistakes: 7,
      isDemo: true,
    });
    expect(() => finishSession(session, NOW + 1000, "completed")).toThrow();
  });

  it("does not create a negative duration after the system clock moves backwards", () => {
    expect(
      finishSession(solvingSession(), NOW - 1000, "emergency").endedAt,
    ).toBe(NOW);
  });

  it("deduplicates session IDs, sorts newest first, and retains at most 100 entries", () => {
    const history = Array.from({ length: 110 }, (_, index) =>
      emergencyEntry(`entry-${index}`, NOW + index),
    );
    const entry = emergencyEntry("entry-50", NOW + 500);
    const result = addHistory(history, entry);
    expect(result).toHaveLength(MAX_HISTORY);
    expect(result[0]).toEqual(entry);
    expect(result.filter((item) => item.id === entry.id)).toHaveLength(1);
    expect(result.at(-1)?.endedAt).toBe(NOW + 10);
    expect(history).toHaveLength(110);
  });

  it("discards cancelled records rather than reporting them as completions", () => {
    const state = {
      ...stateWith(),
      history: [{ ...emergencyEntry(), result: "cancelled" }],
    };
    expect(parseState(JSON.stringify(state)).history).toEqual([]);
  });
});

describe("defensive localStorage restoration", () => {
  it.each([
    null,
    "",
    "{",
    "null",
    "[]",
    "42",
    '"text"',
    "{}",
    '{"version":2,"alarms":[],"history":[]}',
  ])("recovers safely from invalid root data %j", (raw) => {
    expect(parseState(raw)).toEqual(EMPTY_STATE);
  });

  it("returns fresh defaults so callers cannot mutate future recoveries", () => {
    const first = parseState(null);
    first.alarms.push(alarm());
    expect(parseState(null).alarms).toEqual([]);
    expect(EMPTY_STATE.alarms).toEqual([]);
  });

  it("rejects oversized storage input before parsing it", () => {
    expect(
      parseState(
        JSON.stringify({ ...stateWith(), padding: "x".repeat(256_000) }),
      ),
    ).toEqual(EMPTY_STATE);
  });

  it("roundtrips valid settings, progress, question, and history", () => {
    const state = {
      ...stateWith({ ...solvingSession(), solved: 2, mistakes: 4 }),
      history: [emergencyEntry()],
    };
    expect(parseState(JSON.stringify(state))).toEqual(state);
  });

  it.each([
    { id: "" },
    { id: "x".repeat(129) },
    { name: "" },
    { name: "x".repeat(61) },
    { name: "bad\u0000name" },
    { difficulty: "impossible" },
    { time: "24:00" },
    { volume: 101 },
    { volume: -1 },
    { volume: "35" },
    { enabled: "true" },
    { nextAt: -1 },
    { nextAt: null },
    { nextAt: 1.5 },
  ])(
    "discards invalid alarm fields %j while retaining valid neighbors",
    (invalid) => {
      const valid = alarm();
      const state = {
        ...stateWith(),
        alarms: [
          { ...valid, ...invalid },
          { ...valid, id: "valid-neighbor" },
        ],
      };
      expect(parseState(JSON.stringify(state)).alarms).toEqual([
        { ...valid, id: "valid-neighbor" },
      ]);
    },
  );

  it("allows disabled one-shot alarms without a next timestamp", () => {
    const disabled = { ...alarm(), enabled: false, nextAt: null };
    expect(
      parseState(JSON.stringify({ ...stateWith(), alarms: [disabled] })).alarms,
    ).toEqual([disabled]);
  });

  it("caps alarms and removes duplicate IDs", () => {
    const alarms = Array.from({ length: 40 }, (_, index) => ({
      ...alarm(),
      id: `alarm-${index}`,
    }));
    const result = parseState(
      JSON.stringify({ ...stateWith(), alarms: [alarms[0], ...alarms] }),
    );
    expect(result.alarms).toHaveLength(MAX_ALARMS);
    expect(new Set(result.alarms.map((item) => item.id)).size).toBe(MAX_ALARMS);
  });

  it.each([
    { solved: -1 },
    { solved: 5 },
    { solved: 1.5 },
    { total: 100 },
    { difficulty: "other" },
    { status: "crashed" },
    { status: "glitch" },
    { status: "snoozed", snoozeUntil: null },
    { status: "snoozed", snoozeUntil: NOW, snoozes: 0 },
    { snoozeUntil: NOW },
    { mistakes: -1 },
    { mistakes: "4" },
    { snoozes: 1_000_001 },
    { startedAt: -1 },
    { isDemo: "false" },
    { alarmId: null },
  ])("discards an invalid session %j without losing alarms", (invalid) => {
    const restored = parseState(
      JSON.stringify(stateWith({ ...solvingSession(), ...invalid } as Session)),
    );
    expect(restored.session).toBeNull();
    expect(restored.alarms).toHaveLength(1);
  });

  it.each([
    { left: -1, right: 1, operator: "+" },
    { left: 1000, right: 1, operator: "+" },
    { left: 1, right: 2, operator: "-" },
    { left: 1, right: 2, operator: "/" },
    { left: 1.5, right: 2, operator: "×" },
    { left: "1", right: 2, operator: "+" },
  ])("rejects invalid question operands/operators %j", (question) => {
    const state = {
      ...stateWith(),
      session: { ...solvingSession(), question },
    };
    expect(parseState(JSON.stringify(state)).session).toBeNull();
  });

  it("recalculates a stored answer instead of trusting it", () => {
    const session = {
      ...solvingSession(),
      question: { left: 12, right: 9, operator: "×", answer: 999999 },
    };
    const state = { ...stateWith(), session };
    expect(parseState(JSON.stringify(state)).session?.question.answer).toBe(
      108,
    );
  });

  it("discards incomplete records falsely claiming completion", () => {
    const state = {
      ...stateWith(),
      history: [{ ...emergencyEntry(), solved: 3, result: "completed" }],
    };
    expect(parseState(JSON.stringify(state)).history).toEqual([]);
  });

  it("validates, deduplicates, sorts, and caps restored history", () => {
    const entries = Array.from({ length: 120 }, (_, index) =>
      emergencyEntry(`entry-${index}`, NOW + index),
    );
    const state = {
      ...stateWith(),
      history: [
        null,
        { ...emergencyEntry("invalid"), endedAt: NOW - 1 },
        entries[0],
        ...entries,
      ],
    };
    const history = parseState(JSON.stringify(state)).history;
    expect(history).toHaveLength(MAX_HISTORY);
    expect(history[0].id).toBe("entry-119");
    expect(history.at(-1)?.id).toBe("entry-20");
  });
});
