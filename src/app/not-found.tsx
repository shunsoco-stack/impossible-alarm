import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found">
      <span className="eyebrow">404 · ALARM NOT FOUND</span>
      <h1>
        ここには、
        <br />
        朝は来ません。
      </h1>
      <p>ページが見つかりませんでした。時計に戻りましょう。</p>
      <Link className="primary-button" href="/">
        目覚ましに戻る →
      </Link>
    </main>
  );
}
