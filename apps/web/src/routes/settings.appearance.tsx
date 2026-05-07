import { createFileRoute } from "@tanstack/react-router";

import { SettingsAppearancePanel } from "../components/settings/SettingsAppearancePanel";

export const Route = createFileRoute("/settings/appearance")({
  component: SettingsAppearancePanel,
});
