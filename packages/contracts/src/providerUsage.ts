import { Schema } from "effect";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind, ProviderStartOptions } from "./orchestration";

export const ProviderUsageState = Schema.Literals([
  "ready",
  "limited",
  "exhausted",
  "unknown",
  "error",
]);
export type ProviderUsageState = typeof ProviderUsageState.Type;

export const ProviderUsageSource = Schema.Literals(["poll", "runtime"]);
export type ProviderUsageSource = typeof ProviderUsageSource.Type;

export const ServerProviderUsageWindow = Schema.Struct({
  key: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  usedText: Schema.optional(TrimmedNonEmptyString),
  limitText: Schema.optional(TrimmedNonEmptyString),
  remainingText: Schema.optional(TrimmedNonEmptyString),
  percentUsed: Schema.NullOr(Schema.Number),
  resetAt: Schema.NullOr(IsoDateTime),
});
export type ServerProviderUsageWindow = typeof ServerProviderUsageWindow.Type;

export const ServerProviderUsageIdentity = Schema.Struct({
  planName: Schema.NullOr(TrimmedNonEmptyString),
  loginMethod: Schema.NullOr(TrimmedNonEmptyString),
  email: Schema.NullOr(TrimmedNonEmptyString),
  org: Schema.NullOr(TrimmedNonEmptyString),
});
export type ServerProviderUsageIdentity = typeof ServerProviderUsageIdentity.Type;

export const ServerProviderUsage = Schema.Struct({
  provider: ProviderKind,
  status: ProviderUsageState,
  source: ProviderUsageSource,
  checkedAt: IsoDateTime,
  stale: Schema.Boolean,
  summary: Schema.NullOr(TrimmedNonEmptyString),
  detail: Schema.NullOr(TrimmedNonEmptyString),
  resetAt: Schema.NullOr(IsoDateTime),
  identity: ServerProviderUsageIdentity,
  windows: Schema.Array(ServerProviderUsageWindow),
});
export type ServerProviderUsage = typeof ServerProviderUsage.Type;

export const ServerProviderUsages = Schema.Array(ServerProviderUsage);
export type ServerProviderUsages = typeof ServerProviderUsages.Type;

export const ProviderUsageStatusInput = Schema.Struct({
  providerOptions: Schema.optional(ProviderStartOptions),
});
export type ProviderUsageStatusInput = typeof ProviderUsageStatusInput.Type;
