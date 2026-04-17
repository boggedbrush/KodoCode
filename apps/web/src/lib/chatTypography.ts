import type { ChatFontFamily } from "@t3tools/contracts/settings";
import type { TextDirection } from "./textDirection";
import { cn } from "./utils";

type ChatTypographyVariant = "chat" | "composer";

const CHAT_DIRECTION_CLASS_BY_VARIANT = {
  chat: {
    rtl: "chat-direction-rtl",
    ltr: "chat-direction-ltr",
    auto: "chat-direction-auto",
  },
  composer: {
    rtl: "chat-composer-direction-rtl",
    ltr: "chat-composer-direction-ltr",
    auto: "chat-composer-direction-auto",
  },
} as const satisfies Record<ChatTypographyVariant, Record<TextDirection, string>>;

const CHAT_FONT_CLASS_BY_FAMILY = {
  "dm-sans": "chat-font-dm-sans",
  "noto-sans-arabic": "chat-font-noto-sans-arabic",
} as const satisfies Record<Exclude<ChatFontFamily, "auto">, string>;

export function resolveChatTypographyClassName(options: {
  direction: TextDirection;
  fontFamily: ChatFontFamily;
  variant?: ChatTypographyVariant;
}) {
  const variant = options.variant ?? "chat";
  return cn(
    CHAT_DIRECTION_CLASS_BY_VARIANT[variant][options.direction],
    options.fontFamily !== "auto" && CHAT_FONT_CLASS_BY_FAMILY[options.fontFamily],
  );
}
