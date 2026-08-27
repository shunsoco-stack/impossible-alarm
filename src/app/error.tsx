"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="not-found">
      <span className="eyebrow">SOMETHING WENT WRONG</span>
      <h1>画面を表示できませんでした。</h1>
      <p>
        これは99問目の演出ではありません。再読み込みすると保存済みの進捗から復帰します。音声は再度有効にしてください。
      </p>
      <button className="primary-button" onClick={reset}>
        もう一度試す
      </button>
      <button onClick={() => window.location.reload()} className="text-link">
        再読み込みする
      </button>
    </main>
  );
}
