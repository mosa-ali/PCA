// Narrow Coordinator integration glue: bridges parent-web's local `targetChildIds` field naming
// to the canonical `@pca/parent-sdk-wellbeing-control` package's `TargetScope.childProfileIds`.
//
// This file used to claim that reconciling parent-web's WellbeingCategory/WellbeingTrigger enums
// with the SDK's "belongs to a dedicated design pass". That design pass has since happened and is
// recorded in docs/architecture/38_CANONICAL_WELLBEING_POLICY.md: Section 1 rules Android's
// feature/wellbeing runtime canonical, Section 2 gives the full category mapping, and Section 3
// the trigger mapping. parent-web now re-exports the SDK's taxonomy verbatim (see ./wellbeing.ts),
// so there is no second taxonomy left to reconcile -- only this targeting field-name difference.
import type { TargetMode, TargetScope } from '@pca/parent-sdk-wellbeing-control';

export function toSdkTargetScope(mode: TargetMode, targetChildIds: readonly string[]): TargetScope {
  return { mode, childProfileIds: targetChildIds };
}

export function fromSdkTargetScope(scope: TargetScope): { mode: TargetMode; targetChildIds: string[] } {
  return { mode: scope.mode, targetChildIds: [...scope.childProfileIds] };
}
