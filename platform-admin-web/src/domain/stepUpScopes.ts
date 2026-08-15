// Mirrors backend/src/platformadmin/auth/types.ts's
// PLATFORM_ADMIN_STEP_UP_SCOPES verbatim (PCA-ADD-PA-017 sensitive-action
// list). Every UI entry point that triggers one of these actions must
// route through StepUpProvider.requestStepUp(scope) first -- see mission
// Section 7.
export const PLATFORM_ADMIN_STEP_UP_SCOPES = [
  'REFUND',
  'SETTLEMENT_BANK_CONFIG',
  'ADMIN_ROLE_GRANT',
  'FAMILY_ACCOUNT_SUSPEND',
  'FAMILY_ACCOUNT_REACTIVATE',
  'ENTITLEMENT_LIMIT_OVERRIDE',
  // PCA-ADD-COMP-015: complimentary-grant create/revoke/renew.
  'COMPLIMENTARY_GRANT_MUTATION',
] as const;

export type PlatformAdminStepUpScope = (typeof PLATFORM_ADMIN_STEP_UP_SCOPES)[number];
