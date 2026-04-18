import { createFileRoute } from "@tanstack/react-router";

import { SettingsUsagePanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/usage")({
  component: SettingsUsagePanel,
});
