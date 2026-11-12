// One look at a time per thread, and no queue of looks. A look that is asked for while another is
// running does not wait behind it in a line: it marks the thread, and the running look goes round once
// more when it ends. However many events arrive during a look, the look runs at most twice.
import * as Effect from "effect/Effect";

export const makeThreadSingleFlight = <K, A, E>(look: (key: K) => Effect.Effect<A, E>) => {
  const running = new Set<K>();
  const again = new Set<K>();
  return (key: K): Effect.Effect<A | undefined, E> =>
    Effect.suspend(() => {
      if (running.has(key)) {
        again.add(key);
        return Effect.undefined;
      }
      running.add(key);
      const rounds = Effect.gen(function* () {
        let result: A;
        do {
          again.delete(key);
          result = yield* look(key);
        } while (again.has(key));
        return result;
      });
      return rounds.pipe(Effect.ensuring(Effect.sync(() => void running.delete(key))));
    });
};
