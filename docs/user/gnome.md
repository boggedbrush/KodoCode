# Shortcuts window and GNOME

## Keyboard shortcuts

Press `Ctrl+/` (`Cmd+/` on macOS), or choose **Keyboard shortcuts** in the command palette or the
desktop **Help** menu, to see every shortcut in one window. It lists what is bound now, in the same
groups as **Settings → Keybindings**, so a key you changed shows its new value. Kodo's own
shortcuts are under **Kodo**: `Shift+Tab` cycles the interaction mode, and the sub-agents and
Orchestrator commands show **Not assigned** until you bind a key to them. Press the chord again or
`Esc` to close it. It works the same on every platform and in the browser. The shortcut follows the
character your keyboard types, so on a layout where `/` needs Shift (German, for example) use the
command palette or the Help menu, or bind your own key in **Settings → Keybindings**.

## Window buttons and title bar (Linux desktop app)

On GNOME, Kodo Code draws the window buttons in its own header bar, on the side and in the order of
your GNOME button layout (`org.gnome.desktop.wm.preferences button-layout`). Drag the header to move
the window; double-click it to maximize, as GNOME is set to. In fullscreen the buttons are hidden.
The window is frameless, so it has no GNOME shadow or rounded corners. If the layout cannot be read,
or on any other Linux desktop, the window keeps Chromium's own window buttons, as Kodo Code always has.

**Settings → General → Use system title bar** gives the window your desktop's own frame and title
bar instead, on GNOME and on every other Linux desktop. The window then has no header bar buttons of
its own and no Chromium buttons. It takes effect the next time Kodo Code starts.

If the page that draws the buttons stops working, Kodo Code on GNOME shows a message with
**Reload**, which loads the app again, and **Close window**. It appears when the page crashed again
after Kodo Code reloaded it three times within a minute, when it failed to load, when it loaded but
its buttons did not appear within ten seconds, or when it does not respond. For a page that does not
respond the first button is **Keep waiting**, and the message closes by itself if the page responds
again. `Esc` always chooses the first button, never **Close window**.

The Kodo theme also takes GNOME's accent colour (Settings → Appearance in GNOME), and follows a
change while Kodo Code is open. Choosing another theme keeps that theme's own accent, and
**Settings → General → Follow the system accent colour** turns it off for the Kodo theme. Text on an
accent is white or black, whichever is easier to read.
