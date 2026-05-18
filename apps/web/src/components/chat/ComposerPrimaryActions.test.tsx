import { renderToStaticMarkup } from "react-dom/server";
import { ProviderInteractionMode } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { INTERACTION_MODE_ACCENT_COLORS } from "../../modeColors";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

describe("ComposerPrimaryActions", () => {
  it("renders the plan follow-up Refine button with the plan accent color", () => {
    const markup = renderToStaticMarkup(
      <ComposerPrimaryActions
        compact={false}
        accentColor="#5236CC"
        pendingActionAccentColor="#5236CC"
        pendingAction={null}
        isRunning={false}
        showPlanFollowUpPrompt
        promptHasText
        isSendBusy={false}
        isConnecting={false}
        isPreparingWorktree={false}
        hasSendableContent={true}
        interactionMode={"default" as ProviderInteractionMode}
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
        onImplementPlanInNewThread={() => {}}
      />,
    );

    expect(markup).toContain("Refine");
    expect(markup).toContain(`background-color:${INTERACTION_MODE_ACCENT_COLORS.plan}`);
    expect(markup).toContain(`border-color:${INTERACTION_MODE_ACCENT_COLORS.plan}`);
  });

  it("renders pending-question submit buttons with the provided accent color", () => {
    const markup = renderToStaticMarkup(
      <ComposerPrimaryActions
        compact={false}
        accentColor="#5236CC"
        pendingActionAccentColor={INTERACTION_MODE_ACCENT_COLORS.plan}
        pendingAction={{
          questionIndex: 1,
          isLastQuestion: true,
          canAdvance: true,
          isResponding: false,
          isComplete: true,
        }}
        isRunning={false}
        showPlanFollowUpPrompt={false}
        promptHasText={false}
        isSendBusy={false}
        isConnecting={false}
        isPreparingWorktree={false}
        hasSendableContent={true}
        interactionMode={"default" as ProviderInteractionMode}
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
        onImplementPlanInNewThread={() => {}}
      />,
    );

    expect(markup).toContain("Submit answers");
    expect(markup).toContain(`background-color:${INTERACTION_MODE_ACCENT_COLORS.plan}`);
    expect(markup).toContain(`border-color:${INTERACTION_MODE_ACCENT_COLORS.plan}`);
  });

  it("renders an Add Details button when review mode has typed content", () => {
    const markup = renderToStaticMarkup(
      <ComposerPrimaryActions
        compact={false}
        accentColor={INTERACTION_MODE_ACCENT_COLORS.review}
        pendingActionAccentColor={INTERACTION_MODE_ACCENT_COLORS.review}
        pendingAction={null}
        isRunning={false}
        showPlanFollowUpPrompt={false}
        promptHasText={true}
        isSendBusy={false}
        isConnecting={false}
        isPreparingWorktree={false}
        hasSendableContent={true}
        interactionMode={"review" as ProviderInteractionMode}
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
        onImplementPlanInNewThread={() => {}}
      />,
    );

    expect(markup).toContain(">Add Details<");
  });

  it("renders the standard icon button when swarm mode is selected", () => {
    const markup = renderToStaticMarkup(
      <ComposerPrimaryActions
        compact={false}
        accentColor={INTERACTION_MODE_ACCENT_COLORS.swarm}
        pendingActionAccentColor={INTERACTION_MODE_ACCENT_COLORS.swarm}
        pendingAction={null}
        isRunning={false}
        showPlanFollowUpPrompt={false}
        promptHasText={false}
        isSendBusy={false}
        isConnecting={false}
        isPreparingWorktree={false}
        hasSendableContent={true}
        interactionMode={"swarm" as ProviderInteractionMode}
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
        onImplementPlanInNewThread={() => {}}
      />,
    );

    expect(markup).toContain('viewBox="0 0 14 14"');
    expect(markup).not.toContain(">Swarm<");
  });
});
