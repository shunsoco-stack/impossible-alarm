import { ArrowUpRight, Bell, Clock3, Moon, Sun, Sunrise } from "lucide-react";
import type { Alarm, HistoryEntry } from "@/lib/alarm";

export function Clock({
  now,
  next,
  history,
  onDemo,
  demoDisabled,
}: {
  now: number;
  next: Alarm | undefined;
  history: HistoryEntry[];
  onDemo: () => void;
  demoDisabled: boolean;
}) {
  const date = now ? new Date(now) : null;
  const hour = date?.getHours() ?? 0;
  const minute = date?.getMinutes() ?? 0;
  const second = date?.getSeconds() ?? 0;
  const night = hour >= 18 || hour < 5;
  const MomentIcon = night ? Moon : Sun;
  const successes = history.filter(
    (entry) => entry.result === "completed" && !entry.isDemo,
  );
  const snoozes = history
    .filter((entry) => !entry.isDemo)
    .reduce((sum, entry) => sum + entry.snoozes, 0);
  const totalSolved = successes.reduce((sum, entry) => sum + entry.solved, 0);
  const dateText = date
    ? new Intl.DateTimeFormat("ja-JP", {
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(date)
    : "時計を合わせています";
  const remaining = next?.nextAt ? Math.max(0, next.nextAt - now) : 0;
  const remainingText = `${Math.floor(remaining / 3600000)}時間${Math.floor((remaining % 3600000) / 60000)}分後`;
  return (
    <div className="clock-column">
      <section className="clock-panel" aria-label="現在時刻と次のアラーム">
        <div className="clock-topline">
          <span className="live-label">
            <span className="live-dot" />
            LOCAL TIME
          </span>
          <span className="moment-label">
            <MomentIcon size={15} />
            {night ? "静かな夜のうちに。" : "今日も、いい一日を。"}
          </span>
        </div>
        <div className="analog-clock" aria-hidden="true">
          <div className="dial-ticks">
            {Array.from({ length: 60 }, (_, i) => (
              <i
                key={i}
                className={i % 5 === 0 ? "major" : ""}
                style={{ transform: `rotate(${i * 6}deg)` }}
              />
            ))}
          </div>
          <span
            className="hand hour-hand"
            style={{ transform: `rotate(${hour * 30 + minute / 2}deg)` }}
          />
          <span
            className="hand minute-hand"
            style={{ transform: `rotate(${minute * 6 + second / 10}deg)` }}
          />
          <span
            className="hand second-hand"
            style={{ transform: `rotate(${second * 6}deg)` }}
          />
          <span className="hand-pin" />
        </div>
        <div
          className="digital-clock"
          role="timer"
          aria-label={
            date ? `現在 ${hour}時${minute}分` : "現在時刻を読み込み中"
          }
          aria-live="off"
        >
          <span>{date ? String(hour).padStart(2, "0") : "--"}</span>
          <span className="clock-colon">:</span>
          <span>{date ? String(minute).padStart(2, "0") : "--"}</span>
          <span className="seconds">{String(second).padStart(2, "0")}</span>
        </div>
        <div className="clock-date">
          <span>{dateText}</span>
          <span>24H</span>
        </div>
        <div className="next-alarm">
          <div className="next-alarm-icon">
            <Bell size={19} strokeWidth={1.7} />
          </div>
          <div>
            <span className="next-label">NEXT ALARM</span>
            <p>
              {next ? (
                <>
                  <strong>{next.time}</strong>
                  <span>{next.name}</span>
                </>
              ) : (
                "次の朝を、セットしよう。"
              )}
            </p>
          </div>
          <span className={`next-badge ${next ? "is-set" : ""}`}>
            {next ? remainingText : "未設定"}
          </span>
        </div>
      </section>
      <div className="morning-stats" aria-label="これまでの起床実績">
        <div>
          <Sunrise size={17} />
          <strong>
            {successes.length}
            <small>回</small>
          </strong>
          <span>起床成功</span>
        </div>
        <div>
          <span className="stat-math" aria-hidden="true">
            ×
          </span>
          <strong>
            {totalSolved}
            <small>問</small>
          </strong>
          <span>解いた問題</span>
        </div>
        <div>
          <Clock3 size={17} />
          <strong>
            {snoozes}
            <small>回</small>
          </strong>
          <span>逃げた回数</span>
        </div>
      </div>
      <button className="demo-card" onClick={onDemo} disabled={demoDisabled}>
        <span className="demo-icon">
          <span aria-hidden="true">↗</span>
        </span>
        <span>
          <strong>朝が来る前に、ちょっと体験。</strong>
          <small>音が鳴ります。覚悟はいいですか？</small>
        </span>
        <ArrowUpRight size={21} />
      </button>
    </div>
  );
}
