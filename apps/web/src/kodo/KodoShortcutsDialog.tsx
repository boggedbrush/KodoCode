import { useAtomValue } from "@effect/atom-react";
import { Fragment } from "react";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Kbd, KbdGroup } from "../components/ui/kbd";
import { isElectron } from "../env";
import { primaryServerKeybindingsAtom } from "../state/server";
import { setKodoShortcutsOpen, useKodoShortcutsOpen } from "./shortcutsWindow";
import { buildShortcutSections, shortcutKeyCaps } from "./shortcuts.logic";

/**
 * The keyboard shortcuts overview, after GNOME's shortcuts window: grouped sections, a key cap per key.
 * It reads the keybinding registry, so it lists what is bound now, here and on every platform.
 */
export function KodoShortcutsDialog() {
  const open = useKodoShortcutsOpen();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const sections = open
    ? buildShortcutSections(keybindings, { platform: navigator.platform, desktop: isElectron })
    : [];
  return (
    <Dialog open={open} onOpenChange={setKodoShortcutsOpen}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Change any of them in Settings, under Keybindings.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {sections.map((section) => (
              <section key={section.id} aria-labelledby={`kodo-shortcuts-${section.id}`}>
                <h3 id={`kodo-shortcuts-${section.id}`} className="mb-1 font-semibold text-sm">
                  {section.title}
                </h3>
                <ul>
                  {section.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-4 border-border/60 border-b py-1.5 text-sm last:border-b-0"
                    >
                      <span>{entry.title}</span>
                      {entry.shortcuts.length === 0 ? (
                        <span className="shrink-0 text-muted-foreground text-xs">Not assigned</span>
                      ) : (
                        <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
                          {entry.shortcuts.map((shortcut, index) => (
                            <Fragment key={shortcutKeyCaps(shortcut, navigator.platform).join("+")}>
                              {index > 0 ? (
                                <span className="text-muted-foreground text-xs">or</span>
                              ) : null}
                              <KbdGroup>
                                {shortcutKeyCaps(shortcut, navigator.platform).map((cap) => (
                                  <Kbd key={cap} variant="outline">
                                    {cap}
                                  </Kbd>
                                ))}
                              </KbdGroup>
                            </Fragment>
                          ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
