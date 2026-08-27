// DEVELOPMENT_ONLY fixture implementation of RetentionClient (PCA-FR-093).
// Mirrors the real backend's honest disposition disclosures (validated-not-
// persisted policy submit, always-pending delete-now, always-pending
// export) entirely in memory -- never fabricates a "completed" state that
// the real backend (backend/src/http/routes/retentionRoutes.ts) itself
// never returns, so demo mode cannot mislead a reviewer about what this
// flow actually does once wired to a real backend.
import type { RetentionClient } from '../interfaces';
import type { DeleteNowResult, ExportRequestResult, RetentionDefaults, RetentionPolicySettings, RetentionPolicySubmitResult } from '../../domain/retention';
import { RETENTION_WINDOWS } from '../../domain/retention';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

let lastSubmittedPolicy: RetentionPolicySettings | null = null;

/** Test/dev-only observation hook; production clients never expose policy payloads through this module. */
export function __devLastSubmittedRetentionPolicy(): RetentionPolicySettings | null {
  return lastSubmittedPolicy;
}

export class DevRetentionClient implements RetentionClient {
  async getDefaults(): Promise<RetentionDefaults> {
    await delay();
    return { generalWindow: '1_MONTH', availableWindows: RETENTION_WINDOWS, locationMode: 'CURRENT_LAST_ONLY' };
  }

  async submitPolicy(policy: RetentionPolicySettings): Promise<RetentionPolicySubmitResult> {
    await delay();
    lastSubmittedPolicy = policy;
    return { policy, accepted: true };
  }

  async deleteNow(actionId: string): Promise<DeleteNowResult> {
    await delay();
    return {
      actionId,
      idempotent: false,
      // Non-trivial, non-empty plan so the dev/demo UI exercises the same
      // disclosure rendering a real over-the-floor family would see, rather
      // than an always-empty plan that would mask a UI regression.
      plan: {
        toDelete: [
          { entityClass: 'ACTIVITY_EVENT', id: 'dev-activity-1', reason: 'WITHIN_ACTIVE_RETENTION_WINDOW' },
          { entityClass: 'LOCATION_SAMPLE', id: 'dev-location-1', reason: 'WITHIN_ACTIVE_RETENTION_WINDOW' },
        ],
        retainedCount: 1,
      },
      deliveryStatus: 'DELETE_PENDING_REMOTE_DEVICE',
    };
  }

  async requestExport(): Promise<ExportRequestResult> {
    await delay();
    return { exportId: `dev-export-${Date.now()}`, status: 'PENDING_CRYPTO_REVIEW', disclosures: ['EXPORT_WILL_EXIST_OUTSIDE_APP_MANAGED_RETENTION_ONCE_CREATED'] };
  }
}
