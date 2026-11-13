import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { KodoWindowControls } from "./kodo/KodoWindowControls"; // KODO: window-controls
import { KodoShortcutsDialog } from "./kodo/KodoShortcutsDialog"; // KODO: shortcuts-window
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

// Keep webviews outside the router but inside its atom registry so route changes preserve them.
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      <ElectronBrowserHost />
      <QuitHoldOverlay />
      <KodoWindowControls /> {/* KODO: window-controls */}
      <KodoShortcutsDialog /> {/* KODO: shortcuts-window */}
    </AppAtomRegistryProvider>
  );
}
