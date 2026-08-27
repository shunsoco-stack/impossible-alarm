import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const title = "起きられない目覚まし — 朝の自分に、試練を。";
const description =
  "止めるには、解くしかない。最大100問の計算問題に挑む、朝から使いたくない目覚ましWebアプリ。ブラウザやPWAを開いた状態での利用を推奨。確実な発火は保証しません。";

export const metadata: Metadata = {
  metadataBase: new URL("https://impossible-alarm.vercel.app"),
  title,
  description,
  applicationName: "起きられない目覚まし",
  keywords: ["目覚まし", "計算", "アラーム", "PWA", "起きられない目覚まし"],
  alternates: { canonical: "/" },
  openGraph: {
    title,
    description,
    url: "/",
    siteName: "起きられない目覚まし",
    locale: "ja_JP",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "起きられない目覚まし — 朝の自分に、試練を。",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "起きられない目覚まし",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10120f",
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        {children}
        <Analytics />
        <noscript>
          <div className="noscript-notice">
            この目覚ましにはJavaScriptが必要です。ブラウザでJavaScriptを有効にしてください。アラームは現在動作していません。
          </div>
        </noscript>
      </body>
    </html>
  );
}
