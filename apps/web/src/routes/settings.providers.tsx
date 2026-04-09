import { createFileRoute } from "@tanstack/react-router";

import { SettingsProvidersPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/providers")({
  component: SettingsProvidersPanel,
});
