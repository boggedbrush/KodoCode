import { createFileRoute } from "@tanstack/react-router";

import { SettingsEnhancePanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/enhance")({
  component: SettingsEnhancePanel,
});
