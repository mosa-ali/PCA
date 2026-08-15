// FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61) -- parent-facing FREE_ACCESS
// status domain type. Mirrors backend/src/parentaccount/freeaccess/types.ts's
// frozen FreeAccessStatus contract exactly (field-for-field): the backend
// derives every field server-side, every time, from the account's own
// snapshot + the server clock -- this client-side type is a pure read model
// of that response, never independently computed. `remainingDays`/`status`
// must never be recomputed on the client from a locally-held expiresAt/clock
// -- always use exactly what the server returned.
export interface FreeAccessStatus {
  mode: 'TIME_LIMITED' | 'PERPETUAL';
  /** ISO timestamp. */
  grantedAt: string;
  /** null for PERPETUAL. */
  expiresAt: string | null;
  /** Server-computed whole days remaining; null for PERPETUAL or EXPIRED. 0 means "expires today". */
  remainingDays: number | null;
  status: 'ACTIVE' | 'EXPIRED' | 'PERPETUAL';
}
