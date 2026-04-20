import { describe, expect, it } from "vitest";

import { buildModelPickerSearchText, scoreModelPickerSearch } from "./modelPickerSearch";

describe("buildModelPickerSearchText", () => {
  it("builds provider-aware search text from generic fields", () => {
    expect(
      buildModelPickerSearchText({
        provider: "claudeAgent",
        name: "Claude Opus 4.6",
        subProvider: "Anthropic",
      }),
    ).toBe("claude opus 4.6 anthropic claudeagent claude");
  });
});

describe("scoreModelPickerSearch", () => {
  it("matches typo-tolerant multi-token queries", () => {
    expect(
      scoreModelPickerSearch(
        {
          provider: "claudeAgent",
          name: "Claude Opus 4.6",
          subProvider: "Anthropic",
        },
        "anthr opu",
      ),
    ).not.toBeNull();
  });

  it("rejects results when any query token does not match", () => {
    expect(
      scoreModelPickerSearch(
        {
          provider: "codex",
          name: "GPT-5 Codex",
        },
        "anthr opu",
      ),
    ).toBeNull();
  });

  it("ranks exact token matches ahead of fuzzier matches", () => {
    const exactScore = scoreModelPickerSearch(
      {
        provider: "claudeAgent",
        name: "Claude Opus 4.6",
      },
      "opus claude",
    );
    const fuzzyScore = scoreModelPickerSearch(
      {
        provider: "claudeAgent",
        name: "Claude Opus 4.6",
      },
      "opu clde",
    );

    expect(exactScore).not.toBeNull();
    expect(fuzzyScore).not.toBeNull();
    expect(exactScore!).toBeLessThan(fuzzyScore!);
  });

  it("gives favorite models a ranking boost for partial queries", () => {
    const favoriteScore = scoreModelPickerSearch(
      {
        provider: "claudeAgent",
        name: "Claude Opus 4.6",
        isFavorite: true,
      },
      "opu",
    );
    const nonFavoriteScore = scoreModelPickerSearch(
      {
        provider: "codex",
        name: "Opus-compatible",
      },
      "opu",
    );

    expect(favoriteScore).not.toBeNull();
    expect(nonFavoriteScore).not.toBeNull();
    expect(favoriteScore!).toBeLessThan(nonFavoriteScore!);
  });
});
