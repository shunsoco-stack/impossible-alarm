import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "起きられない目覚まし",
    short_name: "起きられない",
    description:
      "朝の自分に、試練を。計算問題を解いて止める目覚まし。ブラウザやPWAを開いた状態での利用を推奨。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#10120f",
    theme_color: "#10120f",
    lang: "ja",
    categories: ["utilities", "entertainment"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
