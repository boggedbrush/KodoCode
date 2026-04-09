import { createFileRoute } from "@tanstack/react-router";

import { SettingsAppearancePanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/appearance")({
  component: SettingsAppearancePanel,
});
