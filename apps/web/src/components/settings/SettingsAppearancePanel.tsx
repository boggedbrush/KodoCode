import {
  DEFAULT_UNIFIED_SETTINGS,
  type ChatFontFamily,
  type ChatTextSize,
} from "@t3tools/contracts/settings";

import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const CHAT_FONT_LABELS = {
  auto: "Auto",
  "dm-sans": "DM Sans",
  "noto-sans": "Noto Sans",
  "noto-sans-multiscript": "Noto Sans Multilingual",
} as const satisfies Record<ChatFontFamily, string>;

const CHAT_FONT_OPTIONS = [
  { value: "auto", label: CHAT_FONT_LABELS.auto },
  { value: "dm-sans", label: CHAT_FONT_LABELS["dm-sans"] },
  { value: "noto-sans", label: CHAT_FONT_LABELS["noto-sans"] },
  {
    value: "noto-sans-multiscript",
    label: CHAT_FONT_LABELS["noto-sans-multiscript"],
  },
] as const satisfies ReadonlyArray<{ value: ChatFontFamily; label: string }>;

function isChatFontFamily(value: string | null): value is ChatFontFamily {
  return value !== null && CHAT_FONT_OPTIONS.some((option) => option.value === value);
}

const CHAT_TEXT_SIZE_LABELS = {
  small: "Small",
  default: "Default",
  large: "Large",
} as const satisfies Record<ChatTextSize, string>;

export function SettingsAppearancePanel() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Appearance">
        <SettingsRow
          title="Theme"
          description="Choose how Kodo Code looks across the app."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="theme" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Chat typography"
          description="Auto keeps Kodo Code's default typography and includes bundled fallbacks for multiple scripts. Choose Noto Sans for a cleaner sans-serif look, or Noto Sans Multilingual for a more consistent cross-language chat style."
          resetAction={
            settings.chatFontFamily !== DEFAULT_UNIFIED_SETTINGS.chatFontFamily ? (
              <SettingResetButton
                label="chat typography"
                onClick={() =>
                  updateSettings({
                    chatFontFamily: DEFAULT_UNIFIED_SETTINGS.chatFontFamily,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.chatFontFamily}
              onValueChange={(value) => {
                if (isChatFontFamily(value)) {
                  updateSettings({ chatFontFamily: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-60" aria-label="Chat typography">
                <SelectValue>{CHAT_FONT_LABELS[settings.chatFontFamily]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {CHAT_FONT_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Chat text size"
          description="Adjust the reading size across assistant messages, user bubbles, and the composer."
          resetAction={
            settings.chatTextSize !== DEFAULT_UNIFIED_SETTINGS.chatTextSize ? (
              <SettingResetButton
                label="chat text size"
                onClick={() =>
                  updateSettings({
                    chatTextSize: DEFAULT_UNIFIED_SETTINGS.chatTextSize,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.chatTextSize}
              onValueChange={(value) => {
                if (value === "small" || value === "default" || value === "large") {
                  updateSettings({ chatTextSize: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Chat text size">
                <SelectValue>{CHAT_TEXT_SIZE_LABELS[settings.chatTextSize]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="small">
                  {CHAT_TEXT_SIZE_LABELS.small}
                </SelectItem>
                <SelectItem hideIndicator value="default">
                  {CHAT_TEXT_SIZE_LABELS.default}
                </SelectItem>
                <SelectItem hideIndicator value="large">
                  {CHAT_TEXT_SIZE_LABELS.large}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Diff line wrapping"
          description="Set the default wrap state when the diff panel opens."
          resetAction={
            settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap ? (
              <SettingResetButton
                label="diff line wrapping"
                onClick={() =>
                  updateSettings({
                    diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffWordWrap}
              onCheckedChange={(checked) => updateSettings({ diffWordWrap: Boolean(checked) })}
              aria-label="Wrap diff lines by default"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
