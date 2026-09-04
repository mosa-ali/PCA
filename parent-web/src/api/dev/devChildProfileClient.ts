import type { ChildProfileClient, ChildProfileDto, CreateChildProfileInput } from '../childProfileClient';

const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));

interface DevChildProfileRecord extends ChildProfileDto {
  familyId: string;
}

/**
 * Default demo state seeds the SAME two children (id + family) the old
 * getDashboard()-backed DEV_CHILDREN fixture (../dev/fixtures.ts) always
 * provided, so a fresh demo-mode page load -- e2e/*.spec.ts's fixture-mode
 * suite included -- still has a populated registry to walk the Add-device
 * wizard against, exactly as it did before this registry existed. Their
 * readable labels are seeded separately in ../client.ts's buildDevClients
 * (this module deliberately does not import ../../domain/childLabels
 * itself -- see __seedDevChildProfile's own comment below). Every vitest
 * test that needs a genuinely empty registry already calls
 * __resetDevChildProfileState() in its own beforeEach, so this default
 * never leaks into those.
 */
function defaultDevRecords(): DevChildProfileRecord[] {
  const now = new Date().toISOString();
  return [
    { childProfileId: 'child-amir', familyId: 'dev-family-1', createdAt: now },
    { childProfileId: 'child-lina', familyId: 'dev-family-1', createdAt: now },
  ];
}

let records: DevChildProfileRecord[] = defaultDevRecords();
let recordsByIdempotencyKey: Map<string, DevChildProfileRecord> = new Map();
let seq = 0;

/** Test/dev-only reset hook so fixture state doesn't leak between test cases. */
export function __resetDevChildProfileState(): void {
  records = [];
  recordsByIdempotencyKey = new Map();
  seq = 0;
}

/**
 * Test/dev-only convenience: seeds a KNOWN opaque entry, matching how a
 * previous session would have created it (server-minted id, no readable
 * name persisted centrally). Callers wanting the seeded child to render by
 * a readable name must also call ../domain/childLabels.ts's setChildLabel --
 * this function deliberately does not import that module, so the dev API
 * layer never implicitly reaches into a different layer's storage.
 */
export function __seedDevChildProfile(familyId: string, childProfileId: string): void {
  const record: DevChildProfileRecord = { childProfileId, familyId, createdAt: new Date().toISOString() };
  records.push(record);
}

function nextId(): string {
  seq += 1;
  return `child-dev-${seq}`;
}

/** Demo-mode fixture. Same field/behaviour invariants as the real client -- see ../childProfileClient.ts's header: no displayName field exists to accept or return. */
export class DevChildProfileClient implements ChildProfileClient {
  async createChildProfile(familyId: string, input?: CreateChildProfileInput): Promise<ChildProfileDto> {
    await delay();
    const dedupeKey = input?.idempotencyKey ? `${familyId}:${input.idempotencyKey}` : null;
    if (dedupeKey) {
      const existing = recordsByIdempotencyKey.get(dedupeKey);
      if (existing) return { childProfileId: existing.childProfileId, createdAt: existing.createdAt };
    }
    const record: DevChildProfileRecord = { childProfileId: nextId(), familyId, createdAt: new Date().toISOString() };
    records.push(record);
    if (dedupeKey) recordsByIdempotencyKey.set(dedupeKey, record);
    return { childProfileId: record.childProfileId, createdAt: record.createdAt };
  }

  async listChildProfiles(familyId: string): Promise<ChildProfileDto[]> {
    await delay();
    return records
      .filter((record) => record.familyId === familyId)
      .map((record) => ({ childProfileId: record.childProfileId, createdAt: record.createdAt }));
  }
}
