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

/**
 * Reads any stored or incoming value as one of the four Kodo modes. Legacy `"default"` is code;
 * anything unknown (an absent value, a retired mode such as `"swarm"`, junk) also degrades to
 * code rather than failing a session or a projection replay.
 */
export const normalizeKodoInteractionMode = (value: unknown): KodoInteractionMode =>
  isKodoInteractionMode(value) ? value : DEFAULT_KODO_INTERACTION_MODE;

const decodeThreadInteractionMode = (
  value: string,
): ProviderInteractionMode | KodoInteractionMode =>
  value === "default" ? value : normalizeKodoInteractionMode(value);

/**
 * A thread's interaction mode field. A stored `"default"` decodes unchanged so caches and
 * snapshots round-trip losslessly; read it with `normalizeKodoInteractionMode`, which maps it to
 * code. Any other unknown string (such as a retired `"swarm"`) decodes to `"code"`.
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
