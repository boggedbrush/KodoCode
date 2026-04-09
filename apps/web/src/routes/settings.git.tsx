import { createFileRoute } from "@tanstack/react-router";

import { SettingsGitPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/git")({
  component: SettingsGitPanel,
});
