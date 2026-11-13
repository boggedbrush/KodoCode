import type { KodoWindowButton } from "@t3tools/contracts";

export interface GnomeButtonLayout {
  readonly left: ReadonlyArray<KodoWindowButton>;
  readonly right: ReadonlyArray<KodoWindowButton>;
}

const BUTTONS: ReadonlySet<string> = new Set<KodoWindowButton>(["minimize", "maximize", "close"]);

// gsettings prints a string as a GVariant: 'close' in single quotes, or in double quotes when it holds one.
function unquoteGVariantString(output: string): string | null {
  const text = output.trim();
  const quote = text[0];
  if ((quote !== "'" && quote !== '"') || text.length < 2 || text.at(-1) !== quote) return null;
  return text.slice(1, -1);
}

function parseSide(side: string, seen: Set<string>): KodoWindowButton[] {
  const buttons: KodoWindowButton[] = [];
  for (const token of side.split(",")) {
    const name = token.trim();
    // appmenu, icon, menu and spacer are other widgets; a button listed twice is drawn once.
    if (!BUTTONS.has(name) || seen.has(name)) continue;
    seen.add(name);
    buttons.push(name as KodoWindowButton);
  }
  return buttons;
}

/**
 * Reads `org.gnome.desktop.wm.preferences button-layout`, as `gsettings get` prints it.
 * Like GTK, it splits at the first colon, and a string without one is all left. Returns null for
 * output that is not a quoted string, so the caller keeps the system frame.
 */
export function parseGnomeButtonLayout(output: string): GnomeButtonLayout | null {
  const layout = unquoteGVariantString(output);
  if (layout === null) return null;
  const colon = layout.indexOf(":");
  const seen = new Set<string>();
  return colon === -1
    ? { left: parseSide(layout, seen), right: [] }
    : {
        left: parseSide(layout.slice(0, colon), seen),
        right: parseSide(layout.slice(colon + 1), seen),
      };
}
