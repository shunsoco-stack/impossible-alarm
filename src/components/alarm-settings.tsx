"use client";

import { useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Check,
  ChevronRight,
  Flame,
  Play,
  Plus,
  Skull,
  Smile,
  Square,
  Volume2,
} from "lucide-react";
import { DIFFICULTIES, type Difficulty } from "@/lib/alarm";
import { alarmStore } from "@/lib/alarm-store";

const levels: Difficulty[] = ["normal", "crap", "hell"];
const LevelIcon = { normal: Smile, crap: Flame, hell: Skull };

export function DifficultyOptions({
  value,
  onChange,
  expanded = false,
}: {
  value: Difficulty;
  onChange: (value: Difficulty) => void;
  expanded?: boolean;
}) {
  return (
    <fieldset className={`difficulty-field ${expanded ? "expanded" : ""}`}>
      <legend>
        {expanded ? "朝の自分に、どこまで厳しくする？" : "起きる覚悟"}
      </legend>
      <div className="difficulty-options">
        {levels.map((level) => {
          const Icon = LevelIcon[level];
          return (
            <label
              key={level}
              className={`difficulty-option ${value === level ? "selected" : ""} ${level}`}
            >
              <input
                type="radio"
                name={expanded ? "difficulty-expanded" : "difficulty"}
                value={level}
                checked={value === level}
                onChange={() => onChange(level)}
              />
              <span className="difficulty-icon">
                <Icon size={expanded ? 27 : 19} strokeWidth={1.6} />
              </span>
              <strong>{DIFFICULTIES[level].label}</strong>
              <span className="difficulty-count">
                {DIFFICULTIES[level].total}
                <small>問</small>
              </span>
              {expanded && (
                <span className="difficulty-caption">
                  {DIFFICULTIES[level].caption}
                </span>
              )}
              {value === level && (
                <Check size={13} className="selection-check" />
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function AlarmSettings({
  primary,
  ready,
  audioPlaying,
  difficulty,
  onDifficulty,
  onExplainDifficulty,
}: {
  primary: boolean;
  ready: boolean;
  audioPlaying: boolean;
  difficulty: Difficulty;
  onDifficulty: (difficulty: Difficulty) => void;
  onExplainDifficulty: () => void;
}) {
  const [time, setTime] = useState("07:00");
  const [name, setName] = useState("明日の自分へ");
  const [volume, setVolume] = useState(40);
  const [saving, setSaving] = useState(false);
  function adjustTime(unit: "hour" | "minute", direction: number) {
    const [h, m] = (time || "07:00").split(":").map(Number);
    const total =
      (((h * 60 + m + direction * (unit === "hour" ? 60 : 1)) % 1440) + 1440) %
      1440;
    setTime(
      `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    await alarmStore.addAlarm({ name, time, difficulty, volume });
    setSaving(false);
  }
  return (
    <section className="settings-panel" aria-labelledby="settings-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR NEXT MORNING</span>
          <h2 id="settings-title">アラームを設定</h2>
        </div>
        <span className="circle-icon">
          <Plus size={21} strokeWidth={1.5} />
        </span>
      </div>
      <form onSubmit={submit}>
        <div className="field-header">
          <label htmlFor="alarm-time">起きる時間</label>
          <span>24時間表示 · 1回のみ</span>
        </div>
        <div className="time-picker">
          <div className="time-adjustments" aria-label="時間の調整">
            <button
              type="button"
              aria-label="1時間進める"
              onClick={() => adjustTime("hour", 1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              type="button"
              aria-label="1分進める"
              onClick={() => adjustTime("minute", 1)}
            >
              <ArrowUp size={15} />
            </button>
          </div>
          <input
            id="alarm-time"
            aria-label="起きる時間"
            type="time"
            step="60"
            value={time}
            required
            onChange={(event) => setTime(event.target.value)}
          />
          <div className="time-adjustments" aria-label="時間を戻す">
            <button
              type="button"
              aria-label="1時間戻す"
              onClick={() => adjustTime("hour", -1)}
            >
              <ArrowDown size={15} />
            </button>
            <button
              type="button"
              aria-label="1分戻す"
              onClick={() => adjustTime("minute", -1)}
            >
              <ArrowDown size={15} />
            </button>
          </div>
        </div>
        <label className="field-label" htmlFor="alarm-name">
          アラーム名
        </label>
        <input
          id="alarm-name"
          className="text-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder="明日の自分へ"
          autoComplete="off"
        />
        <div className="difficulty-heading">
          <span aria-hidden="true" />
          <button
            type="button"
            className="text-link"
            onClick={onExplainDifficulty}
          >
            難易度について <ChevronRight size={13} />
          </button>
        </div>
        <DifficultyOptions value={difficulty} onChange={onDifficulty} />
        <div className="volume-section">
          <div className="field-header">
            <label htmlFor="alarm-volume">
              <Volume2 size={16} />
              アラーム音量
            </label>
            <output htmlFor="alarm-volume">
              {volume}%{volume === 0 ? " · 無音" : ""}
            </output>
          </div>
          <div className="volume-controls">
            <input
              id="alarm-volume"
              type="range"
              min="0"
              max="100"
              step="5"
              value={volume}
              onChange={(event) => {
                const next = Number(event.target.value);
                setVolume(next);
                alarmStore.setPreviewVolume(next);
              }}
              aria-valuetext={`${volume}パーセント${volume === 0 ? "、無音" : ""}`}
            />
            <button
              type="button"
              className={`preview-button ${audioPlaying ? "playing" : ""}`}
              disabled={!primary}
              onClick={() => void alarmStore.preview(volume)}
            >
              {audioPlaying ? (
                <Square size={12} fill="currentColor" />
              ) : (
                <Play size={12} fill="currentColor" />
              )}
              {audioPlaying ? "停止" : "試聴"}
            </button>
          </div>
          <p className="fine-print">
            オリジナルの電子音を3秒再生。端末の音量もご確認ください。
          </p>
        </div>
        <p className="settings-safety-note">
          ブラウザやPWAを開いたまま利用してください。省電力・画面ロック等では鳴らない場合があります。
        </p>
        <button
          className="primary-button set-alarm"
          type="submit"
          disabled={!primary || saving || !time}
        >
          <Bell size={18} />
          {!ready ? "準備中…" : saving ? "設定中…" : "この覚悟でセットする"}
          <span aria-hidden="true">↗</span>
        </button>
        <p className="settings-footnote">
          止めるには、{DIFFICULTIES[difficulty].total}問の正解が必要です。
        </p>
      </form>
    </section>
  );
}
