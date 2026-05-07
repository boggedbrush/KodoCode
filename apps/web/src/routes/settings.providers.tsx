import { createFileRoute } from "@tanstack/react-router";

import { SettingsProvidersPanel } from "../components/settings/SettingsProvidersPanel";

export const Route = createFileRoute("/settings/providers")({
  component: SettingsProvidersPanel,
});
