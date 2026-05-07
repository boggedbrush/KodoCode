import { createFileRoute } from "@tanstack/react-router";

import { GeneralSettingsPanel } from "../components/settings/SettingsGeneralPanel";

export const Route = createFileRoute("/settings/general")({
  component: GeneralSettingsPanel,
});
