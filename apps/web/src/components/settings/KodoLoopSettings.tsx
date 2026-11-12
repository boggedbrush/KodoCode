import {
  DEFAULT_KODO_LOOP_SETTINGS,
  KODO_LOOP_MAX_ROUNDS,
  type KodoLoopSettingsPatch,
} from "@t3tools/contracts";
import { useState } from "react";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { searchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const APPROVAL_LABEL = { auto: "Continue automatically", ask: "Ask me first" } as const;

/** A number the person types; it is saved as soon as it is valid, and a blank clears an optional cap. */
function NumberInput(props: {
  readonly value: number | null;
  readonly label: string;
  readonly min: number;
  readonly max?: number;
  readonly integer?: boolean;
  /** A blank saves null; without this a blank is not a value. */
  readonly clearable?: boolean;
  readonly placeholder?: string;
  readonly onCommit: (value: number | null) => void;
}) {
  const text = props.value === null ? "" : String(props.value);
  const [draft, setDraft] = useState(text);
  const [source, setSource] = useState(text);
  if (source !== text) {
    setSource(text);
    setDraft(text);
  }
  return (
    <Input
      size="sm"
      type="number"
      min={props.min}
      {...(props.max === undefined ? {} : { max: props.max })}
      step={props.integer === true ? 1 : "any"}
      className="w-full sm:w-28"
      value={draft}
      placeholder={props.placeholder}
      aria-label={props.label}
      onChange={(event) => {
        setDraft(event.target.value);
        if (event.target.value.trim() === "") {
          if (props.clearable === true) props.onCommit(null);
          return;
        }
        const parsed = Number(event.target.value);
        if (
          Number.isFinite(parsed) &&
          parsed >= props.min &&
          (props.max === undefined || parsed <= props.max) &&
          (props.integer !== true || Number.isInteger(parsed)) &&
          (props.min > 0 || parsed > 0)
        ) {
          props.onCommit(parsed);
        }
      }}
      onBlur={() => setDraft(text)}
    />
  );
}

/** What `/loop` does by default: how many rounds, whether the plan waits for you, and when to stop spending. */
export function KodoLoopSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["loop"]);
  const loop = settings.loop;
  const defaults = DEFAULT_KODO_LOOP_SETTINGS;
  const slots = settings.modeModelSelections;
  const allUnset = slots.plan === null && slots.code === null && slots.review === null;
  const patch = (next: KodoLoopSettingsPatch) => updateSettings({ loop: next });
  const reset = (label: string, changed: boolean, next: KodoLoopSettingsPatch) =>
    mixed || changed ? <SettingResetButton label={label} onClick={() => patch(next)} /> : null;
  const rowProps = { serverScoped: true, settingKeys: ["loop" as const], mixed };
  return (
    <SettingsSection {...searchableSetting("loop-settings")}>
      <SettingsRow
        {...rowProps}
        title="Loop models"
        description={
          allUnset
            ? "Plan, Code and Review have no model set above, so a loop runs every stage on the thread's own model and saves nothing. Give Code a cheaper model to make it worth running."
            : "A loop runs Plan, Code, Review and Judge on the models set above. The Judge uses its own model, or the Review model when it has none, and also serves as the reference for the savings estimate."
        }
      />
      <SettingsRow
        {...rowProps}
        title="Rounds"
        description={`How many plan, code, review and judge rounds a loop runs before it stops, 1 to ${KODO_LOOP_MAX_ROUNDS}. /loop 5 your request sets it for one loop.`}
        resetAction={reset("rounds", loop.defaultMaxRounds !== defaults.defaultMaxRounds, {
          defaultMaxRounds: defaults.defaultMaxRounds,
        })}
        control={
          <NumberInput
            value={loop.defaultMaxRounds}
            label="Default rounds"
            min={1}
            max={KODO_LOOP_MAX_ROUNDS}
            integer
            onCommit={(value) => value !== null && patch({ defaultMaxRounds: value })}
          />
        }
      />
      <SettingsRow
        {...rowProps}
        title="Plan approval"
        description="Ask me first holds the loop after the plan so you can read it; approve it to start coding, or stop. Sending a message also stops the loop."
        resetAction={reset("plan approval", loop.planApproval !== defaults.planApproval, {
          planApproval: defaults.planApproval,
        })}
        control={
          <Select
            value={loop.planApproval}
            onValueChange={(value) => {
              if (value === "auto" || value === "ask") patch({ planApproval: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Plan approval">
              <SelectValue>{APPROVAL_LABEL[loop.planApproval]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(["auto", "ask"] as const).map((value) => (
                <SelectItem hideIndicator key={value} value={value}>
                  {APPROVAL_LABEL[value]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...rowProps}
        title="Stop at usage limit"
        description="Stops the loop before its next stage when the provider that stage will use is at or above this share of a usage window. Checked between stages only, so a stage already running finishes. Providers that report no limits are not checked, and the loop says so."
        resetAction={reset(
          "usage limit",
          loop.budget.stopAtLimitPercent !== defaults.budget.stopAtLimitPercent,
          { budget: { stopAtLimitPercent: defaults.budget.stopAtLimitPercent } },
        )}
        control={
          <NumberInput
            value={loop.budget.stopAtLimitPercent}
            label="Stop at usage limit percent"
            min={1}
            max={100}
            onCommit={(value) => value !== null && patch({ budget: { stopAtLimitPercent: value } })}
          />
        }
      />
      <SettingsRow
        {...rowProps}
        title="Cost cap (USD)"
        description="Stops the loop between stages once its priced cost reaches this. Counts only stages whose model has a price at API rates; a stage without one is not counted, and the summary says which. Blank: no cap."
        resetAction={reset("cost cap", loop.budget.maxCostUsd !== null, {
          budget: { maxCostUsd: null },
        })}
        control={
          <NumberInput
            value={loop.budget.maxCostUsd}
            label="Cost cap in US dollars"
            min={0}
            clearable
            placeholder="No cap"
            onCommit={(value) => patch({ budget: { maxCostUsd: value } })}
          />
        }
      />
      <SettingsRow
        {...rowProps}
        title="Token cap"
        description="Stops the loop between stages once it has used this many tokens, counting what providers report. A stage whose provider reports none is not counted. Blank: no cap."
        resetAction={reset("token cap", loop.budget.maxTokens !== null, {
          budget: { maxTokens: null },
        })}
        control={
          <NumberInput
            value={loop.budget.maxTokens}
            label="Token cap"
            min={1}
            integer
            clearable
            placeholder="No cap"
            onCommit={(value) => patch({ budget: { maxTokens: value } })}
          />
        }
      />
    </SettingsSection>
  );
}
