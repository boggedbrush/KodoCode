import { APP_BASE_NAME, APP_REPOSITORY_URL } from "@t3tools/shared/appBrand";
import type { Plugin } from "vite-plus";

const UPSTREAM_PRODUCT_NAME = "T3 Code";
const UPSTREAM_PRODUCT_NAME_URL_ENCODED = "T3%20Code";

// Web source only. Workspace packages (`shared`, `client-runtime`, `contracts`) are loaded by the
// server, desktop and mobile too, so rewriting them here would make one module say different
// things per process, and would rewrite values that cross the wire.
const REWRITTEN_SOURCE = /[\\/]apps[\\/]web[\\/]src[\\/].+\.[cm]?[jt]sx?$/;
const DEPENDENCY_SOURCE = /[\\/]node_modules[\\/]/;

/**
 * Text that keeps upstream's product name because it names something upstream owns or must
 * match text another process generates. Each entry is exact source text in one file;
 * `brandText.test.ts` fails when upstream edits it away, so the choice gets reviewed again.
 */
export const PRESERVED_TEXT: ReadonlyArray<{
  readonly file: string;
  readonly text: string;
  readonly why: string;
}> = [
  {
    file: "apps/web/src/components/settings/LinkedEnvironmentsSettings.tsx",
    text: 'Revoke "T3 Code · …"',
    why: "Must match the session label the server generates for a linked environment.",
  },
  {
    file: "apps/web/src/lib/bootError.ts",
    text: "Download and reinstall T3 Code",
    why: "Links to upstream's download page, which offers upstream's app.",
  },
  {
    file: "apps/web/src/components/promptLinks/HostedPromptLinkLanding.tsx",
    text: "Get T3 Code",
    why: "Links to upstream's download page, which offers upstream's app.",
  },
  {
    file: "apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx",
    text: "Install T3 Code on your phone",
    why: "The only mobile app is upstream's.",
  },
  {
    file: "apps/web/src/components/clerk/MobileClientsUserProfilePage.logic.ts",
    text: "T3 Code ${device.appVersion}",
    why: "Names a registered mobile device, which runs upstream's app.",
  },
  {
    file: "apps/web/src/components/onboarding/WelcomePage.tsx",
    text: "Use T3 Code on your phone",
    why: "The QR code opens upstream's mobile app listing.",
  },
  {
    file: "apps/web/src/components/onboarding/WelcomePage.tsx",
    text: 'title="T3 Code app for iPhone and Android"',
    why: "The QR code opens upstream's mobile app listing.",
  },
];

/**
 * Upstream links that must point at this fork instead. The boot error page cannot import
 * workspace packages (it has to run when the app bundle fails), so its issue link is
 * repointed here rather than in the source. Checked like `PRESERVED_TEXT`.
 */
export const REPOINTED_TEXT: ReadonlyArray<{
  readonly file: string;
  readonly text: string;
  readonly replacement: string;
}> = [
  {
    file: "apps/web/src/lib/bootError.ts",
    text: "https://github.com/pingdotgg/t3code/issues/new",
    replacement: `${APP_REPOSITORY_URL}/issues/new`,
  },
];

const placeholder = (index: number) => `\u0000kodo-keep-${index}\u0000`;

/**
 * Swaps upstream's product name for the one in `appBrand.ts` at build time, so upstream
 * merges never conflict on copy. Tests go through it too; new copy should use `APP_BASE_NAME`.
 */
export function brandTextPlugin(): Plugin {
  return {
    name: "kodo:brand-text",
    enforce: "pre",
    transform(code, id) {
      const path = (id.split("?")[0] ?? id).replaceAll("\\", "/");
      if (!REWRITTEN_SOURCE.test(path) || DEPENDENCY_SOURCE.test(path)) return null;
      const inFile = (entry: { readonly file: string }) => path.endsWith(`/${entry.file}`);
      const repointed = REPOINTED_TEXT.filter(inFile);
      const preserved = PRESERVED_TEXT.map((entry, index) => ({ entry, index })).filter(
        ({ entry }) => inFile(entry) && code.includes(entry.text),
      );
      if (
        repointed.length === 0 &&
        !code.includes(UPSTREAM_PRODUCT_NAME) &&
        !code.includes(UPSTREAM_PRODUCT_NAME_URL_ENCODED)
      ) {
        return null;
      }
      let rewritten = code;
      for (const entry of repointed) {
        rewritten = rewritten.replaceAll(entry.text, entry.replacement);
      }
      for (const { entry, index } of preserved) {
        rewritten = rewritten.replaceAll(entry.text, placeholder(index));
      }
      rewritten = rewritten
        .replaceAll(UPSTREAM_PRODUCT_NAME, APP_BASE_NAME)
        .replaceAll(UPSTREAM_PRODUCT_NAME_URL_ENCODED, encodeURIComponent(APP_BASE_NAME));
      for (const { entry, index } of preserved) {
        rewritten = rewritten.replaceAll(placeholder(index), entry.text);
      }
      return rewritten === code ? null : { code: rewritten, map: null };
    },
  };
}
