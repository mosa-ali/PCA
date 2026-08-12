// Narrow Coordinator integration glue: bridges parent-web's local `targetChildIds` field naming
// to the canonical `@pca/parent-sdk-wellbeing-control` package's `TargetScope.childProfileIds`.
// Scope deliberately limited to targeting only -- parent-web's WellbeingCategory/WellbeingTrigger
// enums are a DIFFERENT taxonomy from the SDK's (ENCOURAGEMENT/BREAK_REMINDER/FOCUS/... vs.
// SKILLS_AND_LEARNING/READING/FAITH_POSITIVE/...), not a naming variant of the same concept, so
// reconciling those belongs to a dedicated design pass (see PCA-RUNTIME-1 item L), not narrow glue.
import type { TargetMode, TargetScope } from '@pca/parent-sdk-wellbeing-control';

export function toSdkTargetScope(mode: TargetMode, targetChildIds: readonly string[]): TargetScope {
  return { mode, childProfileIds: targetChildIds };
}

export function fromSdkTargetScope(scope: TargetScope): { mode: TargetMode; targetChildIds: string[] } {
  return { mode: scope.mode, targetChildIds: [...scope.childProfileIds] };
}
