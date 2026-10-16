import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execute, runInTransaction } from '../db/pool.js';
import { decodeCanonicalTrustSetEpochBytes } from '../familytrustset/decode.js';
import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';
import { isCanonicalP256Signature, strictBase64Url } from '../deviceauth/P256DeviceSignatureVerifier.js';
import type { DevicePolicyApplicationProofTranscript } from './protocol.js';
import { canonicalizeDevicePolicyApplicationProof, devicePolicyProofDigests, DEVICE_POLICY_PROOF_TOMBSTONE_TTL_MS } from './protocol.js';

interface FloorRow { minimum_accepted_trust_set_epoch: number | string | bigint; minimum_accepted_key_epoch: number | string | bigint }
interface HeadRow { trust_set_epoch: number | string | bigint; key_epoch: number | string | bigint; signed_epoch_bytes: Buffer }
interface DeviceRow {
  device_id: string; family_id: string; status: string; revoked_at: Date | null;
  family_status?: string; family_deleted_at?: Date | null;
}
interface KeyRow { key_id: string; key_purpose: string; public_key: string; status: string }
interface TargetRow {
  family_id: string; target_generation: number | string | bigint; policy_message_id: string;
  policy_envelope_sha256: Buffer; canonical_envelope_bytes: Buffer | null; envelope_signature: Buffer | null;
  policy_envelope_expires_at: Date | null;
  trust_set_epoch: number | string | bigint; key_epoch: number | string | bigint; target_state: string;
  challenge_id: string | null; challenge_nonce_hash: Buffer | null; challenge_expires_at: Date | null;
  challenge_consumed_at: Date | null;
}
interface ProofRow { exact_request_sha256: Buffer; activation_outcome: 'ACTIVATED' | 'RECORDED_NOT_ACTIVATED'; application_result: string; retention_expires_at: Date }

export interface CommitDevicePolicyApplicationProofInput {
  transcript: DevicePolicyApplicationProofTranscript;
  challengeNonceBytes: Buffer;
  deviceKeyId: string;
  dskPublicKey: string;
  transcriptSha256: Buffer;
  exactRequestSha256: Buffer;
}

export type CommitDevicePolicyApplicationProofResult =
  | { outcome: 'ACTIVATED' | 'RECORDED_NOT_ACTIVATED'; idempotent: boolean }
  | { outcome: 'CONFLICT' | 'REJECTED' };

const asNumber = (value: number | string | bigint | null): number => Number(value);

/** Durable authority boundary for proof commit, challenge consumption and PAIRED -> ACTIVE. */
export class MySqlDevicePolicyApplicationProofStore {
  /** Production composition stays false until approved receiver crypto/enforcement is actually wired. */
  constructor(private readonly receiverCryptoReady: () => boolean = () => false) {}

  /** Rechecks live PAIRED/DSK/Trust Set/target authority for every bearer use. */
  async isCurrentPairedBootstrapSession(familyId: string, deviceId: string, dskKeyId: string,
                                       targetGeneration: number, challengeId: string): Promise<boolean> {
    return runInTransaction(async (conn) => {
      const { rows: floors } = await execute<FloorRow>(conn,
        `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
           FROM family_epoch_floors WHERE family_id = ? FOR UPDATE`, [familyId]);
      const floor = floors[0];
      if (!floor) return false;
      const { rows: devices } = await execute<DeviceRow>(conn,
        `SELECT d.device_id, d.family_id, d.status, d.revoked_at, f.status AS family_status, f.deleted_at AS family_deleted_at
           FROM devices d JOIN families f ON f.family_id = d.family_id
          WHERE d.device_id = ? AND d.family_id = ? FOR UPDATE`, [deviceId, familyId]);
      const device = devices[0];
      if (!device || device.status !== 'PAIRED' || device.revoked_at !== null ||
          device.family_status !== 'ACTIVE' || device.family_deleted_at !== null) return false;
      const { rows: heads } = await execute<HeadRow>(conn,
        `SELECT trust_set_epoch, key_epoch, signed_epoch_bytes FROM family_trust_set_epochs
          WHERE family_id = ? ORDER BY trust_set_epoch DESC LIMIT 1 FOR UPDATE`, [familyId]);
      const head = heads[0];
      if (!head || asNumber(head.trust_set_epoch) !== asNumber(floor.minimum_accepted_trust_set_epoch) ||
          asNumber(head.key_epoch) !== asNumber(floor.minimum_accepted_key_epoch)) return false;
      let epoch;
      try { epoch = decodeCanonicalTrustSetEpochBytes(head.signed_epoch_bytes); }
      catch { return false; }
      const { rows: keys } = await execute<KeyRow>(conn,
        `SELECT key_id, key_purpose, public_key, status FROM device_public_keys
          WHERE device_id = ? AND key_id = ? FOR UPDATE`, [deviceId, dskKeyId]);
      const key = keys[0];
      if (!key || key.key_purpose !== 'DSK' || key.status !== 'ACTIVE' ||
          !epoch.entries.some((entry) => entry.deviceId === deviceId && entry.status === 'ACTIVE' &&
            entry.dskKeyId === key.key_id && entry.dskPublicKey === key.public_key)) return false;
      const { rows: targets } = await execute<TargetRow>(conn,
        `SELECT * FROM device_policy_activation_targets WHERE device_id = ? FOR UPDATE`, [deviceId]);
      const target = targets[0];
      const { rows: clocks } = await execute<{ now_utc: Date }>(conn, `SELECT UTC_TIMESTAMP(3) AS now_utc`);
      const now = clocks[0]?.now_utc;
      return !!target && now instanceof Date && target.family_id === familyId && target.target_state === 'PENDING' &&
        asNumber(target.target_generation) === targetGeneration && target.challenge_id === challengeId &&
        target.challenge_consumed_at === null && target.challenge_expires_at !== null && target.challenge_expires_at.getTime() > now.getTime() &&
        target.policy_envelope_expires_at !== null && target.policy_envelope_expires_at.getTime() > now.getTime() &&
        asNumber(target.trust_set_epoch) === epoch.trustSetEpoch && asNumber(target.key_epoch) === epoch.keyEpoch &&
        asNumber(target.trust_set_epoch) === asNumber(floor.minimum_accepted_trust_set_epoch) &&
        asNumber(target.key_epoch) === asNumber(floor.minimum_accepted_key_epoch);
    });
  }

  /** Response-loss recovery reveals only the outcome for the exact committed request digest. */
  async recoverExactProof(challengeId: string, exactRequestSha256: string): Promise<{
    outcome: 'ACTIVATED' | 'RECORDED_NOT_ACTIVATED';
  } | null> {
    let digest: Buffer;
    try {
      digest = strictBase64Url(exactRequestSha256);
      if (digest.length !== 32 || digest.toString('base64url') !== exactRequestSha256) return null;
    } catch { return null; }
    return runInTransaction(async (conn) => {
      const { rows: clockRows } = await execute<{ now_utc: Date }>(conn, `SELECT UTC_TIMESTAMP(3) AS now_utc`);
      const now = clockRows[0]?.now_utc;
      if (!(now instanceof Date)) return null;
      const { rows } = await execute<ProofRow>(conn,
        `SELECT exact_request_sha256, activation_outcome, application_result, retention_expires_at
           FROM device_policy_application_proofs WHERE challenge_id = ?`, [challengeId]);
      const proof = rows[0];
      if (!proof || proof.retention_expires_at.getTime() <= now.getTime() || !proof.exact_request_sha256.equals(digest)) return null;
      return { outcome: proof.activation_outcome };
    });
  }

  async submitSignedProof(
    transcript: DevicePolicyApplicationProofTranscript,
    signature: string,
    signatureVerifier: DeviceSignatureVerifier,
  ): Promise<CommitDevicePolicyApplicationProofResult> {
    let transcriptBytes: Buffer;
    let digests: ReturnType<typeof devicePolicyProofDigests>;
    let nonceBytes: Buffer;
    try {
      transcriptBytes = canonicalizeDevicePolicyApplicationProof(transcript);
      nonceBytes = strictBase64Url(transcript.challengeNonce);
      digests = devicePolicyProofDigests(transcriptBytes, signature);
      if (!isCanonicalP256Signature(signature)) return { outcome: 'REJECTED' };
    } catch { return { outcome: 'REJECTED' }; }

    const prior = await runInTransaction(async (conn) => {
      const { rows: clockRows } = await execute<{ now_utc: Date }>(conn, `SELECT UTC_TIMESTAMP(3) AS now_utc`);
      const now = clockRows[0]?.now_utc;
      if (!(now instanceof Date)) return { outcome: 'REJECTED' } as const;
      const { rows } = await execute<ProofRow>(conn,
        `SELECT exact_request_sha256, activation_outcome, application_result, retention_expires_at
           FROM device_policy_application_proofs WHERE challenge_id = ?`, [transcript.challengeId]);
      const row = rows[0];
      if (!row || row.retention_expires_at.getTime() <= now.getTime()) return null;
      if (!row.exact_request_sha256.equals(digests.exactRequestSha256)) return { outcome: 'CONFLICT' } as const;
      return { outcome: row.activation_outcome, idempotent: true } as const;
    });
    if (prior) return prior;

    const key = await this.resolveCurrentProofKey(transcript);
    if (!key || !await signatureVerifier.verify(key.publicKey, transcriptBytes.toString('utf8'), signature)) {
      return { outcome: 'REJECTED' };
    }
    return this.commitVerifiedProof({ transcript, challengeNonceBytes: nonceBytes, deviceKeyId: key.keyId,
      dskPublicKey: key.publicKey, transcriptSha256: digests.transcriptSha256, exactRequestSha256: digests.exactRequestSha256 });
  }

  private async resolveCurrentProofKey(transcript: DevicePolicyApplicationProofTranscript): Promise<{
    keyId: string; publicKey: string;
  } | null> {
    return runInTransaction(async (conn) => {
      const { rows: floorRows } = await execute<FloorRow>(conn,
        `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch FROM family_epoch_floors WHERE family_id = ?`,
        [transcript.familyId]);
      const floor = floorRows[0];
      if (!floor || asNumber(floor.minimum_accepted_trust_set_epoch) !== transcript.trustSetEpoch ||
          asNumber(floor.minimum_accepted_key_epoch) !== transcript.keyEpoch) return null;
      const { rows: devices } = await execute<DeviceRow>(conn,
        `SELECT device_id, family_id, status, revoked_at FROM devices WHERE device_id = ? AND family_id = ?`,
        [transcript.deviceId, transcript.familyId]);
      const device = devices[0];
      if (!device || device.status !== 'PAIRED' || device.revoked_at !== null) return null;
      const { rows: headRows } = await execute<HeadRow>(conn,
        `SELECT trust_set_epoch, key_epoch, signed_epoch_bytes FROM family_trust_set_epochs
          WHERE family_id = ? ORDER BY trust_set_epoch DESC LIMIT 1`, [transcript.familyId]);
      const head = headRows[0];
      if (!head || asNumber(head.trust_set_epoch) !== transcript.trustSetEpoch || asNumber(head.key_epoch) !== transcript.keyEpoch) return null;
      let epoch;
      try { epoch = decodeCanonicalTrustSetEpochBytes(head.signed_epoch_bytes); }
      catch { return null; }
      const members = epoch.entries.filter((entry) => entry.deviceId === transcript.deviceId && entry.status === 'ACTIVE');
      if (members.length !== 1) return null;
      const { rows: keys } = await execute<KeyRow>(conn,
        `SELECT key_id, key_purpose, public_key, status FROM device_public_keys WHERE device_id = ?`, [transcript.deviceId]);
      const member = members[0]!;
      const candidates = keys.filter((candidate) => candidate.key_id === member.dskKeyId && candidate.key_purpose === 'DSK' &&
        candidate.status === 'ACTIVE' && candidate.public_key === member.dskPublicKey);
      if (candidates.length !== 1) return null;
      const { rows: targetRows } = await execute<TargetRow>(conn,
        `SELECT * FROM device_policy_activation_targets WHERE device_id = ?`, [transcript.deviceId]);
      const target = targetRows[0];
      const { rows: clockRows } = await execute<{ now_utc: Date }>(conn, `SELECT UTC_TIMESTAMP(3) AS now_utc`);
      const now = clockRows[0]?.now_utc;
      if (!target || !(now instanceof Date) || target.family_id !== transcript.familyId || target.target_state !== 'PENDING' ||
          target.challenge_id !== transcript.challengeId || target.challenge_consumed_at !== null ||
          target.challenge_expires_at === null ||
          target.challenge_expires_at.getTime() <= now.getTime() || target.policy_envelope_expires_at === null ||
          target.policy_envelope_expires_at.getTime() <= now.getTime() || !target.challenge_nonce_hash ||
          !target.challenge_nonce_hash.equals(createHash('sha256').update(Buffer.from(transcript.challengeNonce, 'base64url')).digest()) ||
          target.policy_message_id !== transcript.policyEnvelopeMessageId ||
          !target.policy_envelope_sha256.equals(Buffer.from(transcript.policyEnvelopeSha256, 'base64url')) ||
          asNumber(target.trust_set_epoch) !== transcript.trustSetEpoch || asNumber(target.key_epoch) !== transcript.keyEpoch ||
          target.canonical_envelope_bytes === null || !createHash('sha256').update(target.canonical_envelope_bytes).digest().equals(target.policy_envelope_sha256)) return null;
      return { keyId: candidates[0]!.key_id, publicKey: candidates[0]!.public_key };
    });
  }

  /** Returns a synthetic indistinguishable challenge when any device/target authority is unavailable. */
  async issueBootstrapPossessionChallenge(familyId: string, deviceId: string): Promise<{
    challengeId: string; nonce: string; expiresAt: Date;
  }> {
    const nonce = randomBytes(32);
    const challengeId = randomUUID().toLowerCase();
    const synthetic = { challengeId, nonce: nonce.toString('base64url'), expiresAt: new Date(Date.now() + 60_000) };
    return runInTransaction(async (conn) => {
      const { rows: floorRows } = await execute<FloorRow>(conn,
        `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
           FROM family_epoch_floors WHERE family_id = ? FOR UPDATE`, [familyId]);
      const floor = floorRows[0];
      if (!floor) return synthetic;
      const { rows: devices } = await execute<DeviceRow>(conn,
        `SELECT d.device_id, d.family_id, d.status, d.revoked_at
           FROM devices d JOIN families f ON f.family_id = d.family_id
          WHERE d.device_id = ? AND d.family_id = ? AND f.status = 'ACTIVE' AND f.deleted_at IS NULL
          FOR UPDATE`, [deviceId, familyId]);
      const device = devices[0];
      if (!device || device.status !== 'PAIRED' || device.revoked_at !== null) return synthetic;
      const { rows: keys } = await execute<KeyRow>(conn,
        `SELECT k.key_id, k.key_purpose, k.public_key, k.status
           FROM device_public_keys k WHERE k.device_id = ? FOR UPDATE`, [deviceId]);
      const activeKeys = keys.filter((key) => key.key_purpose === 'DSK' && key.status === 'ACTIVE');
      if (activeKeys.length !== 1) return synthetic;
      const { rows: headRows } = await execute<HeadRow>(conn,
        `SELECT trust_set_epoch, key_epoch, signed_epoch_bytes FROM family_trust_set_epochs
          WHERE family_id = ? ORDER BY trust_set_epoch DESC LIMIT 1 FOR UPDATE`, [familyId]);
      const head = headRows[0];
      if (!head || asNumber(head.trust_set_epoch) !== asNumber(floor.minimum_accepted_trust_set_epoch) ||
          asNumber(head.key_epoch) !== asNumber(floor.minimum_accepted_key_epoch)) return synthetic;
      let epoch;
      try { epoch = decodeCanonicalTrustSetEpochBytes(head.signed_epoch_bytes); }
      catch { return synthetic; }
      const member = epoch.entries.filter((entry) => entry.deviceId === deviceId && entry.status === 'ACTIVE' &&
        entry.dskKeyId === activeKeys[0]!.key_id && entry.dskPublicKey === activeKeys[0]!.public_key);
      if (member.length !== 1) return synthetic;
      const nowResult = await execute<{ now_utc: Date }>(conn, `SELECT UTC_TIMESTAMP(3) AS now_utc`);
      const now = nowResult.rows[0]?.now_utc;
      if (!(now instanceof Date)) return synthetic;
      const expiresAt = new Date(now.getTime() + 60_000);
      const { rows: targetRows } = await execute<TargetRow>(conn,
        `SELECT * FROM device_policy_activation_targets WHERE device_id = ? FOR UPDATE`, [deviceId]);
      const target = targetRows[0];
      if (!target || target.family_id !== familyId || target.target_state !== 'PENDING' ||
          !target.canonical_envelope_bytes || !target.envelope_signature ||
          !target.policy_envelope_expires_at || target.policy_envelope_expires_at.getTime() <= now.getTime() ||
          asNumber(target.trust_set_epoch) !== epoch.trustSetEpoch || asNumber(target.key_epoch) !== epoch.keyEpoch ||
          asNumber(target.trust_set_epoch) !== asNumber(floor.minimum_accepted_trust_set_epoch) ||
          asNumber(target.key_epoch) !== asNumber(floor.minimum_accepted_key_epoch)) return synthetic;
      await execute(conn,
        `UPDATE device_policy_activation_targets
          SET challenge_id = ?, challenge_nonce_hash = ?,
                challenge_expires_at = ?, challenge_consumed_at = NULL, updated_at = ?
          WHERE device_id = ? AND target_generation = ? AND target_state = 'PENDING'`,
        [challengeId, createHash('sha256').update(nonce).digest(), expiresAt, now,
          deviceId, target.target_generation]);
      return { challengeId, nonce: nonce.toString('base64url'), expiresAt };
    });
  }

  /** Verifies a PAIRED device's DSK possession and atomically replaces its bootstrap challenge with proof challenge/capability. */
  async completeBootstrapPossession(input: {
    familyId: string; deviceId: string; challengeId: string; nonce: string; signature: string;
    signatureVerifier: DeviceSignatureVerifier;
  }): Promise<{
    challengeId: string; nonce: string; expiresAt: Date; messageId: string;
    envelopeSha256: string; trustSetEpoch: number; keyEpoch: number; targetGeneration: number;
    identity: { deviceId: string; familyId: string; dskKeyId: string; dskPublicKey: string };
  } | null> {
    let nonceBytes: Buffer;
    try { nonceBytes = strictBase64Url(input.nonce); }
    catch { return null; }
    if (nonceBytes.length !== 32 || !isCanonicalP256Signature(input.signature)) return null;
    const nonceHash = createHash('sha256').update(nonceBytes).digest();
    const nextNonce = randomBytes(32);
    const nextChallengeId = randomUUID().toLowerCase();
    return runInTransaction(async (conn) => {
      const { rows: floorRows } = await execute<FloorRow>(conn,
        `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
           FROM family_epoch_floors WHERE family_id = ? FOR UPDATE`, [input.familyId]);
      const floor = floorRows[0];
      if (!floor) return null;
      const { rows: devices } = await execute<DeviceRow>(conn,
        `SELECT d.device_id, d.family_id, d.status, d.revoked_at FROM devices d
          JOIN families f ON f.family_id = d.family_id
          WHERE d.device_id = ? AND d.family_id = ? AND f.status = 'ACTIVE' AND f.deleted_at IS NULL
          FOR UPDATE`, [input.deviceId, input.familyId]);
      const device = devices[0];
      if (!device || device.status !== 'PAIRED' || device.revoked_at !== null) return null;
      const { rows: keyRows } = await execute<KeyRow>(conn,
        `SELECT k.key_id, k.key_purpose, k.public_key, k.status FROM device_public_keys k
          WHERE k.device_id = ? FOR UPDATE`, [input.deviceId]);
      const dsks = keyRows.filter((key) => key.key_purpose === 'DSK' && key.status === 'ACTIVE');
      if (dsks.length !== 1) return null;
      const { rows: headRows } = await execute<HeadRow>(conn,
        `SELECT trust_set_epoch, key_epoch, signed_epoch_bytes FROM family_trust_set_epochs
          WHERE family_id = ? ORDER BY trust_set_epoch DESC LIMIT 1 FOR UPDATE`, [input.familyId]);
      const head = headRows[0];
      if (!head || asNumber(head.trust_set_epoch) !== asNumber(floor.minimum_accepted_trust_set_epoch) ||
          asNumber(head.key_epoch) !== asNumber(floor.minimum_accepted_key_epoch)) return null;
      let epoch;
      try { epoch = decodeCanonicalTrustSetEpochBytes(head.signed_epoch_bytes); }
      catch { return null; }
      const member = epoch.entries.filter((entry) => entry.deviceId === input.deviceId && entry.status === 'ACTIVE' &&
        entry.dskKeyId === dsks[0]!.key_id && entry.dskPublicKey === dsks[0]!.public_key);
      if (member.length !== 1 || !await input.signatureVerifier.verify(dsks[0]!.public_key, input.nonce, input.signature)) return null;
      const nowResult = await execute<{ now_utc: Date }>(conn, `SELECT UTC_TIMESTAMP(3) AS now_utc`);
      const now = nowResult.rows[0]?.now_utc;
      if (!(now instanceof Date)) return null;
      const { rows: targetRows } = await execute<TargetRow>(conn,
        `SELECT * FROM device_policy_activation_targets WHERE device_id = ? FOR UPDATE`, [input.deviceId]);
      const target = targetRows[0];
      if (!target || target.family_id !== input.familyId || target.target_state !== 'PENDING' ||
          target.challenge_id !== input.challengeId || target.challenge_consumed_at !== null ||
          !target.challenge_nonce_hash?.equals(nonceHash) || target.challenge_expires_at === null ||
          target.challenge_expires_at.getTime() <= now.getTime() || target.policy_envelope_expires_at === null ||
          target.policy_envelope_expires_at.getTime() <= now.getTime() || !target.canonical_envelope_bytes ||
          !target.envelope_signature || asNumber(target.trust_set_epoch) !== epoch.trustSetEpoch ||
          asNumber(target.key_epoch) !== epoch.keyEpoch || asNumber(target.trust_set_epoch) !== asNumber(floor.minimum_accepted_trust_set_epoch) ||
          asNumber(target.key_epoch) !== asNumber(floor.minimum_accepted_key_epoch)) return null;
      const expiresAt = new Date(now.getTime() + 60_000);
      await execute(conn,
        `UPDATE device_policy_activation_targets SET challenge_id = ?, challenge_nonce_hash = ?, challenge_expires_at = ?,
            challenge_consumed_at = NULL, updated_at = ?
          WHERE device_id = ? AND target_generation = ? AND target_state = 'PENDING'`,
        [nextChallengeId, createHash('sha256').update(nextNonce).digest(), expiresAt, now,
          input.deviceId, target.target_generation]);
      return { challengeId: nextChallengeId, nonce: nextNonce.toString('base64url'),
        expiresAt, messageId: target.policy_message_id,
        envelopeSha256: target.policy_envelope_sha256.toString('base64url'), trustSetEpoch: epoch.trustSetEpoch,
        keyEpoch: epoch.keyEpoch, targetGeneration: asNumber(target.target_generation),
        identity: { deviceId: input.deviceId, familyId: input.familyId, dskKeyId: dsks[0]!.key_id,
          dskPublicKey: dsks[0]!.public_key } };
    });
  }

  /** Session-scoped fetch; returns only this PAIRED device's exact current activation target. */
  async fetchActivationTarget(familyId: string, deviceId: string, dskKeyId: string, targetGeneration: number): Promise<{
    challengeId: string; messageId: string; envelopeSha256: string; canonicalEnvelopeBytes: Buffer;
    envelopeSignature: Buffer; trustSetEpoch: number; keyEpoch: number;
  } | null> {
    return runInTransaction(async (conn) => {
      const { rows: floorRows } = await execute<FloorRow>(conn,
        `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
           FROM family_epoch_floors WHERE family_id = ? FOR UPDATE`, [familyId]);
      const floor = floorRows[0];
      if (!floor) return null;
      const { rows: devices } = await execute<DeviceRow>(conn,
        `SELECT d.device_id, d.family_id, d.status, d.revoked_at
           FROM devices d JOIN families f ON f.family_id = d.family_id
          WHERE d.device_id = ? AND d.family_id = ? AND f.status = 'ACTIVE' AND f.deleted_at IS NULL
          FOR UPDATE`, [deviceId, familyId]);
      const device = devices[0];
      if (!device || device.status !== 'PAIRED' || device.revoked_at !== null) return null;
      const { rows: headRows } = await execute<HeadRow>(conn,
        `SELECT trust_set_epoch, key_epoch, signed_epoch_bytes FROM family_trust_set_epochs
          WHERE family_id = ? ORDER BY trust_set_epoch DESC LIMIT 1 FOR UPDATE`, [familyId]);
      const head = headRows[0];
      if (!head || asNumber(head.trust_set_epoch) !== asNumber(floor.minimum_accepted_trust_set_epoch) ||
          asNumber(head.key_epoch) !== asNumber(floor.minimum_accepted_key_epoch)) return null;
      let epoch;
      try { epoch = decodeCanonicalTrustSetEpochBytes(head.signed_epoch_bytes); }
      catch { return null; }
      const { rows: keys } = await execute<KeyRow>(conn,
        `SELECT k.key_id, k.key_purpose, k.public_key, k.status FROM device_public_keys k
          WHERE k.device_id = ? FOR UPDATE`, [deviceId]);
      const activeKeys = keys.filter((key) => key.key_id === dskKeyId && key.key_purpose === 'DSK' && key.status === 'ACTIVE');
      const member = activeKeys.length === 1 && epoch.entries.some((entry) => entry.deviceId === deviceId &&
        entry.status === 'ACTIVE' && entry.dskKeyId === activeKeys[0]!.key_id && entry.dskPublicKey === activeKeys[0]!.public_key);
      if (!member) return null;
      const { rows: targetRows } = await execute<TargetRow>(conn,
        `SELECT * FROM device_policy_activation_targets WHERE device_id = ? FOR UPDATE`, [deviceId]);
      const target = targetRows[0];
      const nowResult = await execute<{ now_utc: Date }>(conn, `SELECT UTC_TIMESTAMP(3) AS now_utc`);
      const now = nowResult.rows[0]?.now_utc;
      if (!target || !(now instanceof Date) || target.family_id !== familyId || target.target_state !== 'PENDING' ||
          target.challenge_id === null || asNumber(target.target_generation) !== targetGeneration ||
          target.challenge_expires_at === null || target.challenge_expires_at.getTime() <= now.getTime() ||
          !target.canonical_envelope_bytes || !target.envelope_signature || target.policy_envelope_expires_at === null ||
          target.policy_envelope_expires_at.getTime() <= now.getTime() ||
          asNumber(target.trust_set_epoch) !== asNumber(floor.minimum_accepted_trust_set_epoch) ||
          asNumber(target.key_epoch) !== asNumber(floor.minimum_accepted_key_epoch) ||
          asNumber(target.trust_set_epoch) !== epoch.trustSetEpoch || asNumber(target.key_epoch) !== epoch.keyEpoch) return null;
      return {
        challengeId: target.challenge_id,
        messageId: target.policy_message_id!,
        envelopeSha256: target.policy_envelope_sha256!.toString('base64url'),
        canonicalEnvelopeBytes: Buffer.from(target.canonical_envelope_bytes),
        envelopeSignature: Buffer.from(target.envelope_signature),
        trustSetEpoch: asNumber(target.trust_set_epoch),
        keyEpoch: asNumber(target.key_epoch),
      };
    });
  }

  async commitVerifiedProof(input: CommitDevicePolicyApplicationProofInput): Promise<CommitDevicePolicyApplicationProofResult> {
    const proof = { ...input, transcript: { ...input.transcript }, challengeNonceBytes: Buffer.from(input.challengeNonceBytes),
      transcriptSha256: Buffer.from(input.transcriptSha256), exactRequestSha256: Buffer.from(input.exactRequestSha256) };
    const { transcript } = proof;
    return runInTransaction(async (conn) => {
      const nowResult = await execute<{ now_utc: Date }>(conn, `SELECT UTC_TIMESTAMP(3) AS now_utc`);
      const now = nowResult.rows[0]?.now_utc;
      if (!(now instanceof Date)) return { outcome: 'REJECTED' } as const;
      const checkPrior = async (): Promise<CommitDevicePolicyApplicationProofResult | null> => {
        const { rows } = await execute<ProofRow>(conn,
          `SELECT exact_request_sha256, activation_outcome, application_result, retention_expires_at
             FROM device_policy_application_proofs WHERE challenge_id = ? FOR UPDATE`, [transcript.challengeId]);
        const prior = rows[0];
        if (!prior) return null;
        if (prior.retention_expires_at.getTime() <= now.getTime()) return null;
        if (!prior.exact_request_sha256.equals(proof.exactRequestSha256)) return { outcome: 'CONFLICT' };
        return { outcome: prior.activation_outcome, idempotent: true };
      };
      const existing = await checkPrior();
      if (existing) return existing;

      // Stable lock order shared with Trust Set append/revocation: floor -> device -> key -> target.
      const { rows: floorRows } = await execute<FloorRow>(conn,
        `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
           FROM family_epoch_floors WHERE family_id = ? FOR UPDATE`, [transcript.familyId]);
      const floor = floorRows[0];
      if (!floor || asNumber(floor.minimum_accepted_trust_set_epoch) !== transcript.trustSetEpoch ||
          asNumber(floor.minimum_accepted_key_epoch) !== transcript.keyEpoch) return { outcome: 'REJECTED' } as const;
      const concurrentRetry = await checkPrior();
      if (concurrentRetry) return concurrentRetry;
      const { rows: devices } = await execute<DeviceRow>(conn,
        `SELECT d.device_id, d.family_id, d.status, d.revoked_at,
                f.status AS family_status, f.deleted_at AS family_deleted_at
           FROM devices d JOIN families f ON f.family_id = d.family_id
          WHERE d.device_id = ? AND d.family_id = ? FOR UPDATE`, [transcript.deviceId, transcript.familyId]);
      const device = devices[0];
      if (!device || device.status !== 'PAIRED' || device.revoked_at !== null ||
          device.family_status !== 'ACTIVE' || device.family_deleted_at !== null) return { outcome: 'REJECTED' } as const;
      const { rows: keyRows } = await execute<KeyRow>(conn,
        `SELECT key_id, key_purpose, public_key, status FROM device_public_keys
          WHERE device_id = ? AND key_id = ? FOR UPDATE`, [transcript.deviceId, proof.deviceKeyId]);
      const key = keyRows[0];
      if (!key || key.key_purpose !== 'DSK' || key.status !== 'ACTIVE' || key.public_key !== proof.dskPublicKey) return { outcome: 'REJECTED' } as const;
      const { rows: headRows } = await execute<HeadRow>(conn,
        `SELECT trust_set_epoch, key_epoch, signed_epoch_bytes FROM family_trust_set_epochs
          WHERE family_id = ? ORDER BY trust_set_epoch DESC LIMIT 1 FOR UPDATE`, [transcript.familyId]);
      const head = headRows[0];
      if (!head || asNumber(head.trust_set_epoch) !== transcript.trustSetEpoch || asNumber(head.key_epoch) !== transcript.keyEpoch) return { outcome: 'REJECTED' } as const;
      let epoch;
      try { epoch = decodeCanonicalTrustSetEpochBytes(head.signed_epoch_bytes); }
      catch { return { outcome: 'REJECTED' } as const; }
      const members = epoch.entries.filter((entry) => entry.deviceId === transcript.deviceId && entry.status === 'ACTIVE' &&
        entry.dskKeyId === proof.deviceKeyId && entry.dskPublicKey === key.public_key);
      if (members.length !== 1) return { outcome: 'REJECTED' } as const;

      const { rows: targetRows } = await execute<TargetRow>(conn,
        `SELECT * FROM device_policy_activation_targets WHERE device_id = ? FOR UPDATE`, [transcript.deviceId]);
      const target = targetRows[0];
      const nonceHash = createHash('sha256').update(proof.challengeNonceBytes).digest();
      const expiry = new Date(transcript.challengeExpiresAt);
      if (!target || target.target_state !== 'PENDING' || target.family_id !== transcript.familyId ||
          target.challenge_id !== transcript.challengeId || target.challenge_consumed_at !== null ||
          !target.challenge_nonce_hash?.equals(nonceHash) || target.challenge_expires_at?.getTime() !== expiry.getTime() ||
          target.challenge_expires_at.getTime() <= now.getTime() || target.policy_message_id !== transcript.policyEnvelopeMessageId ||
          target.policy_envelope_expires_at === null || target.policy_envelope_expires_at.getTime() <= now.getTime() ||
          target.canonical_envelope_bytes === null || !createHash('sha256').update(target.canonical_envelope_bytes).digest().equals(target.policy_envelope_sha256) ||
          !target.policy_envelope_sha256.equals(Buffer.from(transcript.policyEnvelopeSha256, 'base64url')) ||
          asNumber(target.trust_set_epoch) !== transcript.trustSetEpoch || asNumber(target.key_epoch) !== transcript.keyEpoch ||
          target.canonical_envelope_bytes === null || target.envelope_signature === null) return { outcome: 'REJECTED' } as const;

      const activated = transcript.applicationResult === 'APPLIED';
      if (activated && !this.receiverCryptoReady()) return { outcome: 'REJECTED' } as const;
      const retentionExpiresAt = new Date(now.getTime() + DEVICE_POLICY_PROOF_TOMBSTONE_TTL_MS);
      const activationOutcome = activated ? 'ACTIVATED' : 'RECORDED_NOT_ACTIVATED';
      await execute(conn,
        `INSERT INTO device_policy_application_proofs
          (challenge_id, family_id, device_id, target_generation, policy_message_id, policy_envelope_sha256,
           trust_set_epoch, key_epoch, application_result, device_key_id, challenge_expires_at,
           challenge_consumed_at, canonical_transcript_sha256, exact_request_sha256, activation_outcome,
           received_at, committed_at, retention_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [transcript.challengeId, transcript.familyId, transcript.deviceId, target.target_generation,
          transcript.policyEnvelopeMessageId, Buffer.from(transcript.policyEnvelopeSha256, 'base64url'),
          transcript.trustSetEpoch, transcript.keyEpoch, transcript.applicationResult, proof.deviceKeyId,
          expiry, now, proof.transcriptSha256, proof.exactRequestSha256, activationOutcome, now, now, retentionExpiresAt]);

      if (activated) {
        const updateDevice = await execute(conn,
          `UPDATE devices SET status = 'ACTIVE', activated_at = ?
            WHERE device_id = ? AND family_id = ? AND status = 'PAIRED' AND revoked_at IS NULL`,
          [now, transcript.deviceId, transcript.familyId]);
        if (updateDevice.rowCount !== 1) throw new Error('activation_device_state_changed');
        const targetUpdate = await execute(conn,
          `UPDATE device_policy_activation_targets SET target_state = 'ACTIVATED',
              canonical_envelope_bytes = NULL, envelope_signature = NULL,
              challenge_id = NULL,
              challenge_nonce_hash = NULL, challenge_expires_at = NULL,
              challenge_consumed_at = NULL, updated_at = ?
            WHERE device_id = ? AND target_generation = ? AND target_state = 'PENDING'`,
          [now, transcript.deviceId, target.target_generation]);
        if (targetUpdate.rowCount !== 1) throw new Error('activation_target_state_changed');
      } else {
        const targetUpdate = await execute(conn,
        `UPDATE device_policy_activation_targets SET challenge_id = NULL, challenge_nonce_hash = NULL, challenge_expires_at = NULL,
              challenge_consumed_at = NULL, updated_at = ?
            WHERE device_id = ? AND target_generation = ? AND target_state = 'PENDING'`,
          [now, transcript.deviceId, target.target_generation]);
        if (targetUpdate.rowCount !== 1) throw new Error('proof_target_state_changed');
      }
      return { outcome: activationOutcome, idempotent: false } as const;
    });
  }
}
