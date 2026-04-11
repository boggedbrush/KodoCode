import { Duration, Effect } from "effect";

export type RefreshFrequency = "manual" | "1m" | "2m" | "5m" | "15m" | "30m";

export const REFRESH_MS: Record<Exclude<RefreshFrequency, "manual">, number> = {
  "1m": 60_000,
  "2m": 120_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
};

export const startUsagePollingController = Effect.fn("startUsagePollingController")(
  function* (input: {
    readonly refresh: Effect.Effect<void>;
    readonly frequency: RefreshFrequency;
  }) {
    if (input.frequency === "manual") {
      return;
    }

    const interval = REFRESH_MS[input.frequency];
    yield* Effect.forever(
      Effect.sleep(Duration.millis(interval)).pipe(
        Effect.andThen(input.refresh),
        Effect.ignoreCause({ log: true }),
      ),
    ).pipe(Effect.forkScoped);
  },
);
