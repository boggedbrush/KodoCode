import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { INTERACTION_MODE_ACCENT_COLORS } from "../modeColors";
import { shouldAutoExpandPlanMarkdown } from "./planSidebar.logic";
import type { ActivePlanState, LatestProposedPlanState } from "../session-logic";

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

describe("PlanSidebar", () => {
  it("auto-expands only when there is a single proposed plan and no active plan", () => {
    expect(shouldAutoExpandPlanMarkdown(null, null)).toBe(false);
    expect(
      shouldAutoExpandPlanMarkdown(
        {
          createdAt: "2026-04-08T12:00:00.000Z",
          turnId: null,
          explanation: null,
          steps: [],
        } satisfies ActivePlanState,
        null,
      ),
    ).toBe(false);
    expect(
      shouldAutoExpandPlanMarkdown(
        null,
        {
          id: "plan-1",
          createdAt: "2026-04-08T12:00:00.000Z",
          updatedAt: "2026-04-08T12:00:00.000Z",
          turnId: null,
          planMarkdown: "# One plan",
          implementedAt: null,
          implementationThreadId: null,
        } satisfies LatestProposedPlanState,
      ),
    ).toBe(true);
  });

  it("renders the header badge with the plan accent color", async () => {
    const { default: PlanSidebar } = await import("./PlanSidebar");
    const markup = renderToStaticMarkup(
      <PlanSidebar
        activePlan={null}
        activeProposedPlan={null}
        markdownCwd={undefined}
        workspaceRoot={undefined}
        timestampFormat="locale"
        onClose={() => {}}
      />,
    );

    expect(markup).toContain(`background-color:rgba(200, 149, 74, 0.1)`);
    expect(markup).toContain(`color:${INTERACTION_MODE_ACCENT_COLORS.plan}`);
  });

  it("renders in-progress step styling with the plan accent color", async () => {
    const { default: PlanSidebar } = await import("./PlanSidebar");
    const markup = renderToStaticMarkup(
      <PlanSidebar
        activePlan={{
          createdAt: "2026-04-08T12:00:00.000Z",
          turnId: null,
          explanation: null,
          steps: [
            {
              step: "Refresh plan chrome",
              status: "inProgress",
            },
          ],
        }}
        activeProposedPlan={null}
        markdownCwd={undefined}
        workspaceRoot={undefined}
        timestampFormat="locale"
        onClose={() => {}}
      />,
    );

    expect(markup).toContain(`background-color:rgba(200, 149, 74, 0.05)`);
    expect(markup).toContain(`background-color:rgba(200, 149, 74, 0.15)`);
    expect(markup).toContain(`color:${INTERACTION_MODE_ACCENT_COLORS.plan}`);
  });
});
