import { describe, expect, it } from "@effect/vitest";

import { BUILT_IN_DRIVERS } from "../provider/builtInDrivers.ts";
import { ENFORCEMENT_BY_DRIVER } from "./interactionMode.ts";

// KODO: mode-enforcement-table - a provider added by an upstream merge must be classified on purpose.
describe("read-only enforcement table", () => {
  it("has an explicit entry for every registered provider driver", () => {
    const registered = BUILT_IN_DRIVERS.map((driver) => String(driver.driverKind)).toSorted();
    expect(registered.length).toBeGreaterThan(0);
    const missing = registered.filter((driver) => ENFORCEMENT_BY_DRIVER[driver] === undefined);
    expect(
      missing,
      `Add ${missing.join(", ")} to ENFORCEMENT_BY_DRIVER (apps/server/src/kodo/interactionMode.ts). A driver with no entry gets the weakest enforcement.`,
    ).toEqual([]);
  });
});
