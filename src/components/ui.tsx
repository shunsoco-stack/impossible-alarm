"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AlarmClock, X } from "lucide-react";

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <AlarmClock size={22} strokeWidth={1.7} />
      </span>
      <div>
        <span className="brand-name">起きられない目覚まし</span>
        <span className="brand-sub">IMPOSSIBLE ALARM</span>
      </div>
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="閉じる">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function LimitationNotice({ compact = false }: { compact?: boolean }) {
  return (
    <aside
      className={`limitation ${compact ? "compact" : ""}`}
      aria-label="Webアラームの重要な制約"
    >
      <span className="notice-symbol" aria-hidden="true">
        !
      </span>
      <div>
        <strong>ブラウザやPWAを開いた状態での利用を推奨</strong>
        <p>
          端末の省電力・スリープ・画面ロック・タブの終了などにより、鳴らない場合があります。
          {!compact &&
            "確実な起床を保証するものではありません。大切な朝には、端末標準の目覚ましも併用してください。"}
        </p>
      </div>
    </aside>
  );
}
