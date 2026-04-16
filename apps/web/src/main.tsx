import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { isDesktopApp } from "./desktopRuntime";
import { initializeThemeFromStorage } from "./hooks/useTheme";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";

// Desktop shells load the app from a file-backed/custom-protocol shell, so hash history avoids
// path resolution issues.
const history = isDesktopApp ? createHashHistory() : createBrowserHistory();

// Apply the persisted theme before the first React render so system-dark boots correctly.
initializeThemeFromStorage();

const router = getRouter(history);

document.title = APP_DISPLAY_NAME;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
