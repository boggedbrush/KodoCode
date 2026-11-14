import { KODO_QUIET_MAX_MINUTES } from "@t3tools/contracts";

/** The minutes to save from what was typed, or undefined to keep the current setting: empty is not 0 (off). */
export function kodoQuietMinutesToSave(raw: string, current: number): number | undefined {
  if (raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed <= KODO_QUIET_MAX_MINUTES &&
    parsed !== current
    ? parsed
    : undefined;
}
