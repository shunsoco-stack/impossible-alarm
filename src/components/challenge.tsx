"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  BellRing,
  Check,
  CheckCircle2,
  Clock3,
  CornerDownLeft,
  Delete,
  Flag,
  RotateCcw,
  ShieldCheck,
  Volume2,
  X,
} from "lucide-react";
import { DIFFICULTIES, type HistoryEntry, type Session } from "@/lib/alarm";
import { alarmStore, formatDuration } from "@/lib/alarm-store";
import { Brand, Modal } from "./ui";

export function Challenge({
  session,
  now,
  audioReady,
  primary,
  storageOk,
}: {
  session: Session;
  now: number;
  audioReady: boolean;
  primary: boolean;
  storageOk: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [emergency, setEmergency] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const progress = Math.round((session.solved / session.total) * 100);
  const status = session.status;

  useEffect(() => {
    if (status === "solving") inputRef.current?.focus({ preventScroll: true });
    else headingRef.current?.focus({ preventScroll: true });
  }, [status]);

  useEffect(() => {
    if (status !== "glitch" || !primary) return;
    const timeout = setTimeout(() => alarmStore.resumeGlitch(), 6500);
    return () => clearTimeout(timeout);
  }, [status, primary]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!answer.trim()) {
      setError("答えを入力してください。");
      inputRef.current?.focus();
      return;
    }
    const correct = alarmStore.answer(answer);
    if (correct) {
      setAnswer("");
      setError("");
    } else {
      setError("惜しい。もう一度、落ち着いて計算してみよう。");
      inputRef.current?.select();
    }
    inputRef.current?.focus({ preventScroll: true });
  }

  return (
    <div
      className={`alarm-experience ${status === "glitch" ? "glitch-experience" : ""} ${status === "snoozed" ? "snooze-experience" : ""}`}
    >
      <header className="alarm-header">
        <Brand />
        <div className="alarm-header-actions">
          {session.isDemo && (
            <span className="demo-badge">
              体験モード{session.volume === 0 ? " · 無音" : ""}
            </span>
          )}
          <button
            className="emergency-link"
            onClick={() =>
              session.isDemo ? alarmStore.emergencyStop() : setEmergency(true)
            }
            disabled={!primary}
          >
            {session.isDemo ? (
              <>
                <X size={15} />
                体験を終了
              </>
            ) : (
              <>
                <Flag size={14} />
                緊急停止
              </>
            )}
          </button>
        </div>
      </header>
      {!primary && (
        <p className="inline-warning">
          別のタブで使用中です。操作するタブを1つにしてください。
        </p>
      )}
      {primary && !audioReady && status !== "snoozed" && session.volume > 0 && (
        <div className="audio-unlock">
          <Volume2 size={17} />
          <span>
            音声が停止しています。再読み込み後は、もう一度許可が必要です。
          </span>
          <button onClick={() => void alarmStore.enableAudio()}>
            音を有効にする
          </button>
        </div>
      )}
      <main className={`challenge-main ${status}`} id="main-content">
        {status === "ringing" && (
          <section className="ringing-content">
            <div className="ringing-icon">
              <BellRing size={38} strokeWidth={1.4} />
            </div>
            <p className="alert-eyebrow">
              <span />
              TIME TO WAKE UP
            </p>
            <h1 ref={headingRef} tabIndex={-1}>
              おはよう。
              <br />
              計算の時間です。
            </h1>
            <p className="ringing-name">{session.name}</p>
            <div className="ringing-time">
              {new Date(now).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </div>
            <div className="challenge-meta">
              <span>
                <strong>{DIFFICULTIES[session.difficulty].label}</strong>モード
              </span>
              <span>
                あと<strong>{session.total - session.solved}</strong>問
              </span>
              <span>
                逃走<strong>{session.snoozes}</strong>回
              </span>
            </div>
            <button
              className="primary-button alarm-primary"
              onClick={() => alarmStore.beginSolving()}
              disabled={!primary}
            >
              計算して止める
              <ArrowRight size={20} />
            </button>
            <SnoozeButton primary={primary} />
            <p className="alarm-caption">
              昨日のあなたが決めたことです。がんばって。
            </p>
          </section>
        )}

        {status === "solving" && (
          <section className="solving-content" aria-label="計算問題">
            <div className="challenge-topline">
              <span className="difficulty-pill">
                {DIFFICULTIES[session.difficulty].label}モード
              </span>
              <span className="elapsed">
                <Clock3 size={15} />
                {formatDuration(now - session.startedAt)}
              </span>
            </div>
            <div className="question-progress">
              <span>
                QUESTION{" "}
                <strong>{String(session.solved + 1).padStart(2, "0")}</strong>
                <span> / {session.total}</span>
              </span>
              <span>{progress}% COMPLETE</span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="計算の進捗"
              aria-valuenow={session.solved}
              aria-valuemin={0}
              aria-valuemax={session.total}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <h1 className="question-prompt">
              {session.solved === 99
                ? "最後の1問。自由は、すぐそこ。"
                : session.solved === 0
                  ? "まずは1問。脳を起こそう。"
                  : "いい調子。そのまま、起きよう。"}
            </h1>
            <p
              className="equation"
              aria-label={`${session.question.left} ${session.question.operator === "×" ? "かける" : session.question.operator === "+" ? "たす" : "ひく"} ${session.question.right}`}
            >
              <span>{session.question.left}</span>
              <span className="operator">{session.question.operator}</span>
              <span>{session.question.right}</span>
              <span className="equals">=</span>
              <span className="question-mark">?</span>
            </p>
            <form onSubmit={submit} className="answer-form">
              <label className="sr-only" htmlFor="answer-input">
                計算の答え
              </label>
              <div className={`answer-wrapper ${error ? "has-error" : ""}`}>
                <input
                  ref={inputRef}
                  id="answer-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={answer}
                  onChange={(event) => {
                    setAnswer(event.target.value);
                    setError("");
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      if (!event.repeat) submit();
                    }
                  }}
                  placeholder="答えを入力"
                  aria-invalid={!!error}
                  aria-describedby="answer-feedback"
                  disabled={!primary}
                />
                <span aria-hidden="true">
                  <CornerDownLeft size={19} />
                </span>
              </div>
              <p
                id="answer-feedback"
                className={`answer-feedback ${error ? "is-error" : ""}`}
                role="status"
              >
                {error ||
                  "数字を入力して Enter。正解するまで、音は止まりません。"}
              </p>
              <div className="number-pad" aria-label="数字キーパッド">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, "clear", 0, "delete"].map(
                  (key) => (
                    <button
                      key={key}
                      type="button"
                      disabled={!primary}
                      aria-label={
                        key === "clear"
                          ? "入力をクリア"
                          : key === "delete"
                            ? "1文字削除"
                            : `${key}`
                      }
                      onClick={() => {
                        setAnswer((current) =>
                          key === "clear"
                            ? ""
                            : key === "delete"
                              ? current.slice(0, -1)
                              : (current + key).slice(0, 6),
                        );
                        setError("");
                        inputRef.current?.focus({ preventScroll: true });
                      }}
                    >
                      {key === "clear" ? (
                        "C"
                      ) : key === "delete" ? (
                        <Delete size={20} />
                      ) : (
                        key
                      )}
                    </button>
                  ),
                )}
              </div>
              <button
                className="primary-button alarm-primary"
                type="submit"
                disabled={!primary}
              >
                回答する
                <ArrowRight size={19} />
              </button>
            </form>
            <SnoozeButton primary={primary} />
            <div className="saved-status">
              <ShieldCheck size={14} />
              <span>
                {storageOk
                  ? `${session.solved}問の正解をこの端末に保存済み`
                  : "保存できません。この画面を閉じないでください。"}
              </span>
              <span>逃走 {session.snoozes}回</span>
            </div>
          </section>
        )}

        {status === "glitch" && (
          <section className="glitch-content" aria-label="99問目のエラー風演出">
            <div className="glitch-topline">
              <span className="error-tag">SYSTEM ERROR (?)</span>
              <span>99 / 100 COMPLETED</span>
            </div>
            <div className="error-window">
              <div className="window-toolbar">
                <span />
                <span />
                <span />
                <code>wakeup.exe</code>
              </div>
              <div className="error-window-body">
                <span className="error-number" aria-hidden="true">
                  :(
                </span>
                <h1 ref={headingRef} tabIndex={-1}>
                  目覚めが
                  <br />
                  見つかりません。
                </h1>
                <p className="error-code">ERROR: WAKE_UP_NOT_FOUND</p>
                <div className="terminal-output">
                  <p>
                    <span>✓</span> 99問の正解を確認
                  </p>
                  <p>
                    <span>✓</span> 起床データの保存完了
                  </p>
                  <p>
                    <span>›</span> 最後の意地悪を実行中
                    <span className="terminal-cursor">_</span>
                  </p>
                </div>
                <div className="fake-error-reassurance">
                  <ShieldCheck size={18} />
                  <p>
                    <strong>ご安心を。これは演出です。</strong>
                    <br />
                    クラッシュしていません。99問の進捗は保持されています。
                  </p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => alarmStore.resumeGlitch()}
                  disabled={!primary}
                >
                  100問目へ進む
                  <ArrowRight size={20} />
                </button>
                <p className="auto-resume">まもなく自動で100問目に進みます。</p>
              </div>
            </div>
            <p className="glitch-footer">あと、たった1問。…本当です。</p>
          </section>
        )}

        {status === "snoozed" && (
          <section className="snoozed-content">
            <span className="snoozed-icon">
              <Clock3 size={34} strokeWidth={1.5} />
            </span>
            <p className="eyebrow">A VERY SHORT ESCAPE</p>
            <h1 ref={headingRef} tabIndex={-1}>
              5分だけ、
              <br />
              逃がしてあげる。
            </h1>
            <div
              className="snooze-countdown"
              role="timer"
              aria-label="スヌーズ残り時間"
              aria-live="off"
            >
              {formatDuration((session.snoozeUntil ?? now) - now)}
            </div>
            <p>
              逃走 <strong>{session.snoozes}回目</strong> · {session.solved} /{" "}
              {session.total}問の進捗を保持
            </p>
            <button
              className="primary-button"
              onClick={() => alarmStore.resumeNow()}
              disabled={!primary}
            >
              やっぱり今、起きる
              <ArrowRight size={19} />
            </button>
            <p className="snooze-warning">
              この画面を開いたままお待ちください。
              <br />
              省電力や画面ロックで再び鳴らない場合があります。
            </p>
          </section>
        )}
      </main>
      <footer className="challenge-footer">
        <span>IMPOSSIBLE ALARM</span>
        <span>朝の自分に、試練を。</span>
      </footer>
      {emergency && (
        <Modal
          title="安全のため、緊急停止しますか？"
          onClose={() => setEmergency(false)}
        >
          <p className="modal-copy">
            音がつらい・体調が悪いときは無理をしないでください。計算を中断して停止します。履歴には「緊急停止」と記録し、起床成功にはカウントしません。
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => setEmergency(false)}
            >
              計算に戻る
            </button>
            <button
              className="danger-button"
              onClick={() => {
                alarmStore.emergencyStop();
                setEmergency(false);
              }}
            >
              緊急停止する
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SnoozeButton({ primary }: { primary: boolean }) {
  return (
    <button
      className="snooze-button"
      onClick={() => alarmStore.snooze()}
      disabled={!primary}
    >
      <RotateCcw size={16} />
      逃げる・あと5分<span aria-hidden="true">↗</span>
    </button>
  );
}

export function Success({
  entry,
  onShare,
}: {
  entry: HistoryEntry;
  onShare: (entry: HistoryEntry) => void;
}) {
  return (
    <Modal
      title="おはようございます。"
      onClose={() => alarmStore.dismissResult()}
      className="success-modal"
    >
      <div className="success-icon">
        <CheckCircle2 size={47} strokeWidth={1.5} />
      </div>
      <p className="eyebrow">YOU ARE DEFINITELY AWAKE.</p>
      <h3>
        おめでとう。
        <br />
        もう、起きてますよね。
      </h3>
      <div className="success-stats">
        <span>
          <strong>{entry.solved}</strong>問クリア
        </span>
        <span>
          <strong>{formatDuration(entry.endedAt - entry.startedAt)}</strong>
          所要時間
        </span>
        <span>
          <strong>{entry.snoozes}</strong>回逃走
        </span>
      </div>
      {entry.isDemo && (
        <p className="fine-print">
          体験モードの結果です。起床実績には含まれません。
        </p>
      )}
      <button className="primary-button" onClick={() => onShare(entry)}>
        この朝を共有する
        <ArrowRight size={18} />
      </button>
      <button
        className="snooze-button"
        onClick={() => alarmStore.dismissResult()}
      >
        <Check size={16} />
        今日をはじめる
      </button>
    </Modal>
  );
}
