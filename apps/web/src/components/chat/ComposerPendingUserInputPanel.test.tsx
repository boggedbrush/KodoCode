import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { INTERACTION_MODE_ACCENT_COLORS } from "../../modeColors";
import type { PendingUserInput } from "../../session-logic";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";

const pendingUserInputs: PendingUserInput[] = [
  {
    requestId: "request-1" as PendingUserInput["requestId"],
    createdAt: "2026-04-07T12:00:00.000Z",
    questions: [
      {
        id: "scope",
        header: "Scope",
        question: "What should this change cover?",
        options: [
          {
            label: "Tight",
            description: "Touch only the footer layout logic.",
          },
          {
            label: "Broad",
            description: "Also adjust the related composer controls.",
          },
        ],
        multiSelect: false,
      },
    ],
  },
];

const multiSelectPendingUserInputs: PendingUserInput[] = [
  {
    requestId: "request-2" as PendingUserInput["requestId"],
    questions: [
      {
        id: "areas",
        header: "Areas",
        question: "Which areas should this change cover?",
        options: [
          {
            label: "Server",
            description: "Touch server orchestration.",
          },
          {
            label: "Web",
            description: "Touch the browser UI.",
          },
        ],
        multiSelect: true,
      },
    ],
    createdAt: "2026-04-07T12:00:00.000Z",
  },
];

describe("ComposerPendingUserInputPanel", () => {
  it("renders selected options with the provided accent color", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingUserInputPanel
        pendingUserInputs={pendingUserInputs}
        respondingRequestIds={[]}
        accentColor={INTERACTION_MODE_ACCENT_COLORS.plan}
        answers={{
          scope: {
            selectedOptionLabels: ["Tight"],
          },
        }}
        questionIndex={0}
        onToggleOption={() => {}}
        onAdvance={() => {}}
      />,
    );

    expect(markup).toContain("What should this change cover?");
    expect(markup).toContain("rgba(200, 149, 74, 0.4)");
    expect(markup).toContain("rgba(200, 149, 74, 0.08)");
    expect(markup).toContain("rgba(200, 149, 74, 0.2)");
    expect(markup).toContain(`color:${INTERACTION_MODE_ACCENT_COLORS.plan}`);
  });

  it("keeps unselected options on the neutral styling path", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingUserInputPanel
        pendingUserInputs={pendingUserInputs}
        respondingRequestIds={[]}
        accentColor={INTERACTION_MODE_ACCENT_COLORS.plan}
        answers={{}}
        questionIndex={0}
        onToggleOption={() => {}}
        onAdvance={() => {}}
      />,
    );

    expect(markup).toContain("border-transparent");
    expect(markup).not.toContain("rgba(200, 149, 74, 0.4)");
    expect(markup).not.toContain("rgba(200, 149, 74, 0.08)");
    expect(markup).not.toContain("rgba(200, 149, 74, 0.2)");
    expect(markup).not.toContain(`color:${INTERACTION_MODE_ACCENT_COLORS.plan}`);
  });

  it("renders multi-select selections with the provided accent color", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingUserInputPanel
        pendingUserInputs={multiSelectPendingUserInputs}
        respondingRequestIds={[]}
        accentColor={INTERACTION_MODE_ACCENT_COLORS.plan}
        answers={{
          areas: {
            selectedOptionLabels: ["Server", "Web"],
          },
        }}
        questionIndex={0}
        onToggleOption={() => {}}
        onAdvance={() => {}}
      />,
    );

    expect(markup).toContain("Select one or more options.");
    expect(markup).toContain("rgba(200, 149, 74, 0.4)");
    expect(markup).toContain("rgba(200, 149, 74, 0.08)");
    expect(markup).toContain("rgba(200, 149, 74, 0.2)");
  });
});
