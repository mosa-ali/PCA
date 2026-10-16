import { createHash } from 'node:crypto';
import { execute, runInTransaction } from '../db/pool.js';
import { canonicalizeEnvelope } from '../familyenvelope/canonicalize.js';
import { decodeCanonicalTrustSetEpochBytes } from '../familytrustset/decode.js';
import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';
import { isCanonicalP256Signature } from '../deviceauth/P256DeviceSignatureVerifier.js';
import { MAX_CANONICAL_ENVELOPE_BYTES } from './protocol.js';
import type { PairedActivationTargetWrite, PairedActivationTargetWriter } from './PairedActivationTargetWriter.js';

interface FloorRow {
  minimum_accepted_trust_set_epoch: number | string | bigint;
  minimum_accepted_key_epoch: number | string | bigint;
}
interface HeadRow {
  trust_set_epoch: number | string | bigint;
  key_epoch: number | string | bigint;
  signed_epoch_bytes: Buffer;
}
interface DeviceRow { device_id: string; family_id: string; status: string; family_status: string; deleted_at: Date | null }
interface KeyRow { public_key: string; status: string; key_purpose: string }
interface RecipientKeyRow { key_id: string; key_purpose: string; status: string }
interface TargetRow {
  target_generation: number | string | bigint;
  policy_message_id: string | null;
  policy_envelope_sha256: Buffer | null;
  policy_envelope_expires_at: Date | null;
  canonical_envelope_bytes: Buffer | null;
  envelope_signature: Buffer | null;
  trust_set_epoch: number | string | bigint | null;
  key_epoch: number | string | bigint | null;
  target_state: string;
}

/**
 * Creates only a PAIRED device's activation target. The relay remains opaque;
 * this isolated adapter parses the already-defined relay envelope wire shape,
 * cross-checks every routing field, and verifies the sender DSK against the
 * exact accepted Trust Set head before retaining canonical encrypted bytes.
 */
export class MySqlPairedActivationTargetWriter implements PairedActivationTargetWriter {
  constructor(private readonly signatureVerifier: DeviceSignatureVerifier) {}

  async storePairedPolicyTarget(source: PairedActivationTargetWrite): Promise<'STORED' | 'IDEMPOTENT' | 'REJECTED'> {
    const input = { ...source, envelope: { ...source.envelope, payload: Buffer.from(source.envelope.payload) } };
    const { envelope } = input;
    if (envelope.messageType !== 'POLICY_UPDATE' || envelope.familyId !== input.familyId ||
        envelope.senderDeviceId !== input.senderDeviceId || envelope.senderKeyId !== input.senderDskKeyId ||
        envelope.trustSetEpoch !== input.trustSetEpoch || envelope.keyEpoch !== input.keyEpoch ||
        envelope.recipient.kind !== 'DEVICE' || envelope.recipient.recipientDeviceId !== input.recipientDeviceId ||
        !isCanonicalP256Signature(envelope.signature)) return 'REJECTED';
    const canonical = Buffer.from(canonicalizeEnvelope(envelope), 'utf8');
    if (canonical.length === 0 || canonical.length > MAX_CANONICAL_ENVELOPE_BYTES) return 'REJECTED';
    const digest = createHash('sha256').update(canonical).digest();
    const signatureBytes = Buffer.from(envelope.signature, 'base64url');

    return runInTransaction(async (conn) => {
      const { rows: floorRows } = await execute<FloorRow>(conn,
        `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
           FROM family_epoch_floors WHERE family_id = ? FOR UPDATE`, [input.familyId]);
      const floor = floorRows[0];
      if (!floor || Number(floor.minimum_accepted_trust_set_epoch) !== input.trustSetEpoch ||
          Number(floor.minimum_accepted_key_epoch) !== input.keyEpoch) return 'REJECTED' as const;

      const { rows: headRows } = await execute<HeadRow>(conn,
        `SELECT trust_set_epoch, key_epoch, signed_epoch_bytes
           FROM family_trust_set_epochs
          WHERE family_id = ? ORDER BY trust_set_epoch DESC LIMIT 1 FOR UPDATE`, [input.familyId]);
      const head = headRows[0];
      if (!head || Number(head.trust_set_epoch) !== input.trustSetEpoch || Number(head.key_epoch) !== input.keyEpoch) return 'REJECTED' as const;
      let epoch;
      try { epoch = decodeCanonicalTrustSetEpochBytes(head.signed_epoch_bytes); }
      catch { return 'REJECTED' as const; }
      if (epoch.familyId !== input.familyId || epoch.trustSetEpoch !== input.trustSetEpoch || epoch.keyEpoch !== input.keyEpoch) return 'REJECTED' as const;
      const sender = epoch.entries.filter((entry) => entry.deviceId === input.senderDeviceId &&
        entry.dskKeyId === input.senderDskKeyId && entry.status === 'ACTIVE' &&
        (entry.role === 'OWNER' || entry.role === 'ADMINISTRATOR'));
      const recipient = epoch.entries.filter((entry) => entry.deviceId === input.recipientDeviceId && entry.status === 'ACTIVE');
      if (sender.length !== 1 || sender[0]!.dskPublicKey.length === 0 || recipient.length !== 1 ||
          envelope.expiresAt.getTime() <= Date.now()) return 'REJECTED' as const;

      const expectedDevices = [...new Set([input.senderDeviceId, input.recipientDeviceId])].sort();
      const deviceClauses = expectedDevices.map(() => 'BINARY d.device_id = BINARY ?').join(' OR ');
      const { rows: devices } = await execute<DeviceRow>(conn,
        `SELECT d.device_id, d.family_id, d.status, f.status AS family_status, f.deleted_at
           FROM devices d JOIN families f ON f.family_id = d.family_id
          WHERE (${deviceClauses}) ORDER BY BINARY d.device_id FOR UPDATE`, [...expectedDevices]);
      if (devices.length !== expectedDevices.length || devices.some((row) => row.family_id !== input.familyId ||
          row.family_status !== 'ACTIVE' || row.deleted_at !== null) ||
          devices.find((row) => row.device_id === input.recipientDeviceId)?.status !== 'PAIRED' ||
          devices.find((row) => row.device_id === input.senderDeviceId)?.status !== 'ACTIVE') return 'REJECTED' as const;

      const { rows: recipientKeys } = await execute<RecipientKeyRow>(conn,
        `SELECT key_id, key_purpose, status FROM device_public_keys WHERE device_id = ? FOR UPDATE`, [input.recipientDeviceId]);
      const recipientKey = recipientKeys.find((key) => key.key_id === recipient[0]!.dskKeyId);
      if (!recipientKey || recipientKey.key_purpose !== 'DSK' || recipientKey.status !== 'ACTIVE') return 'REJECTED' as const;

      const { rows: keyRows } = await execute<KeyRow>(conn,
        `SELECT public_key, status, key_purpose FROM device_public_keys
          WHERE device_id = ? AND key_id = ? FOR UPDATE`, [input.senderDeviceId, input.senderDskKeyId]);
      const senderKey = keyRows[0];
      if (!senderKey || senderKey.status !== 'ACTIVE' || senderKey.key_purpose !== 'DSK' ||
          senderKey.public_key !== sender[0]!.dskPublicKey ||
          !await this.signatureVerifier.verify(senderKey.public_key, canonical.toString('utf8'), envelope.signature)) return 'REJECTED' as const;

      const { rows: currentRows } = await execute<TargetRow>(conn,
        `SELECT target_generation, policy_message_id, policy_envelope_sha256, policy_envelope_expires_at, canonical_envelope_bytes,
                envelope_signature, trust_set_epoch, key_epoch, target_state
           FROM device_policy_activation_targets WHERE device_id = ? FOR UPDATE`, [input.recipientDeviceId]);
      const existing = currentRows[0];
      const now = new Date();
      if (existing && existing.target_state === 'PENDING' && existing.policy_message_id === envelope.messageId &&
        existing.policy_envelope_sha256?.equals(digest) && existing.policy_envelope_expires_at?.getTime() === envelope.expiresAt.getTime() &&
        existing.canonical_envelope_bytes?.equals(canonical) &&
          existing.envelope_signature?.equals(signatureBytes) && Number(existing.trust_set_epoch) === input.trustSetEpoch &&
          Number(existing.key_epoch) === input.keyEpoch) return 'IDEMPOTENT' as const;
      if (existing) {
        await execute(conn,
          `UPDATE device_policy_activation_targets
                  SET family_id = ?, target_generation = target_generation + 1, policy_message_id = ?,
                  policy_envelope_sha256 = ?, policy_envelope_expires_at = ?, canonical_envelope_bytes = ?, envelope_signature = ?,
                  trust_set_epoch = ?, key_epoch = ?, target_state = 'PENDING',
                  bootstrap_capability_hash = NULL, bootstrap_capability_expires_at = NULL,
                  bootstrap_capability_consumed_at = NULL, challenge_id = NULL,
                  challenge_nonce_hash = NULL, challenge_expires_at = NULL, challenge_consumed_at = NULL,
                  updated_at = ? WHERE device_id = ?`,
          [input.familyId, envelope.messageId, digest, envelope.expiresAt, canonical, signatureBytes, input.trustSetEpoch, input.keyEpoch, now, input.recipientDeviceId]);
      } else {
        await execute(conn,
          `INSERT INTO device_policy_activation_targets
            (device_id, family_id, target_generation, policy_message_id, policy_envelope_sha256, policy_envelope_expires_at,
             canonical_envelope_bytes, envelope_signature, trust_set_epoch, key_epoch, target_state,
             created_at, updated_at)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
          [input.recipientDeviceId, input.familyId, envelope.messageId, digest, envelope.expiresAt, canonical, signatureBytes,
            input.trustSetEpoch, input.keyEpoch, now, now]);
      }
      return 'STORED' as const;
    });
  }
}
