import { describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { buildLegacyClientSettingsMigrationPatch } from "./useSettings";

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("defaults the project picker to fullscreen", () => {
    expect(DEFAULT_CLIENT_SETTINGS.projectPickerMode).toBe("fullscreen");
  });

  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        confirmThreadArchive: true,
        confirmThreadDelete: false,
      }),
    ).toEqual({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
    });
  });

  it("migrates the project picker preference from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        projectPickerMode: "sidebar",
      }),
    ).toEqual({
      projectPickerMode: "sidebar",
    });
  });
});
