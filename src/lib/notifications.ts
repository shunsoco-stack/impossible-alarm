export type AlarmNotificationPermission =
  NotificationPermission | "unsupported";

type Settled<T> =
  { status: "fulfilled"; value: T } | { status: "rejected" | "timeout" };

function settleWithin<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<Settled<T>> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: Settled<T>) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "timeout" }), milliseconds);
    promise.then(
      (value) => finish({ status: "fulfilled", value }),
      () => finish({ status: "rejected" }),
    );
  });
}

/** Reading support never opens a permission prompt. Safe during server rendering. */
export function notificationSupport(): AlarmNotificationPermission {
  if (typeof window === "undefined" || window.isSecureContext === false)
    return "unsupported";
  try {
    if (!("Notification" in window)) return "unsupported";
    return window.Notification.permission;
  } catch {
    return "unsupported";
  }
}

/** Invoke directly from an explicit "enable notifications" button, never on mount. */
export async function requestNotificationPermission(): Promise<AlarmNotificationPermission> {
  const permission = notificationSupport();
  if (permission !== "default") return permission;
  // Browsers that expose activation let us refuse accidental background prompts.
  if (
    typeof navigator !== "undefined" &&
    navigator.userActivation?.isActive === false
  ) {
    return permission;
  }
  try {
    return await window.Notification.requestPermission();
  } catch {
    return notificationSupport();
  }
}

/** Returns API acceptance, not a guarantee that the operating system displayed it. */
export async function notifyAlarm(name: string): Promise<boolean> {
  if (notificationSupport() !== "granted") return false;
  const title = "起きられない目覚まし";
  const label = name.trim().slice(0, 80) || "アラーム";
  const options: NotificationOptions = {
    body: `${label}の時間です。計算問題を解いてアラームを止めましょう。`,
    icon: "/icons/icon-192.png",
    tag: "impossible-alarm",
    silent: true,
    data: { url: "/" },
  };

  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.serviceWorker?.getRegistration
    ) {
      // .ready can wait forever when no worker is registered. Do not use it here.
      const result = await settleWithin(
        navigator.serviceWorker.getRegistration(),
        1_000,
      );
      if (notificationSupport() !== "granted") return false;
      const registration =
        result.status === "fulfilled" ? result.value : undefined;
      if (
        registration?.active &&
        typeof registration.showNotification === "function"
      ) {
        const shown = await settleWithin(
          registration.showNotification(title, options),
          1_500,
        );
        if (shown.status === "fulfilled") return true;
        // A slow accepted request might still display later; avoid a duplicate.
        if (shown.status === "timeout") return false;
      }
    }
  } catch {
    // Desktop Notification is a best-effort fallback for missing/rejected SW APIs.
  }

  if (notificationSupport() !== "granted") return false;
  try {
    const notification = new window.Notification(title, options);
    notification.onclick = () => {
      try {
        window.focus();
        notification.close();
      } catch {
        // The window may have been closed since notification delivery.
      }
    };
    return true;
  } catch {
    // Some mobile browsers only allow notifications via a service worker.
    return false;
  }
}
