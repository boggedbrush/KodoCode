// Kodo thread-level interaction mode. Adapters keep receiving upstream's "default" | "plan"; the
// server resolves these four modes into that (apps/server/src/kodo/interactionMode.ts).
// code = upstream default, plan = upstream plan, ask / review = read-only.
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ProviderInteractionMode } from "./providerPolicy.ts";

export const KODO_INTERACTION_MODES = ["ask", "plan", "code", "review"] as const;

export const KodoInteractionMode = Schema.Literals(KODO_INTERACTION_MODES);
export type KodoInteractionMode = typeof KodoInteractionMode.Type;

export const DEFAULT_KODO_INTERACTION_MODE: KodoInteractionMode = "code";

const isKodoInteractionMode = Schema.is(KodoInteractionMode);

/** Stored values written by earlier builds that mean code: upstream's default and Kodo's retired swarm. */
const LEGACY_CODE_MODES: ReadonlySet<string> = new Set(["default", "swarm"]);

/**
 * Reads any stored or incoming value as one of the four Kodo modes. An absent value, upstream's
 * `"default"` and Kodo's retired `"swarm"` are code. Any other string is a mode this build does not
 * know (a future or foreign value), so it fails closed to ask rather than gaining write access;
 * nothing fails a session or a projection replay.
 */
export const normalizeKodoInteractionMode = (value: unknown): KodoInteractionMode =>
  isKodoInteractionMode(value)
    ? value
    : typeof value === "string" && !LEGACY_CODE_MODES.has(value)
      ? "ask"
      : DEFAULT_KODO_INTERACTION_MODE;

const decodeThreadInteractionMode = (
  value: string,
): ProviderInteractionMode | KodoInteractionMode =>
  value === "default" ? value : normalizeKodoInteractionMode(value);

/**
 * A thread's interaction mode field. A stored `"default"` decodes unchanged so caches and
 * snapshots round-trip losslessly; read it with `normalizeKodoInteractionMode`, which maps it to
 * code, as does a retired `"swarm"`. Any other unknown string decodes to `"ask"` (fail closed).
 */
export const ThreadInteractionMode = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Union([ProviderInteractionMode, KodoInteractionMode]),
    SchemaTransformation.transform<ProviderInteractionMode | KodoInteractionMode, string>({
      decode: decodeThreadInteractionMode,
      encode: (mode) => mode,
    }),
  ),
);
export type ThreadInteractionMode = typeof ThreadInteractionMode.Type;
