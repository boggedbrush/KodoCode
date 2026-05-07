import { createFileRoute } from "@tanstack/react-router";

import { SettingsGitPanel } from "../components/settings/SettingsGitPanel";

export const Route = createFileRoute("/settings/git")({
  component: SettingsGitPanel,
});
