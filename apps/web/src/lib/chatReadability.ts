import type { ChatFontFamily, ChatTextSize } from "@t3tools/contracts/settings";
import type { TextDirection } from "./textDirection";
import { cn } from "./utils";

const CHAT_DIRECTION_CLASS = {
  rtl: "chat-readability-direction-rtl",
  ltr: "chat-readability-direction-ltr",
  auto: "chat-readability-direction-auto",
} as const satisfies Record<TextDirection, string>;

const CHAT_FONT_CLASS_BY_FAMILY = {
  "dm-sans": "chat-readability-font-dm-sans",
  "noto-sans": "chat-readability-font-noto-sans",
  "noto-sans-multiscript": "chat-readability-font-noto-sans-multiscript",
} as const satisfies Record<Exclude<ChatFontFamily, "auto">, string>;

const CHAT_TEXT_SIZE_CLASS = {
  small: "chat-readability-text-small",
  default: "chat-readability-text-default",
  large: "chat-readability-text-large",
} as const satisfies Record<ChatTextSize, string>;

export function resolveChatReadabilityClassName(options: {
  direction: TextDirection;
  fontFamily: ChatFontFamily;
  textSize: ChatTextSize;
}) {
  return cn(
    "chat-readability-surface",
    CHAT_DIRECTION_CLASS[options.direction],
    CHAT_TEXT_SIZE_CLASS[options.textSize],
    options.fontFamily !== "auto" && CHAT_FONT_CLASS_BY_FAMILY[options.fontFamily],
  );
}
