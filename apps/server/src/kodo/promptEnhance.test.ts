import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthSessionId,
  type AuthEnvironmentScope,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentKodoPromptEnhanceHttpApi,
  KodoPromptEnhanceError,
  type ModelSelection,
  TextGenerationError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { expect } from "vite-plus/test";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as KodoPromptEnhance from "./promptEnhance.ts";
import { promptEnhanceHttpApiLayer } from "./promptEnhanceHttp.ts";
import { buildPromptEnhancementPrompt } from "./promptEnhancePrompt.ts";

interface Call {
  readonly cwd: string;
  readonly prompt: string;
  readonly modelSelection: ModelSelection;
  readonly cwdExistedDuringCall: boolean;
}

const settings = Layer.mock(ServerSettings.ServerSettingsService)({
  getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
});

const textGeneration = (
  respond: () => Effect.Effect<{ transcription: string }, TextGenerationError>,
  calls: Call[],
) =>
  Layer.effect(
    TextGeneration.TextGeneration,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      return TextGeneration.TextGeneration.of({
        generateCommitMessage: () => Effect.die("not used"),
        generatePrContent: () => Effect.die("not used"),
        generateBranchName: () => Effect.die("not used"),
        generateThreadTitle: () => Effect.die("not used"),
        generateReviewGuide: () => Effect.die("not used"),
        generateTranscriptionPostProcessing: (input) =>
          Effect.gen(function* () {
            calls.push({
              ...input,
              cwdExistedDuringCall: yield* fileSystem.exists(input.cwd).pipe(Effect.orDie),
            });
            return yield* respond();
          }),
      });
    }),
  );

const enhanceWith = (
  respond: () => Effect.Effect<{ transcription: string }, TextGenerationError>,
  calls: Call[],
) =>
  KodoPromptEnhance.layer.pipe(
    Layer.provide(Layer.mergeAll(settings, textGeneration(respond, calls))),
    Layer.provide(NodeServices.layer),
  );

const draft = "fix the login bug in @src/auth.ts with [log](t3-context://v1/terminal/t_1)";

it.effect("rewrites the draft with the text generation model in a scratch directory", () => {
  const calls: Call[] = [];
  return Effect.gen(function* () {
    const service = yield* KodoPromptEnhance.KodoPromptEnhance;
    const result = yield* service.enhance({ prompt: draft });
    expect(result).toEqual({ prompt: "Fix the login bug." });
    const [call] = calls;
    expect(calls).toHaveLength(1);
    expect(call?.modelSelection).toEqual(DEFAULT_SERVER_SETTINGS.textGenerationModelSelection);
    expect(call?.prompt).toContain(`Draft prompt:\n${draft}`);
    expect(call?.prompt).toContain("preserve any @mentions");
    // Not a project checkout: a scratch directory that exists for the call and is gone after it.
    expect(call?.cwdExistedDuringCall).toBe(true);
    const fileSystem = yield* FileSystem.FileSystem;
    expect(yield* fileSystem.exists(call?.cwd ?? "")).toBe(false);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        enhanceWith(() => Effect.succeed({ transcription: "  Fix the login bug.\n" }), calls),
        NodeServices.layer,
      ),
    ),
  );
});

it.effect("calls no model for an empty draft", () => {
  const calls: Call[] = [];
  return Effect.gen(function* () {
    const service = yield* KodoPromptEnhance.KodoPromptEnhance;
    expect(yield* service.enhance({ prompt: " \n" })).toEqual({ prompt: " \n" });
    expect(calls).toEqual([]);
  }).pipe(Effect.provide(enhanceWith(() => Effect.die("not used"), calls)));
});

it.effect("names why generation failed and refuses an empty rewrite", () => {
  const calls: Call[] = [];
  let reply: ReturnType<Parameters<typeof enhanceWith>[0]> = Effect.fail(
    new TextGenerationError({
      operation: "generateTranscriptionPostProcessing",
      detail: "Codex is not signed in.",
    }),
  );
  return Effect.gen(function* () {
    const service = yield* KodoPromptEnhance.KodoPromptEnhance;
    const failed = yield* service.enhance({ prompt: draft }).pipe(Effect.flip);
    expect(failed).toBeInstanceOf(KodoPromptEnhanceError);
    expect(failed).toMatchObject({
      reason: "generation_failed",
      detail: "Codex is not signed in.",
    });
    reply = Effect.succeed({ transcription: "  \n" });
    const empty = yield* service.enhance({ prompt: draft }).pipe(Effect.flip);
    expect(empty).toMatchObject({ reason: "empty_result" });
  }).pipe(Effect.provide(enhanceWith(() => reply, calls)));
});

const decodeSessionId = Schema.decodeUnknownSync(AuthSessionId);

const principal = (...scopes: AuthEnvironmentScope[]) =>
  Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
    effect.pipe(
      Effect.provideService(EnvironmentAuthenticatedPrincipal, {
        sessionId: decodeSessionId("enhance-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes: new Set(scopes),
      }),
    ),
  );

it.effect("serves the endpoint to operators only and returns the failure reason", () =>
  Effect.gen(function* () {
    const calls: Call[] = [];
    const handlerFor = (...scopes: AuthEnvironmentScope[]) =>
      HttpRouter.toWebHandler(
        HttpApiBuilder.layer(
          HttpApi.make("environment").add(EnvironmentKodoPromptEnhanceHttpApi),
        ).pipe(
          Layer.provide(promptEnhanceHttpApiLayer),
          Layer.provide(principal(...scopes)),
          Layer.provide(settings),
          Layer.provide(
            textGeneration(
              () =>
                Effect.fail(
                  new TextGenerationError({
                    operation: "generateTranscriptionPostProcessing",
                    detail: "No provider is signed in.",
                  }),
                ),
              calls,
            ),
          ),
          // Before `layerServices`, whose file system is a stub.
          Layer.provide(NodeServices.layer),
          Layer.provide(HttpServer.layerServices),
        ),
        { disableLogger: true },
      );
    const context = yield* Layer.build(NodeServices.layer);
    const post = (handle: ReturnType<typeof handlerFor>["handler"]) =>
      Effect.promise(() =>
        handle(
          new Request("http://localhost/api/kodo/prompt-enhance", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt: draft }),
          }),
          context,
        ),
      );
    const reader = handlerFor(AuthOrchestrationReadScope);
    const operator = handlerFor(AuthOrchestrationOperateScope);
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => Promise.all([reader.dispose(), operator.dispose()])),
    );
    expect((yield* post(reader.handler)).status).toBe(403);
    expect(calls).toEqual([]);
    const failed = yield* post(operator.handler);
    expect(failed.status).toBe(502);
    expect(yield* Effect.promise(() => failed.json())).toMatchObject({
      _tag: "KodoPromptEnhanceError",
      reason: "generation_failed",
      detail: "No provider is signed in.",
    });
  }).pipe(Effect.scoped),
);

it("shapes the rewrite by the thread's mode, and reads an absent or unknown mode as code", () => {
  const notes = {
    ask: "keep the draft a question about the codebase",
    plan: "phrase the draft as a request for a plan",
    review: "phrase the draft as a request to review the working changes",
  } as const;
  const code = buildPromptEnhancementPrompt(draft, "code");
  expect(code).toContain("stronger execution intent");
  for (const unknown of [undefined, "swarm", 7, "default"]) {
    expect(buildPromptEnhancementPrompt(draft, unknown)).toBe(code);
  }
  for (const [mode, note] of Object.entries(notes)) {
    const prompt = buildPromptEnhancementPrompt(draft, mode);
    expect(prompt).toContain(note);
    // A read-only mode must not be told to add execution intent.
    expect(prompt).not.toContain("stronger execution intent");
  }
  // Every mode is told to rewrite, never answer, and to keep references.
  for (const mode of ["ask", "plan", "code", "review"]) {
    expect(buildPromptEnhancementPrompt(draft, mode)).toContain("never answer it");
    expect(buildPromptEnhancementPrompt(draft, mode)).toContain(`Draft prompt:\n${draft}`);
  }
});

it.effect("sends the mode the client named to the model", () => {
  const calls: Call[] = [];
  return Effect.gen(function* () {
    const service = yield* KodoPromptEnhance.KodoPromptEnhance;
    yield* service.enhance({ prompt: draft, interactionMode: "ask" });
    expect(calls[0]?.prompt).toContain("Ask mode");
  }).pipe(
    Effect.provide(enhanceWith(() => Effect.succeed({ transcription: "A question?" }), calls)),
  );
});
