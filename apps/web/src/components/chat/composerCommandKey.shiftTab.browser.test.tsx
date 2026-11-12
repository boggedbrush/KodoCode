import { createRef, useRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "../ComposerPromptEditorTiptap";
import { composerCommandKeyHandler } from "./composerCommandKey";

// The editor is real; everything the handler only passes along is stubbed.
function ShiftTabComposer(props: {
  readonly initial: string;
  readonly onToggle: () => void;
  readonly onPrompt: (value: string) => void;
}) {
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const [prompt, setPromptState] = useState({ value: props.initial, cursor: props.initial.length });
  const [promptRef] = useState({ current: props.initial });
  const setPrompt = (next: { value: string; cursor: number }) => {
    promptRef.current = next.value;
    setPromptState(next);
  };
  const handler = (key: string, event: KeyboardEvent) =>
    composerCommandKeyHandler({
      keybindings: [],
      sendShortcut: "enter",
      routeKind: "server",
      phase: "ready",
      canSteer: true,
      followUpBehavior: "queue",
      isSoftwareKeyboardOpen: false,
      isLiteralPendingAnswer: false,
      pendingUserInputs: [],
      promptHistoryEntries: [],
      promptHistoryPositionRef: createRef(),
      composerDraftTarget: "draft-1",
      promptRef,
      composerEditorRef: editorRef,
      composerMenuOpenRef: { current: false },
      composerMenuItemsRef: { current: [] },
      activeComposerMenuItemRef: { current: null },
      setComposerDraftPrompt: () => {},
      setComposerCursor: () => {},
      setComposerTrigger: () => {},
      setComposerHighlightedItemId: () => {},
      dismissComposerTrigger: () => {},
      toggleInteractionMode: props.onToggle,
      nudgeComposerMenuHighlight: () => {},
      onSelectComposerItem: () => {},
      resolveActiveComposerTrigger: () => ({ trigger: null }),
      readComposerSnapshot: () => ({ value: promptRef.current }),
      applyPromptReplacement: (start: number, end: number, replacement: string) => {
        const value =
          promptRef.current.slice(0, start) + replacement + promptRef.current.slice(end);
        setPrompt({ value, cursor: start + replacement.length });
        props.onPrompt(value);
        return true;
      },
      submitComposer: () => {},
      promptSuggestion: null,
      dismissPromptSuggestion: () => {},
    } as never)(key, event);
  return (
    <ComposerPromptEditor
      editorRef={editorRef}
      value={prompt.value}
      cursor={prompt.cursor}
      richTextEnabled={false}
      contextRecords={new Map()}
      skills={[]}
      disabled={false}
      placeholder=""
      onChange={(value, cursor) => setPrompt({ value, cursor })}
      onPaste={() => {}}
      onCommandKeyDown={handler}
    />
  );
}

async function mountComposer(initial: string) {
  const onToggle = vi.fn();
  const onPrompt = vi.fn();
  const screen = await render(
    <ShiftTabComposer initial={initial} onToggle={onToggle} onPrompt={onPrompt} />,
  );
  const editable = screen.container.querySelector<HTMLElement>(".tiptap");
  if (!editable) throw new Error("Composer did not mount");
  editable.focus();
  return { screen, editable, onToggle, onPrompt };
}

const shiftTab = () => userEvent.keyboard("{Shift>}{Tab}{/Shift}");

describe("Shift+Tab in the composer", () => {
  it("cycles the mode and keeps focus in the composer", async () => {
    const { screen, editable, onToggle } = await mountComposer("fix the bug");
    await shiftTab();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editable);
    await shiftTab();
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(editable);
    await screen.unmount();
  });

  it("cycles the mode from an empty composer", async () => {
    const { screen, editable, onToggle } = await mountComposer("");
    await shiftTab();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editable);
    await screen.unmount();
  });

  it("outdents inside a nested list item instead of cycling the mode", async () => {
    const { screen, onToggle, onPrompt } = await mountComposer("- parent\n  - child");
    await shiftTab();
    expect(onToggle).not.toHaveBeenCalled();
    expect(onPrompt).toHaveBeenLastCalledWith("- parent\n- child");
    await screen.unmount();
  });

  it("cycles the mode in a list item that has nothing left to outdent", async () => {
    const { screen, onToggle, onPrompt } = await mountComposer("- parent\n- sibling");
    await shiftTab();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPrompt).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it("leaves a plain Tab to the editor and does not cycle the mode", async () => {
    const { screen, onToggle } = await mountComposer("fix the bug");
    await userEvent.keyboard("{Tab}");
    expect(onToggle).not.toHaveBeenCalled();
    await screen.unmount();
  });
});
