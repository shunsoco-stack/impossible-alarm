"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  AlarmClock,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Clock3,
  History,
  LockKeyhole,
  Moon,
  Share2,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import {
  DIFFICULTIES,
  type Alarm,
  type Difficulty,
  type HistoryEntry,
} from "@/lib/alarm";
import { alarmStore, formatDuration } from "@/lib/alarm-store";
import { AlarmSettings, DifficultyOptions } from "./alarm-settings";
import { Clock } from "./clock";
import { Challenge, Success } from "./challenge";
import { Brand, LimitationNotice, Modal } from "./ui";

type ShareData = { title: string; text: string; url: string };

export default function AlarmApp() {
  const snapshot = useSyncExternalStore(
    alarmStore.subscribe,
    alarmStore.getSnapshot,
    alarmStore.getServerSnapshot,
  );
  const [view, setView] = useState<"alarm" | "history">("alarm");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [helpOpen, setHelpOpen] = useState(false);
  const [difficultyOpen, setDifficultyOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Alarm | null>(null);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState("");
  const {
    data,
    now,
    ready,
    primary,
    audioReady,
    audioPlaying,
    storageOk,
    notification,
    theme,
    message,
    result,
  } = snapshot;
  const next = data.alarms
    .filter((alarm) => alarm.enabled)
    .sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0))[0];

  useEffect(() => alarmStore.connect(), []);

  async function share(entry?: HistoryEntry) {
    const content = {
      title: "起きられない目覚まし",
      text: entry
        ? `「起きられない目覚まし」${DIFFICULTIES[entry.difficulty].label}モードで${entry.solved}問クリア。逃走${entry.snoozes}回、${formatDuration(entry.endedAt - entry.startedAt)}で生還しました。${entry.isDemo ? "（体験モード）" : ""} #起きられない目覚まし`
        : "朝の自分に、試練を。計算問題を解かないと止まらない「起きられない目覚まし」。あなたは100問、解けますか？",
      url: window.location.origin,
    };
    if (navigator.share) {
      try {
        await navigator.share(content);
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    setCopied(false);
    setShareError("");
    setShareData(content);
  }

  async function copyShare() {
    if (!shareData) return;
    try {
      await navigator.clipboard.writeText(
        `${shareData.text}\n${shareData.url}`,
      );
      setCopied(true);
      setShareError("");
    } catch {
      setShareError(
        "コピーできませんでした。下の文章を選択してコピーしてください。",
      );
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        本文へスキップ
      </a>
      {data.session ? (
        <Challenge
          key={data.session.id}
          session={data.session}
          now={now}
          audioReady={audioReady}
          primary={primary}
          storageOk={storageOk}
        />
      ) : (
        <div className="app-shell">
          <header className="site-header">
            <Brand />
            <nav className="main-nav" aria-label="メインナビゲーション">
              <button
                aria-current={view === "alarm" ? "page" : undefined}
                onClick={() => setView("alarm")}
              >
                <AlarmClock size={16} />
                アラーム
              </button>
              <button
                aria-current={view === "history" ? "page" : undefined}
                onClick={() => setView("history")}
              >
                <History size={16} />
                起床の記録
                {data.history.length > 0 && (
                  <span className="nav-count">{data.history.length}</span>
                )}
              </button>
            </nav>
            <div className="header-actions">
              <button
                className="help-button"
                aria-label="使い方"
                onClick={() => setHelpOpen(true)}
              >
                <CircleHelp size={18} />
                <span>使い方</span>
              </button>
              <span className="header-divider" />
              <button
                className="icon-button"
                onClick={() => alarmStore.toggleTheme()}
                aria-label={
                  theme === "dark"
                    ? "ライトモードに切り替え"
                    : "ダークモードに切り替え"
                }
              >
                {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <button
                className="icon-button"
                onClick={() => void share()}
                aria-label="このアプリを共有"
              >
                <Share2 size={18} />
              </button>
            </div>
          </header>
          <main id="main-content" className="main-container">
            <div className="hero">
              <div>
                <div className="eyebrow hero-eyebrow">
                  <span />
                  {view === "alarm"
                    ? "SLEEP WELL. SOLVE HELL."
                    : "YOUR MORNING, ON RECORD."}
                </div>
                <h1>
                  {view === "alarm" ? (
                    <>
                      朝の自分に、<span>試練を。</span>
                    </>
                  ) : (
                    <>
                      朝の、<span>戦績。</span>
                    </>
                  )}
                </h1>
                <p>
                  {view === "alarm"
                    ? "止めるには、解くしかない。朝から使いたくない目覚まし。"
                    : "起きた朝も、逃げた朝も。ここに残しておこう。"}
                </p>
              </div>
              <div className="hero-side">
                <span className="small-clock-mark">
                  <AlarmClock size={18} strokeWidth={1.3} />
                </span>
                <span>
                  Designed for
                  <br />
                  <strong>the not-so-morning person.</strong>
                </span>
              </div>
            </div>
            {ready && !primary && (
              <div className="inline-warning">
                <LockKeyhole size={17} />
                <span>
                  このアプリを別のタブで使用中です。二重発火を防ぐため、このタブの操作は待機中です。
                </span>
              </div>
            )}
            {!storageOk && (
              <div className="inline-warning">
                <ShieldCheck size={17} />
                <span>
                  このブラウザでは保存できません。再読み込みや終了でアラーム・進捗が失われます。
                </span>
              </div>
            )}
            {ready &&
              data.alarms.some((alarm) => alarm.enabled) &&
              !audioReady && (
                <div className="audio-unlock">
                  <Volume2 size={17} />
                  <span>
                    音声の準備が必要です。ブラウザを開き直したときは再度有効にしてください。
                  </span>
                  <button
                    onClick={() => void alarmStore.enableAudio()}
                    disabled={!primary}
                  >
                    音を有効にする
                  </button>
                </div>
              )}

            {view === "alarm" ? (
              <>
                <div className="dashboard-grid">
                  <Clock
                    now={now}
                    next={next}
                    history={data.history}
                    onDemo={() => void alarmStore.startDemo(difficulty)}
                    demoDisabled={!primary}
                  />
                  <AlarmSettings
                    primary={primary}
                    ready={ready}
                    audioPlaying={audioPlaying}
                    difficulty={difficulty}
                    onDifficulty={setDifficulty}
                    onExplainDifficulty={() => setDifficultyOpen(true)}
                  />
                </div>
                <section
                  className="alarms-section"
                  aria-labelledby="alarms-title"
                >
                  <div className="section-heading">
                    <h2 id="alarms-title">
                      あなたのアラーム{" "}
                      <span>
                        {data.alarms.length.toString().padStart(2, "0")}
                      </span>
                    </h2>
                    <span>この端末に保存 · 最大8件</span>
                  </div>
                  {data.alarms.length === 0 ? (
                    <div className="empty-alarm">
                      <BellOff size={22} strokeWidth={1.3} />
                      <p>
                        まだ、平和な朝です。
                        <span>
                          アラームをセットすると、ここに表示されます。
                        </span>
                      </p>
                      <span className="empty-label">NO ALARMS YET</span>
                    </div>
                  ) : (
                    <div className="alarm-list">
                      {data.alarms.map((alarm) => (
                        <div
                          className={`alarm-row ${!alarm.enabled ? "is-disabled" : ""}`}
                          key={alarm.id}
                        >
                          <div className="alarm-list-time">{alarm.time}</div>
                          <div className="alarm-row-info">
                            <strong>{alarm.name}</strong>
                            <span>
                              {DIFFICULTIES[alarm.difficulty].label} ·{" "}
                              {DIFFICULTIES[alarm.difficulty].total}問
                              <span className="alarm-row-date">
                                {" "}
                                ·{" "}
                                {alarm.enabled && alarm.nextAt
                                  ? new Intl.DateTimeFormat("ja-JP", {
                                      month: "numeric",
                                      day: "numeric",
                                    }).format(alarm.nextAt)
                                  : "オフ"}
                              </span>
                            </span>
                          </div>
                          <span className="alarm-volume-label">
                            <Volume2 size={13} />
                            {alarm.volume}%
                          </span>
                          <button
                            role="switch"
                            aria-checked={alarm.enabled}
                            aria-label={`${alarm.name}のアラーム`}
                            className="switch"
                            disabled={!primary}
                            onClick={() =>
                              void alarmStore.toggleAlarm(alarm.id)
                            }
                          >
                            <span />
                          </button>
                          <button
                            className="icon-button delete-alarm"
                            aria-label={`${alarm.name}を削除`}
                            disabled={!primary}
                            onClick={() => setDeleteTarget(alarm)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            ) : (
              <HistoryView
                history={data.history}
                primary={primary}
                onDemo={() => void alarmStore.startDemo("normal")}
                onShare={(entry) => void share(entry)}
              />
            )}

            <LimitationNotice />
            <div className="utility-row">
              <span>
                <ShieldCheck size={14} />
                設定・履歴はこの端末の中だけに
              </span>
              <button
                onClick={() => void alarmStore.requestNotifications()}
                disabled={
                  notification === "granted" || notification === "unsupported"
                }
              >
                <Bell size={14} />
                {notification === "granted"
                  ? "通知：許可済み"
                  : notification === "denied"
                    ? "通知：ブロック中（詳細）"
                    : notification === "unsupported"
                      ? "このブラウザは通知非対応"
                      : "通知を許可する"}
                {notification === "default" && <ChevronRight size={13} />}
              </button>
              <button onClick={() => setHelpOpen(true)}>
                <Smartphone size={14} />
                ホーム画面に追加
                <ArrowUpRight size={13} />
              </button>
            </div>
          </main>
          <footer className="site-footer">
            <span>GOOD NIGHT. GOOD LUCK.</span>
            <p>眠るのはあなた。解くのもあなた。</p>
            <a
              href="https://github.com/shunsoco-stack/impossible-alarm"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
              <ArrowUpRight size={13} />
            </a>
          </footer>
        </div>
      )}

      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button
            className="icon-button"
            aria-label="お知らせを閉じる"
            onClick={() => alarmStore.dismissMessage()}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {helpOpen && !data.session && (
        <Modal
          title="起きられない目覚ましの使い方"
          onClose={() => setHelpOpen(false)}
        >
          <div className="help-intro">
            <span className="eyebrow">A LITTLE CRUEL. VERY SIMPLE.</span>
            <p>
              前の晩の、強気な自分へ。
              <br />
              明日の朝は、ちゃんと起きましょう。
            </p>
          </div>
          <ol className="help-steps">
            <li>
              <span>01</span>
              <div>
                <strong>時間と、覚悟を決める。</strong>
                <p>
                  時刻・名前・難易度を設定。「試聴」で端末の音量も確認してからセットします。
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>この画面を、開いておく。</strong>
                <p>
                  時刻になると電子音が鳴ります。アラームは1回限り。再び使う場合は一覧のスイッチをオンにします。
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>解けたら、おはよう。</strong>
                <p>
                  足し算・引き算・掛け算に全問正解して停止。途中の正解数や問題は保存され、スヌーズしても続きから解けます。
                </p>
              </div>
            </li>
          </ol>
          <LimitationNotice />
          <div className="help-block">
            <h3>
              <Smartphone size={17} />
              ホーム画面に追加（PWA）
            </h3>
            <p>
              ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。対応や表記は端末によって異なります。追加しても、バックグラウンド動作や確実な発火を保証しません。
            </p>
            <p>
              初回オンライン読み込み・キャッシュの準備が完了すると、読み込み済み画面をオフラインで再表示できます。未キャッシュの画面や初回起動には通信が必要です。
            </p>
          </div>
          <div className="help-block">
            <h3>
              <LockKeyhole size={17} />
              プライバシーと安全
            </h3>
            <p>
              設定と履歴はlocalStorageでこのブラウザに保存します。履歴は直近100件。プライベートモード・データ消去・別端末への変更で失われることがあります。
            </p>
            <p>
              Vercel
              Analyticsにはページ閲覧と匿名の操作情報のみを送ります。名前・設定時刻・回答は送りません。独自イベントの集計可否は公開者のプランによります。通知は許可した場合のみ使用します。音がつらい場合は緊急停止できます。
            </p>
          </div>
          <button
            className="easter-egg-button"
            onClick={() => {
              setHelpOpen(false);
              void alarmStore.startDemo("hell", true);
            }}
            disabled={!primary}
          >
            <span>
              <strong>地獄の99問目、のぞいてみる？</strong>
              <small>エラー風演出を無音で体験。実際には壊れません。</small>
            </span>
            <ArrowRight size={19} />
          </button>
        </Modal>
      )}
      {difficultyOpen && !data.session && (
        <Modal
          title="起きる覚悟を選ぶ"
          onClose={() => setDifficultyOpen(false)}
          className="difficulty-modal"
        >
          <p className="modal-copy">
            難しいのは、計算よりも「昨日これを選んだ自分」を許すこと。
          </p>
          <DifficultyOptions
            value={difficulty}
            onChange={setDifficulty}
            expanded
          />
          <div className="difficulty-note">
            <ShieldCheck size={18} />
            <p>
              引き算はマイナスなし。間違えても最初には戻りません。
              <br />
              <span>地獄の99問目には、ちょっとした意地悪があります。</span>
            </p>
          </div>
          <button
            className="primary-button"
            onClick={() => setDifficultyOpen(false)}
          >
            この難易度にする
            <Check size={18} />
          </button>
          <button
            className="snooze-button"
            onClick={() => {
              setDifficultyOpen(false);
              void alarmStore.startDemo(difficulty);
            }}
            disabled={!primary}
          >
            この難易度で体験する（音あり）
            <ArrowUpRight size={15} />
          </button>
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          title="このアラームを削除しますか？"
          onClose={() => setDeleteTarget(null)}
        >
          <p className="modal-copy">
            「{deleteTarget.name}」{deleteTarget.time}{" "}
            の設定を削除します。過去の履歴は残ります。
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => setDeleteTarget(null)}
            >
              キャンセル
            </button>
            <button
              className="danger-button"
              onClick={() => {
                alarmStore.removeAlarm(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              削除する
            </button>
          </div>
        </Modal>
      )}
      {result && !data.session && (
        <Success entry={result} onShare={(entry) => void share(entry)} />
      )}
      {shareData && (
        <Modal
          title="この目覚ましを、誰かにも。"
          onClose={() => setShareData(null)}
        >
          <p className="modal-copy">明日の朝の試練を、おすそわけ。</p>
          <textarea
            className="share-text"
            aria-label="共有する文章"
            readOnly
            value={`${shareData.text}\n${shareData.url}`}
            rows={6}
            onFocus={(event) => event.target.select()}
          />
          <button className="primary-button" onClick={() => void copyShare()}>
            {copied ? <Check size={18} /> : <Clipboard size={18} />}
            {copied ? "コピーしました" : "文章とURLをコピー"}
          </button>
          <p className="fine-print" role="status">
            {shareError ||
              (copied
                ? "お好きなSNSやメッセージに貼り付けてください。"
                : "アラーム名や設定時刻は共有しません。")}
          </p>
        </Modal>
      )}
    </>
  );
}

function HistoryView({
  history,
  primary,
  onDemo,
  onShare,
}: {
  history: HistoryEntry[];
  primary: boolean;
  onDemo: () => void;
  onShare: (entry: HistoryEntry) => void;
}) {
  const [showDemos, setShowDemos] = useState(false);
  const entries = history.filter((entry) => showDemos || !entry.isDemo);
  const total = history.filter(
    (entry) => entry.result === "completed" && !entry.isDemo,
  ).length;
  return (
    <section className="history-section" aria-labelledby="history-title">
      <div className="history-heading">
        <div>
          <h2 id="history-title">おはようの記録</h2>
          <p>
            起床成功 <strong>{total}回</strong> · 直近100件を保存
          </p>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showDemos}
            onChange={(event) => setShowDemos(event.target.checked)}
          />
          体験も表示
        </label>
      </div>
      {entries.length === 0 ? (
        <div className="history-empty">
          <span>
            <Sun size={35} strokeWidth={1.3} />
          </span>
          <h3>最初の「おはよう」は、これから。</h3>
          <p>
            アラームを止めると、ここに朝の戦績が残ります。
            <br />
            まずは普通モードの5問を、体験してみませんか。
          </p>
          <button
            className="secondary-button"
            onClick={onDemo}
            disabled={!primary}
          >
            5問だけ体験する（音あり）
            <ArrowRight size={17} />
          </button>
        </div>
      ) : (
        <div className="history-list">
          {entries.map((entry) => (
            <article className="history-entry" key={entry.id}>
              <span
                className={`history-result-icon ${entry.result === "emergency" ? "stopped" : ""}`}
              >
                {entry.result === "completed" ? (
                  <Check size={21} />
                ) : (
                  <BellOff size={21} />
                )}
              </span>
              <div className="history-entry-main">
                <div>
                  <strong>{entry.name}</strong>
                  {entry.isDemo && (
                    <span className="history-demo-tag">体験</span>
                  )}
                  <span
                    className={`result-label ${entry.result === "emergency" ? "stopped" : ""}`}
                  >
                    {entry.result === "completed" ? "起床成功" : "緊急停止"}
                  </span>
                </div>
                <p>
                  <time dateTime={new Date(entry.endedAt).toISOString()}>
                    {new Intl.DateTimeFormat("ja-JP", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(entry.endedAt)}
                  </time>
                  <span>
                    {DIFFICULTIES[entry.difficulty].label} · {entry.solved}/
                    {entry.total}問
                  </span>
                </p>
              </div>
              <div className="history-entry-metrics">
                <span>
                  <Clock3 size={13} />
                  {formatDuration(entry.endedAt - entry.startedAt)}
                </span>
                <span>
                  逃走 {entry.snoozes}回 · 誤答 {entry.mistakes}回
                </span>
              </div>
              {entry.result === "completed" && (
                <button
                  className="icon-button"
                  aria-label={`${entry.name}の結果を共有`}
                  onClick={() => onShare(entry)}
                >
                  <Share2 size={16} />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      <p className="history-local-note">
        <ShieldCheck size={14} />
        緊急停止・体験は起床成功の集計に含みません。記録はこの端末だけに保存されます。
      </p>
    </section>
  );
}
