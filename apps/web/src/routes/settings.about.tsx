import { createFileRoute } from "@tanstack/react-router";

import { SettingsAboutPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/about")({
  component: SettingsAboutPanel,
});
