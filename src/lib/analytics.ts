import { track } from "@vercel/analytics";
import type { Difficulty } from "./alarm";

export type AlarmEvent =
  "alarm_set" | "alarm_fire" | "alarm_stop" | "alarm_snooze";

/** No alarm names, scheduled times, answers, IDs, or personal data are sent. */
export function trackAlarmEvent(
  event: AlarmEvent,
  properties: {
    difficulty: Difficulty;
    snoozes?: number;
    result?: string;
    source?: string;
  },
  isDemo = false,
) {
  if (isDemo || process.env.NODE_ENV !== "production") return;
  try {
    track(event, properties);
  } catch {
    // An unavailable/blocked analytics endpoint must never affect an alarm.
  }
}
