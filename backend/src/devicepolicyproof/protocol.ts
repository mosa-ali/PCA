import { createHash } from 'node:crypto';
import { strictBase64Url } from '../deviceauth/P256DeviceSignatureVerifier.js';

export const DEVICE_POLICY_APPLICATION_PROOF_DOMAIN = 'PCA_DEVICE_POLICY_APPLICATION_PROOF_V1';
export const DEVICE_POLICY_PROOF_TOMBSTONE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_CANONICAL_ENVELOPE_BYTES = 98_304;
export type DevicePolicyApplicationResult = 'APPLIED' | 'DEGRADED' | 'REJECTED';

export interface DevicePolicyApplicationProofTranscript {
  familyId: string;
  deviceId: string;
  policyEnvelopeMessageId: string;
  policyEnvelopeSha256: string;
  trustSetEpoch: number;
  keyEpoch: number;
  applicationResult: DevicePolicyApplicationResult;
  challengeId: string;
  challengeNonce: string;
  challengeExpiresAt: string;
}

const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANONICAL_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function strictUtf8(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.toString('utf8') !== value) throw new TypeError('invalid_utf8');
  return bytes;
}

function strictDigest(value: string): Buffer {
  const bytes = strictBase64Url(value);
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new TypeError('invalid_digest');
  return bytes;
}

function validateTranscript(input: DevicePolicyApplicationProofTranscript): string[] {
  if (!input || !UUID_LOWER.test(input.familyId) || !UUID_LOWER.test(input.deviceId) || !UUID_LOWER.test(input.challengeId)) {
    throw new TypeError('invalid_identifier');
  }
  const messageBytes = strictUtf8(input.policyEnvelopeMessageId);
  if (input.policyEnvelopeMessageId.length < 1 || input.policyEnvelopeMessageId.length > 128 || messageBytes.length > 512) {
    throw new TypeError('invalid_message_id');
  }
  strictDigest(input.policyEnvelopeSha256);
  strictDigest(input.challengeNonce);
  for (const epoch of [input.trustSetEpoch, input.keyEpoch]) {
    if (!Number.isInteger(epoch) || epoch < 1 || epoch > 2_147_483_647) throw new TypeError('invalid_epoch');
  }
  if (!['APPLIED', 'DEGRADED', 'REJECTED'].includes(input.applicationResult)) throw new TypeError('invalid_result');
  if (!CANONICAL_UTC_MILLIS.test(input.challengeExpiresAt) || new Date(input.challengeExpiresAt).toISOString() !== input.challengeExpiresAt) {
    throw new TypeError('invalid_expiry');
  }
  return [
    DEVICE_POLICY_APPLICATION_PROOF_DOMAIN,
    input.familyId,
    input.deviceId,
    input.policyEnvelopeMessageId,
    input.policyEnvelopeSha256,
    String(input.trustSetEpoch),
    String(input.keyEpoch),
    input.applicationResult,
    input.challengeId,
    input.challengeNonce,
    input.challengeExpiresAt,
  ];
}

/** The frozen V1 transcript: UTF-8 netstrings in fixed field order, no JSON or trailing separator. */
export function canonicalizeDevicePolicyApplicationProof(input: DevicePolicyApplicationProofTranscript): Buffer {
  const fields = validateTranscript(input);
  const transcript = Buffer.concat(fields.map((value) => {
    const bytes = strictUtf8(value);
    return Buffer.concat([Buffer.from(`${bytes.length}:`, 'ascii'), bytes]);
  }));
  if (transcript.length > 2_048) throw new TypeError('transcript_too_large');
  return transcript;
}

export function devicePolicyProofDigests(
  transcript: Uint8Array,
  signatureBase64Url: string,
): { transcriptSha256: Buffer; exactRequestSha256: Buffer; signature: Buffer } {
  const signature = strictBase64Url(signatureBase64Url);
  if (signature.length !== 64) throw new TypeError('invalid_signature_length');
  const transcriptBytes = Buffer.from(transcript);
  if (transcriptBytes.length === 0 || transcriptBytes.length > 2_048) throw new TypeError('invalid_transcript_length');
  return {
    transcriptSha256: createHash('sha256').update(transcriptBytes).digest(),
    exactRequestSha256: createHash('sha256').update(transcriptBytes).update(signature).digest(),
    signature,
  };
}

export function digestCanonicalEncryptedEnvelope(canonicalEnvelopeBytes: Uint8Array): Buffer {
  const bytes = Buffer.from(canonicalEnvelopeBytes);
  if (bytes.length === 0 || bytes.length > MAX_CANONICAL_ENVELOPE_BYTES) throw new TypeError('invalid_envelope_size');
  return createHash('sha256').update(bytes).digest();
}
