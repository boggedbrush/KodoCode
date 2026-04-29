import {
  type ProviderKind,
  type ResolvedKeybindingsConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { COMPOSER_AUTO_MODEL_VALUE, ProviderModelPicker } from "./ProviderModelPicker";
import { getCustomModelOptionsByProvider } from "../../modelSelection";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

function effort(value: string, isDefault = false) {
  return {
    value,
    label: value,
    ...(isDefault ? { isDefault: true } : {}),
  };
}

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
          supportsFastMode: true,
          supportsThinkingToggle: false,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
          supportsFastMode: true,
          supportsThinkingToggle: false,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
  {
    provider: "claudeAgent",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [
            effort("low"),
            effort("medium", true),
            effort("high"),
            effort("max"),
          ],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [
            effort("low"),
            effort("medium", true),
            effort("high"),
            effort("max"),
          ],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
];

async function mountPicker(props: {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  keybindings?: ResolvedKeybindingsConfig;
  triggerVariant?: "ghost" | "outline";
  includeAutoModel?: boolean;
  showAsAuto?: boolean;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onProviderModelChange = vi.fn();
  const providers = props.providers ?? TEST_PROVIDERS;
  const modelOptionsByProvider = getCustomModelOptionsByProvider(
    DEFAULT_UNIFIED_SETTINGS,
    providers,
    props.provider,
    props.model,
  );
  const screen = await render(
    <ProviderModelPicker
      provider={props.provider}
      model={props.model}
      lockedProvider={props.lockedProvider}
      providers={providers}
      modelOptionsByProvider={modelOptionsByProvider}
      {...(props.keybindings ? { keybindings: props.keybindings } : {})}
      {...(props.includeAutoModel !== undefined
        ? { includeAutoModel: props.includeAutoModel }
        : {})}
      {...(props.showAsAuto !== undefined ? { showAsAuto: props.showAsAuto } : {})}
      triggerVariant={props.triggerVariant}
      onProviderModelChange={onProviderModelChange}
    />,
    { container: host },
  );

  return {
    onProviderModelChange,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

function getModelPickerListElement() {
  const modelPickerList = document.querySelector<HTMLElement>(".model-picker-list");
  expect(modelPickerList).not.toBeNull();
  return modelPickerList!;
}

function getVisibleModelNames() {
  return Array.from(
    getModelPickerListElement().querySelectorAll<HTMLElement>('[data-slot="combobox-item"]'),
  )
    .map((element) => element.textContent?.replace(/New$/u, "").trim() ?? "")
    .filter((text) => text.length > 0);
}

function getSidebarProviderOrder() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-model-picker-provider]")).map(
    (element) => element.dataset.modelPickerProvider ?? "",
  );
}

function clickComboboxItem(label: string) {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="combobox-item"]'),
  ).find((element) => element.textContent?.includes(label));
  expect(item).toBeTruthy();
  item?.click();
}

describe("ProviderModelPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows provider sidebar in unlocked mode", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getSidebarProviderOrder().slice(0, 3)).toEqual([
          "favorites",
          "codex",
          "claudeAgent",
        ]);
        expect(getVisibleModelNames().some((name) => name.includes("Auto"))).toBe(true);
        expect(getVisibleModelNames().some((name) => name.includes("Claude Sonnet 4.6"))).toBe(
          true,
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows models directly when the provider is locked mid-thread", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: "claudeAgent",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(document.querySelectorAll("[data-model-picker-provider]").length).toBe(0);
        expect(getVisibleModelNames().some((name) => name.includes("Claude Sonnet 4.6"))).toBe(
          true,
        );
        expect(getVisibleModelNames().some((name) => name.includes("GPT-5 Codex"))).toBe(false);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("filters models with search", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();
      await vi.waitFor(() => {
        expect(document.querySelector(".model-picker-list")).not.toBeNull();
      });

      await userEvent.fill(page.getByPlaceholder("Search models..."), "sonnet");

      await vi.waitFor(() => {
        const listText = getModelPickerListElement().textContent ?? "";
        expect(listText).toContain("Claude Sonnet 4.6");
        expect(listText).not.toContain("Claude Opus 4.6");
        expect(listText).not.toContain("Claude Haiku 4.5");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("dispatches Auto when selected", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: "claudeAgent",
    });

    try {
      await page.getByRole("button").click();
      await vi.waitFor(() => {
        expect(document.querySelector(".model-picker-list")).not.toBeNull();
      });

      clickComboboxItem("Auto");
      expect(mounted.onProviderModelChange).toHaveBeenCalledWith(
        "claudeAgent",
        COMPOSER_AUTO_MODEL_VALUE,
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("hides Auto when auto model selection is disabled", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: "claudeAgent",
      includeAutoModel: false,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getVisibleModelNames().some((name) => name.includes("Auto"))).toBe(false);
        expect(getVisibleModelNames().some((name) => name.includes("Claude Sonnet 4.6"))).toBe(
          true,
        );
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows jump shortcut labels when keybindings are provided", async () => {
    const mounted = await mountPicker({
      provider: "codex",
      model: "gpt-5-codex",
      lockedProvider: "codex",
      keybindings: [
        {
          command: "modelPicker.jump.1",
          shortcut: {
            key: "1",
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            modKey: true,
          },
          whenAst: { type: "identifier", name: "modelPickerOpen" },
        },
      ],
    });

    try {
      await page.getByRole("button").click();
      const jumpLabel = navigator.platform.includes("Mac") ? "⌘1" : "Ctrl+1";

      await vi.waitFor(() => {
        expect(
          Array.from(
            document.querySelectorAll<HTMLElement>('.model-picker-list [data-slot="kbd"]'),
          ).some((element) => element.textContent?.trim() === jumpLabel),
        ).toBe(true);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("accepts outline trigger styling", async () => {
    const mounted = await mountPicker({
      provider: "codex",
      model: "gpt-5-codex",
      lockedProvider: null,
      triggerVariant: "outline",
    });

    try {
      const button = document.querySelector("button");
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Expected picker trigger button to be rendered.");
      }
      expect(button.className).toContain("border-input");
      expect(button.className).toContain("bg-popover");
    } finally {
      await mounted.cleanup();
    }
  });
});
