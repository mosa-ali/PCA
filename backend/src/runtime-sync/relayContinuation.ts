import { compareRelayQueuePositions, isRelayQueuePosition, type RelayQueuePosition } from '../relay/queuePage.js';

// Four bounded IDs can each require JSON control-character escaping before
// base64 expansion. Reserve room for the full existing opaque-ID contract.
export const MAX_RELAY_CURSOR_BYTES = 6144;
export const RELAY_CAMPAIGN_TTL_MS = 15 * 60 * 1000;

export interface RelayNavigationScope {
  familyId: string;
  recipientDeviceId: string;
  /** SHA-256 reference to the validated bearer, never another bearer copy. */
  sessionIncarnation: string;
}

export interface RelayContinuation {
  version: 1;
  scope: RelayNavigationScope;
  after: RelayQueuePosition;
  highWater: RelayQueuePosition;
  startedAtMs: number;
}

export class InvalidRelayCursorError extends Error {
  constructor() { super('Invalid relay navigation.'); }
}

function validScope(scope: RelayNavigationScope): boolean {
  return [scope.familyId, scope.recipientDeviceId].every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 128)
    && /^[0-9a-f]{64}$/.test(scope.sessionIncarnation);
}

export function validateRelayNavigationScope(scope: RelayNavigationScope): void {
  if (!validScope(scope)) throw new InvalidRelayCursorError();
}

/**
 * Deliberately unsigned navigation: tampering cannot grant scope, acceptance
 * or ACK authority. Highwater/age bound cooperating clients, not a signed
 * snapshot. An authenticated caller can change its own navigation; security
 * resource bounds are enforced independently on every repository request.
 */
export function decodeRelayContinuation(cursor: string, scope: RelayNavigationScope, now: Date): RelayContinuation {
  try {
    if (!validScope(scope) || typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_RELAY_CURSOR_BYTES
        || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidRelayCursorError();
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new InvalidRelayCursorError();
    const raw: unknown = JSON.parse(bytes.toString('utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidRelayCursorError();
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).length !== 5 || value.version !== 1
        || !isRelayQueuePosition(value.after) || !isRelayQueuePosition(value.highWater)
        || compareRelayQueuePositions(value.after, value.highWater) >= 0
        || !Number.isSafeInteger(value.startedAtMs)
        || (value.startedAtMs as number) > now.getTime()
        || now.getTime() - (value.startedAtMs as number) >= RELAY_CAMPAIGN_TTL_MS
        || typeof value.scope !== 'object' || value.scope === null || Array.isArray(value.scope)) throw new InvalidRelayCursorError();
    const suppliedScope = value.scope as Record<string, unknown>;
    if (Object.keys(suppliedScope).length !== 3 || suppliedScope.familyId !== scope.familyId
        || suppliedScope.recipientDeviceId !== scope.recipientDeviceId
        || suppliedScope.sessionIncarnation !== scope.sessionIncarnation) throw new InvalidRelayCursorError();
    return { version: 1, scope, after: value.after, highWater: value.highWater, startedAtMs: value.startedAtMs as number };
  } catch { throw new InvalidRelayCursorError(); }
}

export function encodeRelayContinuation(continuation: RelayContinuation): string {
  const cursor = Buffer.from(JSON.stringify(continuation), 'utf8').toString('base64url');
  // Apply the same shape and scope validation before returning a server cursor.
  decodeRelayContinuation(cursor, continuation.scope, new Date(continuation.startedAtMs));
  return cursor;
}
