import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { INTERACTION_MODE_ACCENT_COLORS } from "../../modeColors";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

describe("ComposerPrimaryActions", () => {
  it("renders the plan follow-up Refine button with the plan accent color", () => {
    const markup = renderToStaticMarkup(
      <ComposerPrimaryActions
        compact={false}
        accentColor="#5236CC"
        pendingAction={null}
        isRunning={false}
        showPlanFollowUpPrompt
        promptHasText
        isSendBusy={false}
        isConnecting={false}
        isPreparingWorktree={false}
        hasSendableContent={true}
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
        onImplementPlanInNewThread={() => {}}
      />,
    );

    expect(markup).toContain("Refine");
    expect(markup).toContain(`background-color:${INTERACTION_MODE_ACCENT_COLORS.plan}`);
    expect(markup).toContain(`border-color:${INTERACTION_MODE_ACCENT_COLORS.plan}`);
  });
});
