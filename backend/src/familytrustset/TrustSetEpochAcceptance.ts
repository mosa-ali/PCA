import { canonicalizeTrustSetEpoch } from './canonicalize.js';
import { decodeCanonicalTrustSetEpoch } from './decode.js';
import { activeOwnerCount, findActiveOwner, findDuplicateIdentity } from './FamilyTrustSetEngine.js';
import {
  isDistinctKeyPair,
  isPlausibleOpaqueId,
  isPlausibleSignature,
  MIN_TRUST_SET_EPOCH,
} from './policy.js';
import type { EpochFloorStore } from './EpochFloorStore.js';
import type { GenesisAnchorSource } from './GenesisAnchorSource.js';
import type { KeyEpochStore } from './KeyEpochStore.js';
import type { TrustSetEpochRecord, TrustSetEpochStore } from './TrustSetEpochStore.js';
import type { TrustSetSignatureVerifier } from './TrustSetSignatureVerifier.js';
import type { FamilyTrustSetEntry, FamilyTrustSetEpoch, OpaqueFamilyId } from './types.js';

/**
 * The server-side acceptance gate for signed Family Trust Set epochs: the
 * ONE flow that may turn an untrusted candidate submission into (at most)
 * one `appendAcceptedEpoch` call. `appendAcceptedEpoch` stays the
 * authoritative serialization point (duplicate/floors re-checked inside its
 * own transaction); everything here is the judgement that must be complete
 * BEFORE that call -- "VERIFY COMPLETELY -> ACCEPT -> append strictly
 * last". Nothing is ever written by a rejection path.
 *
 * Pipeline, strictly in this order:
 *
 *   0. Candidate-envelope bounds (cheap, before any decode or crypto):
 *      family id, signature and timestamp shapes, and the opaque signed
 *      blob size -- all mirrored from the store's own append bounds so the
 *      record this flow eventually builds can never be refused
 *      INVALID_INPUT by the store.
 *   1. Strict decode of `signedCanonicalBytes`, then the engine's own
 *      structural rules re-enforced on the decoded epoch (exactly one
 *      ACTIVE OWNER entry, DSK/DEK distinct per entry, no reused
 *      device/key identity across entries). Any decode failure or
 *      structural violation is MALFORMED_CANDIDATE, with no reason leaked
 *      about which byte was wrong.
 *   2. Bind the payload's `familyId` to the requested family.
 *   3. Byte identity: `canonicalizeTrustSetEpoch(decoded)` must EQUAL the
 *      submitted bytes. The exact bytes covered by the signature are the
 *      exact bytes persisted; anything a permissive decoder normalised
 *      away can never become a persistence divergence.
 *   4. Pin the epoch-number floors at the protocol minimum: keyEpoch >= 1
 *      (owner decision #10 -- 0 means "no key generation ever", never a
 *      legitimate epoch) and trustSetEpoch >= 1.
 *   5. Read the durable acceptance state -- latest accepted epoch,
 *      canonical key epoch, floors -- NEVER from caller input, and never
 *      coalescing a read failure to `null`: `null` must only ever mean
 *      "genuinely never initialised" (anti-TFU). Read errors PROPAGATE.
 *   6. GENESIS path (no epoch has ever been accepted): only epoch 1, only
 *      with `supersedesEpoch === null`, and the candidate's ACTIVE OWNER
 *      must exactly match the family's durable genesis anchor
 *      (deviceId + DSK key id + DSK public key) -- the anchor is what
 *      makes first-use trust TOFU-safe on the server side. The signature
 *      is then verified against the ANCHOR's key, never against a
 *      candidate-chosen key.
 *   7. CHAIN path: a candidate below the latest accepted trust-set epoch
 *      is STALE_TRUST_SET_EPOCH. The ONE authorized signer is the latest
 *      accepted epoch's ACTIVE OWNER entry (re-decoded from the stored
 *      bytes); the candidate must contain an ACTIVE OWNER entry with the
 *      same (deviceId, dskKeyId, dskPublicKey) triple or it is
 *      SIGNER_NOT_AUTHORIZED -- a candidate that revokes its own previous
 *      signer cannot self-authorize a new owner. Equality with the latest
 *      epoch is the REPLAY path and is still FULLY verified here; only the
 *      store may resolve it as idempotent vs conflict.
 *   8. Durable-state consistency (fail closed with a throw, never a
 *      silent genesis fallback) plus the monotonic floors: below the key
 *      floor -> STALE_KEY_EPOCH; below the trust-set floor ->
 *      STALE_TRUST_SET_EPOCH.
 *   9. `supersedesEpoch` is lineage metadata only -- null is allowed on
 *      non-genesis (types.ts: no exact N -> N+1 requirement), but a
 *      non-null value must name a durably ACCEPTED epoch of this family,
 *      otherwise UNKNOWN_PREDECESSOR.
 *  10. Claimed side metadata (Section 12) must EQUAL the values derived
 *      from the verified payload and the resolved signer, otherwise
 *      SIDE_METADATA_CONFLICT.
 *  11. Only now: build the TrustSetEpochRecord and append it. Outcome
 *      mapping: APPENDED -> ACCEPTED; IDEMPOTENT_MATCH -> IDEMPOTENT;
 *      CONFLICT -> CONFLICT; REJECTED_STALE -> REJECTED with the same
 *      reason.
 */

/**
 * Minimum accepted key epoch: pinned >= 1 across every layer (owner
 * decision #10; migration 0060 CHECKs; MySqlTrustSetEpochStore record
 * validation). A candidate below it is STALE_KEY_EPOCH even at genesis.
 */
const MIN_KEY_EPOCH = 1;

/**
 * Store-bound mirrors of MySqlTrustSetEpochStore's own record validation
 * (assertValidAppendRecord): signer identity fields are bounded at 64
 * characters and the opaque signed blob at 256 KiB. Enforcing them here
 * keeps the invariant "appendAcceptedEpoch never throws INVALID_INPUT for
 * a record this flow built" true by construction.
 */
const MAX_SIGNER_ID_LENGTH = 64;
const MAX_SIGNED_EPOCH_BYTES = 262_144;

export type TrustSetEpochAcceptanceRejectionReason =
  | 'MALFORMED_CANDIDATE'
  | 'FAMILY_MISMATCH'
  | 'CANONICAL_BYTES_MISMATCH'
  | 'NON_GENESIS_FIRST_EPOCH'
  | 'GENESIS_UNKNOWN_ANCHOR'
  | 'INVALID_GENESIS_SIGNER'
  | 'STALE_TRUST_SET_EPOCH'
  | 'STALE_KEY_EPOCH'
  | 'STALE_AUTHORITY'
  | 'UNKNOWN_PREDECESSOR'
  | 'SIGNER_NOT_AUTHORIZED'
  | 'SIGNATURE_INVALID'
  | 'SIDE_METADATA_CONFLICT';

export type TrustSetEpochAcceptanceResult =
  | { outcome: 'ACCEPTED' }
  | { outcome: 'IDEMPOTENT' }
  | { outcome: 'CONFLICT' }
  | { outcome: 'REJECTED'; reason: TrustSetEpochAcceptanceRejectionReason };

export interface TrustSetEpochAcceptanceDeps {
  epochStore: TrustSetEpochStore;
  keyEpochStore: KeyEpochStore;
  floorStore: EpochFloorStore;
  genesisAnchorSource: GenesisAnchorSource;
  verifier: TrustSetSignatureVerifier;
}

export interface TrustSetEpochAcceptanceInput {
  familyId: OpaqueFamilyId;
  signedCanonicalBytes: string;
  signature: string;
  receivedAt: Date;
  claimedSideMetadata?: {
    signerKeyId?: string;
    signerDeviceId?: string;
    supersedesEpoch?: number | null;
    issuedAt?: Date;
  };
}

/**
 * Pure consistency predicate for the durable read set: returns a
 * description of the first mismatch, or null when the three views agree
 * on the same moment. `latest === null` permits only a never-used floors
 * row (the (1,1) seed a prior rejected append may have left behind) and no
 * canonical key-epoch view.
 */
function describeStateInconsistency(
  latest: TrustSetEpochRecord | null,
  canonicalKeyEpoch: { trustSetEpoch: number; keyEpoch: number } | null,
  floors: { minimumAcceptedTrustSetEpoch: number; minimumAcceptedKeyEpoch: number } | null,
): string | null {
  if (latest === null) {
    if (canonicalKeyEpoch !== null) {
      return 'the canonical key-epoch view reports an accepted epoch while the epoch store reports none';
    }
    if (
      floors !== null &&
      (floors.minimumAcceptedTrustSetEpoch !== MIN_TRUST_SET_EPOCH || floors.minimumAcceptedKeyEpoch !== MIN_KEY_EPOCH)
    ) {
      return 'the acceptance floors advanced past their seed while the epoch store reports no accepted epoch';
    }
    return null;
  }
  if (floors === null) {
    return 'an accepted epoch exists but the family has no acceptance floors row';
  }
  if (canonicalKeyEpoch === null) {
    return 'an accepted epoch exists but the canonical key-epoch view reports none';
  }
  if (canonicalKeyEpoch.trustSetEpoch !== latest.trustSetEpoch || canonicalKeyEpoch.keyEpoch !== latest.keyEpoch) {
    return 'the canonical key-epoch view disagrees with the latest accepted epoch record';
  }
  if (
    floors.minimumAcceptedTrustSetEpoch !== latest.trustSetEpoch ||
    floors.minimumAcceptedKeyEpoch !== latest.keyEpoch
  ) {
    return 'the acceptance floors disagree with the latest accepted epoch record';
  }
  return null;
}

export class TrustSetEpochAcceptanceService {
  private readonly deps: TrustSetEpochAcceptanceDeps;

  constructor(deps: TrustSetEpochAcceptanceDeps) {
    this.deps = deps;
  }

  /**
   * Read the durable acceptance state as ONE consistent set: the latest
   * accepted epoch, the canonical key-epoch view, and the acceptance
   * floors must all describe the same moment. Because the three reads are
   * separate statements (no shared snapshot), a concurrent acceptance
   * commit can legally interleave, producing a transiently mixed view --
   * that case is retried with bounded re-reads. A mismatch that persists
   * across attempts is treated as real corruption and throws: acceptance
   * must never evaluate a candidate against a state where the floors have
   * moved past the epoch record they were derived from.
   */
  private async readConsistentState(familyId: OpaqueFamilyId): Promise<{
    latest: TrustSetEpochRecord | null;
    canonicalKeyEpoch: { trustSetEpoch: number; keyEpoch: number } | null;
    floors: { minimumAcceptedTrustSetEpoch: number; minimumAcceptedKeyEpoch: number } | null;
  }> {
    const MAX_CONSISTENT_READ_ATTEMPTS = 3;
    let lastInconsistency = '';
    for (let attempt = 1; attempt <= MAX_CONSISTENT_READ_ATTEMPTS; attempt += 1) {
      const [latest, canonicalKeyEpoch, floors] = await Promise.all([
        this.deps.epochStore.readLatestEpoch(familyId),
        this.deps.keyEpochStore.readCanonicalKeyEpoch(familyId),
        this.deps.floorStore.readFloors(familyId),
      ]);
      const inconsistency = describeStateInconsistency(latest, canonicalKeyEpoch, floors);
      if (inconsistency === null) return { latest, canonicalKeyEpoch, floors };
      lastInconsistency = inconsistency;
    }
    throw inconsistentState(lastInconsistency);
  }

  async acceptCandidate(input: TrustSetEpochAcceptanceInput): Promise<TrustSetEpochAcceptanceResult> {
    // ---- 0. Candidate-envelope bounds (cheap, before decode/crypto) ----
    if (!isPlausibleOpaqueId(input.familyId)) return rejected('MALFORMED_CANDIDATE');
    if (!isPlausibleSignature(input.signature)) return rejected('MALFORMED_CANDIDATE');
    if (!isValidDate(input.receivedAt)) return rejected('MALFORMED_CANDIDATE');
    const signedByteLength = Buffer.byteLength(input.signedCanonicalBytes, 'utf8');
    if (signedByteLength < 1 || signedByteLength > MAX_SIGNED_EPOCH_BYTES) return rejected('MALFORMED_CANDIDATE');

    // ---- 1. Strict decode + structural engine rules ----
    let epoch: FamilyTrustSetEpoch;
    try {
      epoch = decodeCanonicalTrustSetEpoch(input.signedCanonicalBytes);
    } catch {
      // Any decode failure is a structurally unusable candidate; no detail
      // about the offending byte is leaked back to the submitter.
      return rejected('MALFORMED_CANDIDATE');
    }
    if (activeOwnerCount(epoch.entries) !== 1) return rejected('MALFORMED_CANDIDATE');
    for (const entry of epoch.entries) {
      if (!isDistinctKeyPair(entry.dskPublicKey, entry.dekPublicKey)) return rejected('MALFORMED_CANDIDATE');
    }
    if (findDuplicateIdentity(epoch.entries)) return rejected('MALFORMED_CANDIDATE');
    if (typeof epoch.trustSetEpoch !== 'number' || !Number.isInteger(epoch.trustSetEpoch)) {
      return rejected('MALFORMED_CANDIDATE');
    }
    if (typeof epoch.keyEpoch !== 'number' || !Number.isInteger(epoch.keyEpoch)) {
      return rejected('MALFORMED_CANDIDATE');
    }
    if (!isValidDate(epoch.issuedAt)) return rejected('MALFORMED_CANDIDATE');
    const activeOwner = findActiveOwner(epoch);
    // `activeOwner` is guaranteed non-null by the exactly-one-ACTIVE-OWNER
    // check above; the guard stays so a future refactor cannot silently
    // dereference null.
    if (activeOwner === null) return rejected('MALFORMED_CANDIDATE');
    if (
      activeOwner.deviceId.length === 0 ||
      activeOwner.deviceId.length > MAX_SIGNER_ID_LENGTH ||
      activeOwner.dskKeyId.length === 0 ||
      activeOwner.dskKeyId.length > MAX_SIGNER_ID_LENGTH
    ) {
      return rejected('MALFORMED_CANDIDATE');
    }

    // ---- 2. Family binding ----
    if (epoch.familyId !== input.familyId) return rejected('FAMILY_MISMATCH');

    // ---- 3. Byte identity: signed bytes == canonical bytes == persisted bytes ----
    // With decode.ts this is defense-in-depth (a strict inverse rejects
    // non-canonical inputs first), but the persistence invariant must not
    // depend on the decoder's strictness: whatever decodes must
    // re-canonicalize to the exact same bytes before anything is appended.
    if (canonicalizeTrustSetEpoch(epoch) !== input.signedCanonicalBytes) return rejected('CANONICAL_BYTES_MISMATCH');

    // ---- 4. Protocol-minimum epoch numbers ----
    if (epoch.keyEpoch < MIN_KEY_EPOCH) return rejected('STALE_KEY_EPOCH');
    if (epoch.trustSetEpoch < MIN_TRUST_SET_EPOCH) return rejected('MALFORMED_CANDIDATE');

    // ---- 5. Durable acceptance state (read failures propagate) ----
    // The three reads are not one snapshot: a concurrent acceptance can
    // commit between them, so a transiently mixed view (e.g. floors already
    // advanced while `latest` is still the previous epoch) is retried with
    // bounded re-reads. A STABLE mismatch is real corruption and throws --
    // decisions must never be based on a view where the floors moved past
    // the epoch record they were derived from (that would let a candidate
    // be verified against a superseded signer set).
    const { latest, canonicalKeyEpoch, floors } = await this.readConsistentState(input.familyId);

    let resolvedSigner: FamilyTrustSetEntry;

    if (latest === null) {
      // ---- 6. GENESIS path: no epoch has EVER been durably accepted ----
      if (epoch.trustSetEpoch !== MIN_TRUST_SET_EPOCH) return rejected('NON_GENESIS_FIRST_EPOCH');
      if (epoch.supersedesEpoch !== null) return rejected('UNKNOWN_PREDECESSOR');

      const anchor = await this.deps.genesisAnchorSource.readGenesisAnchor(input.familyId);
      if (anchor === null) return rejected('GENESIS_UNKNOWN_ANCHOR');
      if (
        activeOwner.deviceId !== anchor.genesisDeviceId ||
        activeOwner.dskKeyId !== anchor.genesisDskKeyId ||
        activeOwner.dskPublicKey !== anchor.genesisDskPublicKey
      ) {
        return rejected('INVALID_GENESIS_SIGNER');
      }
      const signatureValid = await this.deps.verifier.verify(
        anchor.genesisDskPublicKey,
        input.signedCanonicalBytes,
        input.signature,
      );
      if (!signatureValid) return rejected('SIGNATURE_INVALID');
      resolvedSigner = activeOwner;
    } else {
      // ---- 7. CHAIN path: an accepted epoch exists ----
      // Replay (equality) is NOT rejected here -- it is fully verified
      // below and only the store may resolve it as IDEMPOTENT/CONFLICT.
      if (epoch.trustSetEpoch < latest.trustSetEpoch) return rejected('STALE_TRUST_SET_EPOCH');

      let latestEpoch: FamilyTrustSetEpoch;
      try {
        latestEpoch = decodeCanonicalTrustSetEpoch(latest.signedEpochBytes.toString('utf8'));
      } catch {
        // Unreadable durable state: refuse loudly rather than guess a
        // signer or fall back to first-use trust.
        throw inconsistentState(
          'the latest durably accepted epoch failed strict decode; its stored bytes are not a valid canonical epoch',
        );
      }
      const storedOwner = findActiveOwner(latestEpoch);
      if (
        storedOwner === null ||
        activeOwner.deviceId !== storedOwner.deviceId ||
        activeOwner.dskKeyId !== storedOwner.dskKeyId ||
        activeOwner.dskPublicKey !== storedOwner.dskPublicKey
      ) {
        return rejected('SIGNER_NOT_AUTHORIZED');
      }
      const signatureValid = await this.deps.verifier.verify(
        storedOwner.dskPublicKey,
        input.signedCanonicalBytes,
        input.signature,
      );
      if (!signatureValid) return rejected('SIGNATURE_INVALID');
      resolvedSigner = storedOwner;
    }

    // ---- 8. Monotonic floors (read-set consistency is enforced by
    // readConsistentState above) ----
    if (floors !== null) {
      if (epoch.keyEpoch < floors.minimumAcceptedKeyEpoch) return rejected('STALE_KEY_EPOCH');
      if (epoch.trustSetEpoch < floors.minimumAcceptedTrustSetEpoch) return rejected('STALE_TRUST_SET_EPOCH');
    }

    // ---- 9. Lineage metadata (supersedes) ----
    // Null is legitimate on non-genesis epochs -- types.ts: lineage/audit
    // metadata only, never an exact N -> N+1 requirement.
    if (epoch.supersedesEpoch !== null) {
      if (epoch.supersedesEpoch < MIN_TRUST_SET_EPOCH || epoch.supersedesEpoch >= epoch.trustSetEpoch) {
        return rejected('UNKNOWN_PREDECESSOR');
      }
      if (latest !== null && epoch.supersedesEpoch > latest.trustSetEpoch) {
        return rejected('UNKNOWN_PREDECESSOR');
      }
      const acceptedEpochs = await this.deps.epochStore.listEpochs(input.familyId);
      if (!acceptedEpochs.some((record) => record.trustSetEpoch === epoch.supersedesEpoch)) {
        return rejected('UNKNOWN_PREDECESSOR');
      }
    }

    // ---- 10. Claimed side metadata must equal the derived values ----
    const claimed = input.claimedSideMetadata;
    if (claimed !== undefined) {
      if (claimed.signerDeviceId !== undefined && claimed.signerDeviceId !== resolvedSigner.deviceId) {
        return rejected('SIDE_METADATA_CONFLICT');
      }
      if (claimed.signerKeyId !== undefined && claimed.signerKeyId !== resolvedSigner.dskKeyId) {
        return rejected('SIDE_METADATA_CONFLICT');
      }
      if (claimed.supersedesEpoch !== undefined && claimed.supersedesEpoch !== epoch.supersedesEpoch) {
        return rejected('SIDE_METADATA_CONFLICT');
      }
      if (
        claimed.issuedAt !== undefined &&
        (!(claimed.issuedAt instanceof Date) || claimed.issuedAt.getTime() !== epoch.issuedAt.getTime())
      ) {
        return rejected('SIDE_METADATA_CONFLICT');
      }
    }

    // ---- 11. Build the record and append (the ONLY write in this flow) ----
    const record: TrustSetEpochRecord = {
      familyId: epoch.familyId,
      trustSetEpoch: epoch.trustSetEpoch,
      keyEpoch: epoch.keyEpoch,
      supersedesEpoch: epoch.supersedesEpoch,
      signedEpochBytes: Buffer.from(input.signedCanonicalBytes, 'utf8'),
      signature: input.signature,
      signerKeyId: resolvedSigner.dskKeyId,
      signerDeviceId: resolvedSigner.deviceId,
      issuedAt: epoch.issuedAt,
      receivedAt: input.receivedAt,
    };
    const expectedHead = latest === null
      ? null
      : {
          trustSetEpoch: latest.trustSetEpoch,
          keyEpoch: latest.keyEpoch,
          signedEpochBytes: Buffer.from(latest.signedEpochBytes),
          signature: latest.signature,
        };
    const appended = await this.deps.epochStore.appendAcceptedEpoch(record, expectedHead);
    switch (appended.outcome) {
      case 'APPENDED':
        return { outcome: 'ACCEPTED' };
      case 'IDEMPOTENT_MATCH':
        return { outcome: 'IDEMPOTENT' };
      case 'CONFLICT':
        return { outcome: 'CONFLICT' };
      case 'REJECTED_STALE_AUTHORITY':
        return { outcome: 'REJECTED', reason: 'STALE_AUTHORITY' };
      case 'REJECTED_STALE':
        return { outcome: 'REJECTED', reason: appended.reason };
      default:
        return assertNever(appended);
    }
  }
}

function rejected(reason: TrustSetEpochAcceptanceRejectionReason): TrustSetEpochAcceptanceResult {
  return { outcome: 'REJECTED', reason };
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function inconsistentState(detail: string): Error {
  return new Error(`Family trust set acceptance refused: inconsistent durable state -- ${detail}`);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled append outcome: ${JSON.stringify(value)}`);
}
