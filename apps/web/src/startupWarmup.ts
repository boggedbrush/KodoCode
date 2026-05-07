type IdleWindow = Window & {
  readonly requestIdleCallback?: (
    callback: () => void,
    options?: { readonly timeout?: number },
  ) => number;
};

let startupWarmupScheduled = false;

function scheduleIdleTask(callback: () => void, delayMs: number, timeoutMs: number): void {
  window.setTimeout(() => {
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === "function") {
      idleWindow.requestIdleCallback(callback, { timeout: timeoutMs });
      return;
    }

    window.setTimeout(callback, 0);
  }, delayMs);
}

export function scheduleStartupWarmup(): void {
  if (startupWarmupScheduled || import.meta.env.MODE === "test") {
    return;
  }
  startupWarmupScheduled = true;

  scheduleIdleTask(
    () => {
      void import("./components/settings/SettingsGeneralPanel");
      void import("./components/settings/SettingsRestore");
    },
    150,
    1_500,
  );

  scheduleIdleTask(
    () => {
      void import("./routes/_chat.$threadId");
      void import("./components/ChatView");
    },
    500,
    2_500,
  );
}

export function resetStartupWarmupForTests(): void {
  startupWarmupScheduled = false;
}
