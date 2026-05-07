import { createFileRoute } from "@tanstack/react-router";

import { SettingsAboutPanel } from "../components/settings/SettingsAboutPanel";

export const Route = createFileRoute("/settings/about")({
  component: SettingsAboutPanel,
});
