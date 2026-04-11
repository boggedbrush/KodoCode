import { Schema } from "effect";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

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

export const ServerProviderUsageUpdatedPayload = Schema.Struct({
  usages: ServerProviderUsages,
});
export type ServerProviderUsageUpdatedPayload = typeof ServerProviderUsageUpdatedPayload.Type;

export const ServerUsageStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  usages: ServerProviderUsages,
});
export type ServerUsageStreamSnapshotEvent = typeof ServerUsageStreamSnapshotEvent.Type;

export const ServerUsageStreamUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("updated"),
  payload: ServerProviderUsageUpdatedPayload,
});
export type ServerUsageStreamUpdatedEvent = typeof ServerUsageStreamUpdatedEvent.Type;

export const ServerUsageStreamEvent = Schema.Union([
  ServerUsageStreamSnapshotEvent,
  ServerUsageStreamUpdatedEvent,
]);
export type ServerUsageStreamEvent = typeof ServerUsageStreamEvent.Type;
