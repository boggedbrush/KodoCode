import { splitInlineCode } from "./inlineCode.logic";

/**
 * Text whose `backtick` spans read as inline code, in the same look as chat replies. Only that one
 * piece of markdown is supported, so the banner never loads the full renderer.
 */
export function KodoInlineText(props: { readonly text: string }) {
  const segments = splitInlineCode(props.text);
  if (segments.every((segment) => segment.kind === "text")) return <>{props.text}</>;
  return (
    <span className="chat-markdown">
      {segments.map((segment) =>
        segment.kind === "code" ? (
          <code key={segment.start}>{segment.text}</code>
        ) : (
          <span key={segment.start}>{segment.text}</span>
        ),
      )}
    </span>
  );
}
