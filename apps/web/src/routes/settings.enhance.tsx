import { createFileRoute } from "@tanstack/react-router";

import { SettingsEnhancePanel } from "../components/settings/SettingsEnhancePanel";

export const Route = createFileRoute("/settings/enhance")({
  component: SettingsEnhancePanel,
});
