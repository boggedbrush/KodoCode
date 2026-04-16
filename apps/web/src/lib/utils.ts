import { CommandId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { String, Predicate } from "effect";
import { type CxOptions, cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";
import * as Random from "effect/Random";
import * as Effect from "effect/Effect";
import { readDesktopConnectionWsUrl } from "../desktopRuntime";

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function isWindowsPlatform(platform: string): boolean {
  return /^win(dows)?/i.test(platform);
}

export function isLinuxPlatform(platform: string): boolean {
  return /linux/i.test(platform);
}

export function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Effect.runSync(Random.nextUUIDv4);
}

export const newCommandId = (): CommandId => CommandId.makeUnsafe(randomUUID());

export const newProjectId = (): ProjectId => ProjectId.makeUnsafe(randomUUID());

export const newThreadId = (): ThreadId => ThreadId.makeUnsafe(randomUUID());

export const newMessageId = (): MessageId => MessageId.makeUnsafe(randomUUID());

const isNonEmptyString = Predicate.compose(Predicate.isString, String.isNonEmpty);
const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return value;
    }
  }
  throw new Error("No non-empty string provided");
};

export const toHttpOrigin = (rawUrl: string): string => {
  const parsedUrl = new URL(rawUrl);
  if (parsedUrl.protocol === "wss:") {
    parsedUrl.protocol = "https:";
  } else if (parsedUrl.protocol === "ws:") {
    parsedUrl.protocol = "http:";
  }
  parsedUrl.pathname = "/";
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.origin;
};

export const resolveBackendHttpOrigin = (): string => {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return toHttpOrigin(
      firstNonEmptyString(
        readDesktopConnectionWsUrl(),
        import.meta.env.VITE_WS_URL,
        window.location.origin,
      ),
    );
  } catch {
    return window.location.origin;
  }
};

export const resolveAuthHttpOrigin = (): string => {
  if (typeof window === "undefined") {
    return "";
  }

  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return window.location.origin;
  }

  return resolveBackendHttpOrigin();
};

export const resolveServerUrl = (options?: {
  url?: string | undefined;
  protocol?: "http" | "https" | "ws" | "wss" | undefined;
  pathname?: string | undefined;
  searchParams?: Record<string, string> | undefined;
}): string => {
  const rawUrl = firstNonEmptyString(
    options?.url,
    readDesktopConnectionWsUrl(),
    import.meta.env.VITE_WS_URL,
    window.location.origin,
  );

  const parsedUrl = new URL(rawUrl);
  if (options?.protocol) {
    parsedUrl.protocol = options.protocol;
  }
  if (options?.pathname) {
    parsedUrl.pathname = options.pathname;
  } else {
    parsedUrl.pathname = "/";
  }
  if (options?.searchParams) {
    parsedUrl.search = new URLSearchParams(options.searchParams).toString();
  }
  return parsedUrl.toString();
};
