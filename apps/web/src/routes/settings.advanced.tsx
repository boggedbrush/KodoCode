import { createFileRoute } from "@tanstack/react-router";

import { SettingsAdvancedPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/advanced")({
  component: SettingsAdvancedPanel,
});
