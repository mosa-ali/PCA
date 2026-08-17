// PCA-FR-093: client-side mirror of backend/src/retention/types.ts's wire
// shapes for the family privacy-control routes
// (backend/src/http/routes/retentionRoutes.ts). Deliberately a narrow,
// hand-transcribed subset -- only what the parent-web Retention/DeleteNow/
// Export pages actually render or submit, not a full copy of the backend's
// internal retention engine types.
export type RetentionWindow = '14_DAYS' | '1_MONTH' | '3_MONTHS' | '6_MONTHS' | '9_MONTHS';

export const RETENTION_WINDOWS: RetentionWindow[] = ['14_DAYS', '1_MONTH', '3_MONTHS', '6_MONTHS', '9_MONTHS'];

/** GET /v1/retention-policy/defaults response. */
export interface RetentionDefaults {
  generalWindow: RetentionWindow;
  availableWindows: RetentionWindow[];
  locationMode: LocationRetentionMode;
}

export type LocationRetentionMode = 'CURRENT_LAST_ONLY' | { window: RetentionWindow };

/** Body of POST /v1/families/:familyId/retention-policy. */
export interface RetentionPolicySettings {
  generalWindow: RetentionWindow;
  locationMode: LocationRetentionMode;
  timezone: string;
}

/**
 * POST /v1/families/:familyId/retention-policy response. See
 * retentionRoutes.ts's own doc comment: this backend deliberately holds no
 * policy payload storage -- a 200 here means "validated and audited," not
 * "persisted," and the UI must not claim otherwise.
 */
export interface RetentionPolicySubmitResult {
  policy: RetentionPolicySettings;
  accepted: true;
}

/** POST /v1/families/:familyId/delete-now response -- see retentionRoutes.ts's DELETE_NOW_DISCLOSED_STATE doc comment: always pending, never "completed". */
export interface DeleteNowResult {
  actionId: string;
  idempotent: boolean;
  plan: { toDelete: { entityClass: string; id: string; reason: string }[]; retainedCount: number };
  deliveryStatus: 'DELETE_PENDING_REMOTE_DEVICE';
}

/** POST /v1/families/:familyId/export-requests response -- always PENDING_CRYPTO_REVIEW today, see retentionRoutes.ts's EXPORT_CREATION_DISCLOSURE doc comment. */
export interface ExportRequestResult {
  exportId: string;
  status: 'PENDING_CRYPTO_REVIEW';
  disclosures: string[];
}
