/**
 * Where this distribution's analytics go. There is no default: upstream's PostHog key and
 * ingest host must never receive a fork user's usage data, so telemetry stays off until an
 * operator supplies both values, at build time (`KODO_POSTHOG_KEY`, `KODO_POSTHOG_HOST` when
 * building the server) or at run time (`T3CODE_POSTHOG_KEY`, `T3CODE_POSTHOG_HOST`).
 */
declare const __KODO_BUILD_POSTHOG_KEY__: string | undefined;
declare const __KODO_BUILD_POSTHOG_HOST__: string | undefined;

export const KODO_BUILD_POSTHOG_KEY =
  typeof __KODO_BUILD_POSTHOG_KEY__ === "undefined" ? "" : __KODO_BUILD_POSTHOG_KEY__.trim();
export const KODO_BUILD_POSTHOG_HOST =
  typeof __KODO_BUILD_POSTHOG_HOST__ === "undefined" ? "" : __KODO_BUILD_POSTHOG_HOST__.trim();

/** Delivery needs both halves; a key without a host (or the reverse) sends nothing. */
export const isTelemetryEndpointConfigured = (endpoint: {
  readonly key: string;
  readonly host: string;
}) => endpoint.key.trim() !== "" && endpoint.host.trim() !== "";
