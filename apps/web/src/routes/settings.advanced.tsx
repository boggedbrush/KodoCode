import { createFileRoute } from "@tanstack/react-router";

import { SettingsAdvancedPanel } from "../components/settings/SettingsAdvancedPanel";

export const Route = createFileRoute("/settings/advanced")({
  component: SettingsAdvancedPanel,
});
