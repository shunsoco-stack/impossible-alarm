import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ORIGIN = "https://impossible-alarm.example";
const ROOT = ORIGIN + "/";
const SHELL = "impossible-alarm-v1-shell";
const ASSETS = "impossible-alarm-v1-assets";
const source = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
const initialHtml =
  '<!doctype html><html lang="ja"><head>' +
  '<link rel="stylesheet" href="/_next/static/css/styles-abc.css">' +
  '<script src="/_next/static/chunks/app-abc.js"></script>' +
  '<script src="https://untrusted.example/_next/static/ignored.js"></script>' +
  "</head><body>起きられない目覚まし</body></html>";

function inputUrl(input: Request | string) {
  return typeof input === "string" ? new URL(input, ROOT).href : input.url;
}

function htmlResponse(html = initialHtml, cacheControl = "public, max-age=0") {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

function buildResponse(path: string, immutable = true) {
  const type = path.endsWith(".css") ? "text/css" : "text/javascript";
  return new Response(
    path.endsWith(".css") ? "body{color:lime}" : "globalThis.appLoaded=true",
    {
      headers: {
        "Content-Type": type,
        "Cache-Control": immutable
          ? "public,max-age=31536000,immutable"
          : "no-cache",
      },
    },
  );
}

class MemoryCache {
  entries = new Map<string, Response>();
  match = vi.fn(async (input: Request | string) =>
    this.entries.get(inputUrl(input))?.clone(),
  );
  put = vi.fn(async (input: Request | string, response: Response) => {
    this.entries.set(inputUrl(input), response.clone());
  });
  keys = vi.fn(async () =>
    [...this.entries.keys()].map((url) => new Request(url)),
  );
  delete = vi.fn(async (input: Request | string) =>
    this.entries.delete(inputUrl(input)),
  );
}

function harness() {
  const cacheRecords = new Map<string, MemoryCache>();
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!cacheRecords.has(name)) cacheRecords.set(name, new MemoryCache());
      return cacheRecords.get(name)!;
    }),
    keys: vi.fn(async () => [...cacheRecords.keys()]),
    delete: vi.fn(async (name: string) => cacheRecords.delete(name)),
  };
  const fetch = vi.fn(async (input: Request | string): Promise<Response> => {
    const path = new URL(inputUrl(input)).pathname;
    if (path === "/") return htmlResponse();
    if (path.startsWith("/_next/static/")) return buildResponse(path);
    if (path === "/manifest.webmanifest") {
      return new Response('{"name":"起きられない目覚まし"}', {
        headers: { "Content-Type": "application/manifest+json" },
      });
    }
    return new Response("image bytes", {
      headers: {
        "Content-Type": path.endsWith(".ico") ? "image/x-icon" : "image/png",
      },
    });
  });
  type WindowClient = { url: string; focus: () => Promise<unknown> };
  const clients = {
    claim: vi.fn(async () => undefined),
    matchAll: vi.fn(async (): Promise<WindowClient[]> => []),
    openWindow: vi.fn(async () => undefined),
  };
  const skipWaiting = vi.fn();
  const listeners = new Map<string, (event: unknown) => void>();
  runInNewContext(
    source,
    {
      self: {
        location: { origin: ORIGIN },
        clients,
        skipWaiting,
        addEventListener: (name: string, listener: (event: unknown) => void) =>
          listeners.set(name, listener),
      },
      caches,
      fetch,
      Request,
      Response,
      URL,
    },
    { filename: "sw.js" },
  );

  function dispatch(type: string, fields: Record<string, unknown> = {}) {
    const promises: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const event = {
      ...fields,
      waitUntil: vi.fn((work: Promise<unknown>) => promises.push(work)),
      respondWith: vi.fn((work: Promise<Response>) => {
        response = Promise.resolve(work);
      }),
    };
    listeners.get(type)?.(event);
    return {
      event,
      get response() {
        return response;
      },
      done: () => Promise.all(promises),
    };
  }

  function request(
    path: string,
    options: {
      mode?: string;
      method?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    // Node disallows constructing Request(mode: "navigate"); this mirrors the
    // read-only fields delivered by a real browser FetchEvent.
    return {
      url: new URL(path, ROOT).href,
      method: options.method ?? "GET",
      mode: options.mode ?? "cors",
      headers: new Headers(options.headers),
    };
  }
  return {
    dispatch,
    request,
    caches,
    cacheRecords,
    fetch,
    clients,
    skipWaiting,
    listeners,
  };
}

describe("offline service worker", () => {
  it("precaches the real same-origin JS/CSS dependencies before storing root HTML", async () => {
    const app = harness();
    await app.dispatch("install").done();
    const shell = await app.caches.open(SHELL);
    const assets = await app.caches.open(ASSETS);
    expect(await (await shell.match(ROOT))?.text()).toBe(initialHtml);
    expect(assets.entries.has(ORIGIN + "/_next/static/chunks/app-abc.js")).toBe(
      true,
    );
    expect(
      assets.entries.has(ORIGIN + "/_next/static/css/styles-abc.css"),
    ).toBe(true);
    expect(assets.entries.has(ORIGIN + "/manifest.webmanifest")).toBe(true);
    expect(assets.entries.has(ORIGIN + "/icons/icon-192.png")).toBe(true);
    expect(
      app.fetch.mock.calls.every(
        ([request]) => new URL(inputUrl(request)).origin === ORIGIN,
      ),
    ).toBe(true);
    expect(app.skipWaiting).not.toHaveBeenCalled();
  });

  it("can load root query variants and build assets offline immediately after installation", async () => {
    const app = harness();
    await app.dispatch("install").done();
    app.fetch.mockRejectedValue(new Error("offline"));
    const navigation = app.dispatch("fetch", {
      request: app.request("/?preview=hell", { mode: "navigate" }),
    });
    expect(await (await navigation.response)?.text()).toBe(initialHtml);
    for (const path of [
      "/_next/static/chunks/app-abc.js",
      "/_next/static/css/styles-abc.css",
    ]) {
      const asset = app.dispatch("fetch", { request: app.request(path) });
      expect((await asset.response)?.status).toBe(200);
    }
    expect((await app.caches.open(SHELL)).entries.size).toBe(1);
  });

  it("returns an honest offline fallback if the shell has never been cached", async () => {
    const app = harness();
    app.fetch.mockRejectedValue(new Error("offline"));
    const navigation = app.dispatch("fetch", {
      request: app.request("/", { mode: "navigate" }),
    });
    const response = await navigation.response;
    expect(response?.status).toBe(503);
    expect(await response?.text()).toContain("現在アラームは動作していません");
  });

  it.each<{ path: string; headers: Record<string, string> }>([
    { path: "/?_rsc=random", headers: {} },
    { path: "/", headers: { RSC: "1" } },
    { path: "/", headers: { "Next-Router-State-Tree": "{}" } },
    { path: "/", headers: { "Next-Router-Prefetch": "1" } },
    { path: "/", headers: { "Next-Router-Segment-Prefetch": "/tree" } },
    { path: "/", headers: { Accept: "text/x-component" } },
  ])(
    "does not intercept or cache an RSC request: $path $headers",
    ({ path, headers }) => {
      const app = harness();
      const event = app.dispatch("fetch", {
        request: app.request(path, { mode: "navigate", headers }),
      });
      expect(event.event.respondWith).not.toHaveBeenCalled();
      expect(app.fetch).not.toHaveBeenCalled();
    },
  );

  it("never replaces cached HTML with a text/x-component response", async () => {
    const app = harness();
    await app.dispatch("install").done();
    app.fetch.mockResolvedValue(
      new Response('0:{"tree":1}', {
        headers: { "Content-Type": "text/x-component" },
      }),
    );
    const event = app.dispatch("fetch", {
      request: app.request("/", { mode: "navigate" }),
    });
    await event.response;
    await event.done();
    expect(
      await (await (await app.caches.open(SHELL)).match(ROOT))?.text(),
    ).toBe(initialHtml);
  });

  it.each([
    "/_vercel/insights/script.js",
    "/_vercel/insights/event",
    "/api/alarms",
    "/sw.js",
    "/unrelated",
    "https://untrusted.example/_next/static/chunks/evil.js",
  ])("does not intercept non-allowlisted resources: %s", (path) => {
    const app = harness();
    const event = app.dispatch("fetch", { request: app.request(path) });
    expect(event.event.respondWith).not.toHaveBeenCalled();
  });

  it("ignores non-GET requests even when the URL is allowlisted", () => {
    const app = harness();
    const event = app.dispatch("fetch", {
      request: app.request("/", { mode: "navigate", method: "POST" }),
    });
    expect(event.event.respondWith).not.toHaveBeenCalled();
  });

  it.each([
    ["text/html", "public,max-age=31536000,immutable"],
    ["text/javascript", "no-cache"],
    ["text/javascript", "private,immutable"],
    ["text/x-component", "public,immutable"],
  ])(
    "does not cache a build resource with unsafe headers %s / %s",
    async (type, control) => {
      const app = harness();
      app.fetch.mockResolvedValue(
        new Response("not-cacheable", {
          headers: { "Content-Type": type, "Cache-Control": control },
        }),
      );
      const event = app.dispatch("fetch", {
        request: app.request("/_next/static/chunks/test.js"),
      });
      expect((await event.response)?.status).toBe(200);
      expect((await app.caches.open(ASSETS)).entries.size).toBe(0);
    },
  );

  it("uses fresh navigation HTML online but keeps the previous coherent offline shell if precaching fails", async () => {
    const app = harness();
    await app.dispatch("install").done();
    const changedHtml =
      '<html><script src="/_next/static/chunks/next-version.js"></script><body>new version</body></html>';
    app.fetch.mockImplementation(async (input) => {
      if (new URL(inputUrl(input)).pathname === "/")
        return htmlResponse(changedHtml);
      throw new Error("dependency unavailable");
    });
    const event = app.dispatch("fetch", {
      request: app.request("/?source=share", { mode: "navigate" }),
    });
    expect(await (await event.response)?.text()).toBe(changedHtml);
    await event.done();
    expect(
      await (await (await app.caches.open(SHELL)).match(ROOT))?.text(),
    ).toBe(initialHtml);
  });

  it("fails a new install rather than committing HTML without its required JS", async () => {
    const app = harness();
    app.fetch.mockImplementation(async (input) => {
      if (new URL(inputUrl(input)).pathname === "/") return htmlResponse();
      throw new Error("offline while installing");
    });
    await expect(app.dispatch("install").done()).rejects.toThrow(
      "offline while installing",
    );
    expect((await app.caches.open(SHELL)).entries.size).toBe(0);
  });

  it("does not install a private or no-store app shell", async () => {
    const app = harness();
    app.fetch.mockResolvedValue(htmlResponse(initialHtml, "private, no-store"));
    await expect(app.dispatch("install").done()).rejects.toThrow(
      "Only public HTML",
    );
    expect((await app.caches.open(SHELL)).entries.size).toBe(0);
  });

  it("normalizes public icon query strings without cache growth", async () => {
    const app = harness();
    await app.dispatch("install").done();
    const before = (await app.caches.open(ASSETS)).entries.size;
    app.fetch.mockRejectedValue(new Error("offline"));
    const event = app.dispatch("fetch", {
      request: app.request("/icons/icon-192.png?anything=1"),
    });
    expect((await event.response)?.status).toBe(200);
    expect((await app.caches.open(ASSETS)).entries.size).toBe(before);
  });

  it("bounds asset caching while retaining the current offline shell dependencies", async () => {
    const app = harness();
    await app.dispatch("install").done();
    for (let index = 0; index < 205; index += 1) {
      const event = app.dispatch("fetch", {
        request: app.request("/_next/static/chunks/test-" + index + ".js"),
      });
      await event.response;
    }
    const assets = await app.caches.open(ASSETS);
    expect(assets.entries.size).toBeLessThanOrEqual(192);
    expect(assets.entries.has(ORIGIN + "/_next/static/chunks/app-abc.js")).toBe(
      true,
    );
    expect(
      assets.entries.has(ORIGIN + "/_next/static/css/styles-abc.css"),
    ).toBe(true);
    expect(assets.entries.has(ORIGIN + "/icons/icon-192.png")).toBe(true);
    expect((await app.caches.open(SHELL)).entries.has(ROOT)).toBe(true);
  });

  it("only deletes older caches owned by this app during activation", async () => {
    const app = harness();
    await app.caches.open("other-app-v0");
    await app.caches.open("impossible-alarm-v0-shell");
    await app.caches.open(SHELL);
    await app.caches.open(ASSETS);
    await app.dispatch("activate").done();
    expect(app.cacheRecords.has("other-app-v0")).toBe(true);
    expect(app.cacheRecords.has("impossible-alarm-v0-shell")).toBe(false);
    expect(app.cacheRecords.has(SHELL)).toBe(true);
    expect(app.cacheRecords.has(ASSETS)).toBe(true);
    expect(app.clients.claim).toHaveBeenCalledTimes(1);
    expect(app.skipWaiting).not.toHaveBeenCalled();
  });

  it("has no push, sync, or periodic background-alarm handlers", () => {
    const app = harness();
    expect([...app.listeners.keys()].sort()).toEqual([
      "activate",
      "fetch",
      "install",
      "notificationclick",
    ]);
  });
});

describe("notification navigation", () => {
  it("focuses an existing app window without changing its progress URL", async () => {
    const app = harness();
    const focus = vi.fn(async () => undefined);
    const close = vi.fn();
    app.clients.matchAll.mockResolvedValue([
      { url: ROOT + "?view=active", focus },
    ]);
    await app
      .dispatch("notificationclick", {
        notification: { close, data: { url: "https://untrusted.example" } },
      })
      .done();
    expect(close).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(app.clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens only the fixed same-origin root and ignores notification payload URLs", async () => {
    const app = harness();
    const otherFocus = vi.fn(async () => undefined);
    app.clients.matchAll.mockResolvedValue([
      { url: "https://untrusted.example/", focus: otherFocus },
      { url: ORIGIN + "/different-app", focus: otherFocus },
    ]);
    await app
      .dispatch("notificationclick", {
        notification: { close: vi.fn(), data: { url: "javascript:alert(1)" } },
      })
      .done();
    expect(otherFocus).not.toHaveBeenCalled();
    expect(app.clients.openWindow).toHaveBeenCalledWith(ROOT);
  });

  it("falls back to opening root if focusing a closed window fails", async () => {
    const app = harness();
    app.clients.matchAll.mockResolvedValue([
      { url: ROOT, focus: vi.fn().mockRejectedValue(new Error("closed")) },
    ]);
    await app
      .dispatch("notificationclick", { notification: { close: vi.fn() } })
      .done();
    expect(app.clients.openWindow).toHaveBeenCalledWith(ROOT);
  });
});
