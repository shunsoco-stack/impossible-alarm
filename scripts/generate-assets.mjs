import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Original vector artwork and typesetting. System fonts are rasterized locally:
// no font files, third-party artwork, or downloaded media are redistributed.
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(project, "public");
const iconsDir = join(publicDir, "icons");
const charcoal = "#10120f";
const lime = "#d1fa8a";
await mkdir(iconsDir, { recursive: true });

function systemFont(candidates, override) {
  if (override) {
    if (!existsSync(override))
      throw new Error("The supplied system font path does not exist.");
    return { path: override, family: "sans" };
  }
  const selected = candidates.find((candidate) => existsSync(candidate.path));
  if (!selected)
    throw new Error(
      "A Japanese-capable system font is required. Set ASSET_JA_FONT to its local path.",
    );
  return selected;
}

const japanese = systemFont(
  [
    { path: "C:/Windows/Fonts/YuGothB.ttc", family: "Yu Gothic" },
    { path: "C:/Windows/Fonts/meiryob.ttc", family: "Meiryo" },
    {
      path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
      family: "Noto Sans CJK JP",
    },
    {
      path: "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
      family: "Hiragino Sans",
    },
  ],
  process.env.ASSET_JA_FONT,
);
const latin = systemFont(
  [
    { path: "C:/Windows/Fonts/segoeui.ttf", family: "Segoe UI" },
    {
      path: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      family: "DejaVu Sans",
    },
    { path: "/System/Library/Fonts/Helvetica.ttc", family: "Helvetica Neue" },
  ],
  process.env.ASSET_LATIN_FONT,
);
const latinLight = existsSync("C:/Windows/Fonts/segoeuil.ttf")
  ? { path: "C:/Windows/Fonts/segoeuil.ttf", family: "Segoe UI Light" }
  : latin;

const iconSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
  '<rect width="512" height="512" fill="' + charcoal + '"/>',
  '<circle cx="244" cy="234" r="133" fill="none" stroke="' +
    lime +
    '" stroke-width="15"/>',
  '<g stroke="' +
    lime +
    '" stroke-width="9" stroke-linecap="round" opacity=".46">',
  '<path d="M244 126v9M352 234h-9M244 342v-9M136 234h9"/></g>',
  '<path d="M244 156v78l-34 59" fill="none" stroke="' +
    lime +
    '" stroke-width="19" stroke-linecap="round" stroke-linejoin="round"/>',
  '<circle cx="244" cy="234" r="10" fill="' + lime + '"/>',
  '<circle cx="348" cy="354" r="62" fill="' + charcoal + '"/>',
  '<circle cx="348" cy="354" r="51" fill="' + lime + '"/>',
  '<path d="M348 331v46M325 354h46" stroke="' +
    charcoal +
    '" stroke-width="12" stroke-linecap="round"/>',
  "</svg>",
].join("");
await writeFile(join(iconsDir, "icon.svg"), iconSvg);

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  // All meaningful marks stay within the central 80% maskable safe circle.
  await sharp(Buffer.from(iconSvg), { density: 192 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(iconsDir, name));
}

const faviconSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">',
  '<rect width="32" height="32" rx="7" fill="' + charcoal + '"/>',
  '<circle cx="14.5" cy="14" r="9" fill="none" stroke="' +
    lime +
    '" stroke-width="2"/>',
  '<path d="M14.5 8v6l-3 5" fill="none" stroke="' +
    lime +
    '" stroke-width="2.2" stroke-linecap="round"/>',
  '<circle cx="23" cy="24" r="6.3" fill="' + charcoal + '"/>',
  '<circle cx="23" cy="24" r="5" fill="' + lime + '"/>',
  '<path d="M23 21.5v5M20.5 24h5" stroke="' +
    charcoal +
    '" stroke-width="1.6" stroke-linecap="round"/>',
  "</svg>",
].join("");
const faviconPng = await sharp(Buffer.from(faviconSvg)).png().toBuffer();
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader[6] = 32;
icoHeader[7] = 32;
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(faviconPng.length, 14);
icoHeader.writeUInt32LE(22, 18);
await writeFile(
  join(publicDir, "favicon.ico"),
  Buffer.concat([icoHeader, faviconPng]),
);

function escapeMarkup(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function textLayer(
  text,
  {
    left,
    top,
    size,
    color = "#f5f6f0",
    font = latin,
    weight = "normal",
    tracking = 0,
    maxWidth = 1100,
  },
) {
  const markup =
    '<span foreground="' +
    color +
    '" weight="' +
    weight +
    '" letter_spacing="' +
    Math.round(tracking * 1024) +
    '">' +
    escapeMarkup(text) +
    "</span>";
  const { data, info } = await sharp({
    text: {
      text: markup,
      font: font.family + " " + size,
      fontfile: font.path,
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width > maxWidth ||
    left + info.width > 1200 ||
    top + info.height > 630
  ) {
    throw new Error("A typography layer exceeds its safe bounds: " + text);
  }
  return { input: data, left, top };
}

const ogBackground = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">',
  '<rect width="1200" height="630" fill="' + charcoal + '"/>',
  '<circle cx="917" cy="321" r="226" fill="#141811" stroke="#293121" stroke-width="1"/>',
  '<path d="M757 161A226 226 0 0 1 1066 153" fill="none" stroke="#6b8154" stroke-width="2"/>',
  '<path d="M593 157v340" stroke="#2c3227" stroke-width="1"/>',
  '<circle cx="86" cy="75" r="12" fill="none" stroke="' +
    lime +
    '" stroke-width="2"/>',
  '<path d="M86 67v8l-4 5" fill="none" stroke="' +
    lime +
    '" stroke-width="2" stroke-linecap="round"/>',
  '<rect x="72" y="472" width="319" height="45" rx="22.5" fill="#20281a" stroke="#3d4a30"/>',
  '<g fill="#20271b" stroke="#35402c">',
  '<circle cx="838" cy="472" r="24"/><circle cx="917" cy="472" r="24"/><circle cx="996" cy="472" r="24"/></g>',
  '<g stroke="' + lime + '" stroke-width="2.5" stroke-linecap="round">',
  '<path d="M838 464v16M830 472h16M911 466l12 12M911 478l12-12M988 468h16M988 476h16"/></g>',
  '<path d="M72 554h26" stroke="#71825e" stroke-width="1"/>',
  "</svg>",
].join("");

const layers = await Promise.all([
  textLayer("IMPOSSIBLE ALARM", {
    left: 114,
    top: 66,
    size: 15,
    color: lime,
    tracking: 2.8,
  }),
  textLayer("MORNING, HARD MODE.", {
    left: 924,
    top: 69,
    size: 11,
    color: "#a0aa96",
    tracking: 1.6,
  }),
  textLayer("起きられない", {
    left: 69,
    top: 183,
    size: 57,
    font: japanese,
    weight: "bold",
    tracking: -1,
    maxWidth: 485,
  }),
  textLayer("目覚まし", {
    left: 69,
    top: 261,
    size: 57,
    font: japanese,
    weight: "bold",
    tracking: -1,
    maxWidth: 485,
  }),
  textLayer("朝の自分に、試練を。", {
    left: 73,
    top: 364,
    size: 24,
    font: japanese,
    color: "#b2baaa",
    maxWidth: 450,
  }),
  textLayer("5 / 20 / 100 QUESTIONS", {
    left: 95,
    top: 486,
    size: 14,
    color: lime,
    tracking: 1.4,
  }),
  textLayer("AM", {
    left: 774,
    top: 192,
    size: 13,
    color: "#a6b199",
    tracking: 3,
  }),
  textLayer("07:00", {
    left: 753,
    top: 242,
    size: 153,
    font: latinLight,
    color: "#e6edda",
    tracking: -6,
    maxWidth: 435,
  }),
  textLayer("WAKE UP. WORK IT OUT.", {
    left: 836,
    top: 405,
    size: 11,
    color: "#a6b199",
    tracking: 1.9,
  }),
  textLayer("止めるには、解くしかない。", {
    left: 112,
    top: 545,
    size: 14,
    font: japanese,
    color: "#9ba58f",
  }),
  textLayer("DESIGNED TO BE DIFFICULT", {
    left: 914,
    top: 570,
    size: 9,
    color: "#79856c",
    tracking: 1.2,
  }),
]);
await sharp(Buffer.from(ogBackground))
  .composite(layers)
  .png({ compressionLevel: 9 })
  .toFile(join(publicDir, "og.png"));

for (const path of [
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "favicon.ico",
  "og.png",
]) {
  const file = join(publicDir, path);
  const size = (await stat(file)).size;
  console.log("Generated " + path + " (" + size + " bytes)");
}
