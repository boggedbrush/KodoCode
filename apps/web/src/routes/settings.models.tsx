import { createFileRoute } from "@tanstack/react-router";

import { SettingsModelsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/models")({
  component: SettingsModelsPanel,
});
