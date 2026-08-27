/* Offline app-shell support only. This worker does NOT schedule alarms,
 * play audio in the background, or make delivery reliable while a device sleeps.
 * Bump VERSION when changing the shell strategy or precache assets. */
const PREFIX = "impossible-alarm-";
const VERSION = "v1";
const SHELL_CACHE = PREFIX + VERSION + "-shell";
const ASSET_CACHE = PREFIX + VERSION + "-assets";
const ROOT = new URL("/", self.location.origin).href;
const MAX_ASSETS = 192;
const PUBLIC_ASSETS = new Set([
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
]);

function isRscRequest(request, url) {
  return (
    url.searchParams.has("_rsc") ||
    request.headers.has("RSC") ||
    request.headers.has("Next-Router-State-Tree") ||
    request.headers.has("Next-Router-Prefetch") ||
    request.headers.has("Next-Router-Segment-Prefetch") ||
    (request.headers.get("Accept") || "").includes("text/x-component")
  );
}

function isBuildAsset(url) {
  return (
    url.origin === self.location.origin &&
    /^\/_next\/static\/.+\.(?:js|css|woff2?)$/i.test(url.pathname)
  );
}

function isSafeResponse(response) {
  return (
    response.status === 200 &&
    !response.redirected &&
    (response.type === "basic" || response.type === "default") &&
    !/\b(?:private|no-store)\b/i.test(
      response.headers.get("Cache-Control") || "",
    ) &&
    !/text\/x-component/i.test(response.headers.get("Content-Type") || "")
  );
}

function isHtml(response) {
  return (
    isSafeResponse(response) &&
    /^text\/html\b/i.test(response.headers.get("Content-Type") || "")
  );
}

function isImmutableAsset(response, url) {
  if (
    !isBuildAsset(url) ||
    !isSafeResponse(response) ||
    !/\bimmutable\b/i.test(response.headers.get("Cache-Control") || "")
  )
    return false;
  const type = response.headers.get("Content-Type") || "";
  if (/\.css$/i.test(url.pathname)) return /^text\/css\b/i.test(type);
  if (/\.js$/i.test(url.pathname))
    return /^(?:text|application)\/(?:javascript|ecmascript)\b/i.test(type);
  return /^(?:font\/woff2?|application\/(?:font-woff|x-font-woff))\b/i.test(
    type,
  );
}

function isPublicAsset(response, url) {
  if (!PUBLIC_ASSETS.has(url.pathname) || !isSafeResponse(response))
    return false;
  const type = response.headers.get("Content-Type") || "";
  if (url.pathname === "/manifest.webmanifest")
    return /^application\/(?:manifest\+json|json)\b/i.test(type);
  return /^image\/(?:png|x-icon|vnd\.microsoft\.icon)\b/i.test(type);
}

async function trimAssets(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ASSETS;
  if (excess <= 0) return;
  const keep = new Set(
    Array.from(PUBLIC_ASSETS).map((path) => new URL(path, ROOT).href),
  );
  try {
    const shell = await (await caches.open(SHELL_CACHE)).match(ROOT);
    if (shell && isHtml(shell)) {
      for (const dependency of dependenciesFromHtml(await shell.text()))
        keep.add(dependency);
    }
  } catch {
    // Apply the cap even when a previous shell cannot be inspected.
  }
  const removable = keys.filter((key) => !keep.has(key.url)).slice(0, excess);
  await Promise.all(removable.map((key) => cache.delete(key)));
}

async function putAsset(url, response) {
  const cache = await caches.open(ASSET_CACHE);
  await cache.put(url.href, response.clone());
  await trimAssets(cache);
}

async function readAsset(url) {
  try {
    return await (await caches.open(ASSET_CACHE)).match(url.href);
  } catch {
    return undefined;
  }
}

async function immutableAsset(request, required = false) {
  const url = new URL(typeof request === "string" ? request : request.url);
  const cached = await readAsset(url);
  if (cached && isImmutableAsset(cached, url)) return cached;
  const response = await fetch(request);
  if (!isImmutableAsset(response, url)) {
    if (required)
      throw new Error("An app dependency is not a cacheable immutable asset.");
    return response;
  }
  try {
    await putAsset(url, response);
  } catch (error) {
    if (required) throw error;
  }
  return response;
}

async function publicAsset(request, refresh = false) {
  const original = new URL(typeof request === "string" ? request : request.url);
  const url = new URL(original.pathname, self.location.origin);
  const cached = refresh ? undefined : await readAsset(url);
  if (cached && isPublicAsset(cached, url)) return cached;
  const response = await fetch(
    new Request(url.href, { cache: refresh ? "reload" : "default" }),
  );
  if (isPublicAsset(response, url)) {
    try {
      await putAsset(url, response);
    } catch {
      // A full/disabled cache must not prevent the online app from working.
    }
  }
  return response;
}

function dependenciesFromHtml(html) {
  const dependencies = new Set();
  for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replaceAll("&amp;", "&"), ROOT);
      if (isBuildAsset(url) && !url.searchParams.has("_rsc"))
        dependencies.add(url.href);
    } catch {
      // Ignore malformed attributes, external media, and non-build resources.
    }
  }
  if (dependencies.size > 80)
    throw new Error("The app shell exceeds the precache budget.");
  return Array.from(dependencies);
}

async function storeShell(response) {
  if (!isHtml(response))
    throw new Error("Only public HTML can become the app shell.");
  const dependencies = dependenciesFromHtml(await response.clone().text());
  // First-load assets can finish before SW registration. Explicitly warm the
  // real build URLs, then commit HTML only once its dependencies are available.
  await Promise.all(dependencies.map((url) => immutableAsset(url, true)));
  await (await caches.open(SHELL_CACHE)).put(ROOT, response.clone());
}

async function offlineShell() {
  try {
    const cached = await (await caches.open(SHELL_CACHE)).match(ROOT);
    if (cached && isHtml(cached)) return cached;
  } catch {
    // Storage can be unavailable in private/restricted browsing.
  }
  return new Response(
    '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>オフライン — 起きられない目覚まし</title><body style="background:#10120f;color:#e7eedc;font:16px/1.8 system-ui;padding:40px;max-width:620px">' +
      "<h1>まだ、オフラインの準備ができていません。</h1><p>一度オンラインでアプリを開き、読み込みの完了をお待ちください。</p>" +
      "<p>現在アラームは動作していません。ブラウザやPWAを開いた状態での利用を推奨します。端末の標準アラームも併用してください。</p>" +
      '<a href="/" style="color:#d1fa8a">もう一度開く</a></body></html>',
    {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

async function navigation(event) {
  try {
    const response = await fetch(event.request);
    if (isHtml(response))
      event.waitUntil(storeShell(response.clone()).catch(() => undefined));
    if (response.status >= 500) return offlineShell();
    return response;
  } catch {
    // All root query variants intentionally share one HTML-only offline shell.
    return offlineShell();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(
        new Request(ROOT, {
          cache: "reload",
          headers: { Accept: "text/html" },
        }),
      );
      await storeShell(response);
      await Promise.allSettled(
        Array.from(PUBLIC_ASSETS).map((path) =>
          publicAsset(new URL(path, ROOT).href, true),
        ),
      );
      // Deliberately no skipWaiting: updating must not replace a worker while the
      // user is still solving an alarm in an existing controlled tab.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(PREFIX) &&
              name !== SHELL_CACHE &&
              name !== ASSET_CACHE,
          )
          .map((name) => caches.delete(name)),
      );
      // Claiming routes requests; it does not reload or reset an active session.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isRscRequest(request, url)) return;
  // Analytics, APIs, arbitrary paths and third-party resources never enter caches.
  if (request.mode === "navigate" && url.pathname === "/")
    event.respondWith(navigation(event));
  else if (isBuildAsset(url)) event.respondWith(immutableAsset(request));
  else if (PUBLIC_ASSETS.has(url.pathname))
    event.respondWith(publicAsset(request));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      let windows = [];
      try {
        windows = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
      } catch {
        // Opening the known app root is still a safe fallback.
      }
      for (const client of windows) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin && url.pathname === "/") {
            await client.focus();
            return;
          }
        } catch {
          // Continue if a window closed or its URL cannot be inspected.
        }
      }
      // Never navigate to notification.data.url (or another untrusted URL).
      try {
        await self.clients.openWindow(ROOT);
      } catch {
        // The browser may restrict opening a window after notification interaction.
      }
    })(),
  );
});
