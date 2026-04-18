import { resolve, relative } from "node:path";
import { realpathSync } from "node:fs";
import { file, serve } from "bun";

const port = Number(process.env.T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT ?? 3000);
const root =
  process.env.T3CODE_DESKTOP_MOCK_UPDATE_SERVER_ROOT ??
  resolve(import.meta.dirname, "..", "release-mock");

const mockServerLog = (level: "info" | "warn" | "error" = "info", message: string) => {
  console[level](`[mock-update-server] ${message}`);
};

function isWithinRoot(filePath: string): boolean {
  try {
    return !relative(realpathSync(root), realpathSync(filePath)).startsWith(".");
  } catch (error) {
    mockServerLog("error", `Error checking if file is within root: ${error}`);
    return false;
  }
}

serve({
  port,
  hostname: "localhost",
  fetch: async (request: { url: string }) => {
    const url = new URL(request.url);
    const path = url.pathname;
    mockServerLog("info", `Request received for path: ${path}`);
    const filePath = resolve(root, `.${path}`);
    if (!isWithinRoot(filePath)) {
      mockServerLog("warn", `Attempted to access file outside of root: ${filePath}`);
      return new Response("Not Found", { status: 404 });
    }
    const requestedFile = file(filePath);
    if (!(await requestedFile.exists())) {
      mockServerLog("warn", `Attempted to access non-existent file: ${filePath}`);
      return new Response("Not Found", { status: 404 });
    }
    mockServerLog("info", `Serving file: ${filePath}`);
    return new Response(requestedFile);
  },
});

mockServerLog("info", `running on http://localhost:${port}`);
