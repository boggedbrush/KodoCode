// The loop card's wording and actions live in @t3tools/shared/kodoLoopView so the mobile banner says
// the same things; the web card imports them from here.
export {
  KODO_LOOP_CONTEXT_NOTE,
  KODO_LOOP_STAGE_LABEL,
  formatKodoTokens,
  formatKodoUsd,
  isKodoLoopRunning,
  kodoLoopActions,
  kodoLoopHeldReason,
  kodoLoopOutstanding,
  kodoLoopStageStrip,
  kodoLoopStopText,
  kodoLoopTitle,
  summarizeKodoLoop,
  type KodoLoopActions,
  type KodoLoopOutstanding,
  type KodoLoopStageState,
  type KodoLoopSummary,
} from "@t3tools/shared/kodoLoopView";
