// FILE: whatsNew/entries.ts
// Purpose: Curated "What's new" changelog rendered in the post-update dialog
// and the settings Release history view.
// Layer: static data consumed by `useWhatsNew`, `WhatsNewDialog`, and
// `ChangelogAccordion`.

import type { WhatsNewEntry } from "./logic";

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  {
    version: "0.0.2",
    date: "2026-04-20",
    features: [
      {
        id: "dpcode-sync-overlay",
        title: "Kodo overlay restored",
        description:
          "Kōdō Code is back on top of the synced DPCode base, with product metadata, release history, and desktop branding retargeted to Kōdō.",
      },
      {
        id: "desktop-titlebar-return",
        title: "Custom Linux and Windows titlebar",
        description:
          "The Kodo desktop frame is restored on Linux and Windows while keeping the synced desktop shell structure intact for future upstream cherry-picks.",
      },
      {
        id: "usage-settings-return",
        title: "Usage is back in Settings",
        description:
          "Settings once again includes a Usage view for Codex and Claude, with refreshable account status and active usage windows.",
      },
    ],
  },
  {
    version: "0.0.1",
    date: "2026-04-18",
    features: [
      {
        id: "desktop-packaging-foundation",
        title: "Desktop packaging foundation",
        description:
          "Packaged desktop builds, update plumbing, and branded app assets were stabilized so Kodo can ship as a native app.",
      },
      {
        id: "provider-and-model-controls",
        title: "Provider and model controls",
        description:
          "Kodo added provider-aware model defaults, custom binary path settings, and workflow controls for Codex, Claude, and Gemini.",
      },
    ],
  },
  {
    version: "0.0.0",
    date: "2026-04-10",
    features: [
      {
        id: "initial-kodo-foundation",
        title: "Initial Kodo foundation",
        description:
          "The first Kōdō Code release established the minimal desktop and web shell for working with coding agents in a single app.",
      },
    ],
  },
];
