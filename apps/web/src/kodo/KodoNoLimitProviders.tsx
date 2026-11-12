import { collectLimitAccounts, type LimitPresentations } from "@t3tools/shared/usageLimits";

import { providersWithoutLimitData } from "./usageMeter.logic";

/** Says plainly which signed-in providers cannot report subscription limits, so a gap is not a bug. */
export function KodoNoLimitProviders({
  presentations,
}: {
  readonly presentations: LimitPresentations;
}) {
  const names = providersWithoutLimitData(
    [...presentations.values()].flatMap(
      (presentation) => presentation.serverConfig?.providers ?? [],
    ),
    new Set(collectLimitAccounts(presentations).map((account) => account.driver)),
  );
  if (names.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground" data-kodo-no-limit-providers="true">
      No limit data from {names.join(", ")}: they report no subscription limits for the current
      sign-in.
    </p>
  );
}
