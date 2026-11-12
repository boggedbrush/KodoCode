/**
 * Accent colours of the interaction modes, as CSS custom properties defined in kodo.css.
 * Read them through these helpers (or the `text-mode-*` / `bg-mode-*` / `border-mode-*`
 * Tailwind utilities) so each mode keeps its colour in every theme and appearance.
 */
export const MODE_ACCENT_IDS = ["ask", "plan", "code", "review"] as const;

export type ModeAccentId = (typeof MODE_ACCENT_IDS)[number];

export const MODE_ACCENT_CSS_VARIABLES = {
  ask: "--mode-ask",
  plan: "--mode-plan",
  code: "--mode-code",
  review: "--mode-review",
} as const satisfies Record<ModeAccentId, `--mode-${ModeAccentId}`>;

/** A `var(--mode-*)` reference, usable in inline styles. */
export function modeAccentColor(mode: ModeAccentId): string {
  return `var(${MODE_ACCENT_CSS_VARIABLES[mode]})`;
}

/** The accent at a given opacity, for frames, glows and tinted surfaces. */
export function modeAccentColorMix(mode: ModeAccentId, percent: number): string {
  return `color-mix(in srgb, ${modeAccentColor(mode)} ${percent}%, transparent)`;
}
