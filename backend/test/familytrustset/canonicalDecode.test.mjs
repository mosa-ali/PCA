import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import {
  decodeCanonicalTrustSetEpoch,
  MAX_CANONICAL_TRUST_SET_LENGTH,
  TrustSetEpochDecodeError,
} from '../../dist/familytrustset/decode.js';

function entry(overrides = {}) {
  return {
    deviceId: 'device-1',
    role: 'OWNER',
    dskKeyId: 'dsk-key-1',
    dskPublicKey: 'dsk-pub-1',
    dekKeyId: 'dek-key-1',
    dekPublicKey: 'dek-pub-1',
    status: 'ACTIVE',
    ...overrides,
  };
}

function epoch(overrides = {}) {
  return {
    familyId: 'family-1',
    trustSetEpoch: 1,
    keyEpoch: 1,
    entries: [entry()],
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    supersedesEpoch: null,
    ...overrides,
  };
}

function encode(value) {
  return canonicalizeTrustSetEpoch(value);
}

/** Field list exactly as canonicalize.ts builds it, for byte-level mutation in rejection tests. */
function canonicalFields(value) {
  return [
    value.familyId,
    String(value.trustSetEpoch),
    String(value.keyEpoch),
    String(value.entries.length),
    ...value.entries.flatMap((item) => [
      item.deviceId,
      item.role,
      item.dskKeyId,
      item.dskPublicKey,
      item.dekKeyId,
      item.dekPublicKey,
      item.status,
    ]),
    value.issuedAt.toISOString(),
    value.supersedesEpoch === null ? 'null' : String(value.supersedesEpoch),
  ];
}

function buildCanonical(fields) {
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('');
}

function assertRejects(bytes) {
  assert.throws(() => decodeCanonicalTrustSetEpoch(bytes), TrustSetEpochDecodeError);
}

test('TrustSetEpochDecodeError exposes the MALFORMED_CANONICAL_BYTES code', () => {
  try {
    decodeCanonicalTrustSetEpoch('');
    assert.fail('expected decodeCanonicalTrustSetEpoch to throw');
  } catch (error) {
    assert.ok(error instanceof TrustSetEpochDecodeError);
    assert.equal(error.code, 'MALFORMED_CANONICAL_BYTES');
  }
});

test('decode round-trips a single-entry genesis epoch (supersedes null)', () => {
  const value = epoch();
  const bytes = encode(value);
  const decoded = decodeCanonicalTrustSetEpoch(bytes);
  assert.deepEqual(decoded, { ...value, signature: '' });
  assert.equal(decoded.signature, '');
  // The inverse property from the other side: re-encoding the decoded epoch
  // must reproduce the exact stored bytes.
  assert.equal(encode(decoded), bytes);
});

test('decode round-trips a three-entry epoch with supersedesEpoch a number', () => {
  const value = epoch({
    trustSetEpoch: 5,
    keyEpoch: 2,
    entries: [
      entry(),
      entry({
        deviceId: 'device-2',
        role: 'ADMINISTRATOR',
        dskKeyId: 'dsk-key-2',
        dskPublicKey: 'dsk-pub-2',
        dekKeyId: 'dek-key-2',
        dekPublicKey: 'dek-pub-2',
        status: 'DEVICE_OFFLINE',
      }),
      entry({
        deviceId: 'device-3',
        role: 'CHILD',
        dskKeyId: 'dsk-key-3',
        dskPublicKey: 'dsk-pub-3',
        dekKeyId: 'dek-key-3',
        dekPublicKey: 'dek-pub-3',
        status: 'ROTATION_PENDING',
      }),
    ],
    issuedAt: new Date('2026-02-03T04:05:06.789Z'),
    supersedesEpoch: 4,
  });
  assert.deepEqual(decodeCanonicalTrustSetEpoch(encode(value)), { ...value, signature: '' });
});

test('decode round-trips keyEpoch 0 (policy.ts allows a zero key epoch)', () => {
  const value = epoch({ keyEpoch: 0 });
  assert.deepEqual(decodeCanonicalTrustSetEpoch(encode(value)), { ...value, signature: '' });
});

test('decode honors UTF-8 BYTE lengths for multibyte fields', () => {
  const value = epoch({
    familyId: 'أسرة-الوالدين',
    entries: [entry({ deviceId: 'جهاز-الوالد-😀', dskKeyId: 'مفتاح-التوقيع', dekKeyId: 'مفتاح-التشفير' })],
  });
  // Guard: the fixture must genuinely exercise multibyte semantics
  // (byte length differs from character length).
  assert.notEqual(Buffer.byteLength(value.familyId, 'utf8'), value.familyId.length);
  assert.notEqual(Buffer.byteLength(value.entries[0].deviceId, 'utf8'), value.entries[0].deviceId.length);

  const bytes = encode(value);
  const decoded = decodeCanonicalTrustSetEpoch(bytes);
  assert.deepEqual(decoded, { ...value, signature: '' });
  assert.equal(encode(decoded), bytes);
});

test('decode round-trips the 64-entry boundary with maximum-length opaque ids', () => {
  const longId = (prefix, index) => `${prefix}-${index}`.padEnd(128, 'a');
  const entries = Array.from({ length: 64 }, (_, index) =>
    entry({
      deviceId: longId('device', index),
      role: index === 0 ? 'OWNER' : 'CHILD',
      dskKeyId: longId('dsk-key', index),
      dskPublicKey: longId('dsk-pub', index),
      dekKeyId: longId('dek-key', index),
      dekPublicKey: longId('dek-pub', index),
      status: 'ACTIVE',
    }),
  );
  const value = epoch({ trustSetEpoch: 64, keyEpoch: 64, entries });
  const bytes = encode(value);
  assert.ok(bytes.length < MAX_CANONICAL_TRUST_SET_LENGTH);
  assert.deepEqual(decodeCanonicalTrustSetEpoch(bytes), { ...value, signature: '' });
});

test('decode rejects truncated input', () => {
  const bytes = encode(epoch());
  assertRejects(bytes.slice(0, -1));
  assertRejects(bytes.slice(0, -5));
  assertRejects(bytes.slice(0, 7));
});

test('decode rejects trailing bytes, even well-formed-looking ones', () => {
  const bytes = encode(epoch());
  assertRejects(`${bytes}x`);
  assertRejects(`${bytes}0`);
  assertRejects(`${bytes}2:ab`);
});

test('decode rejects a non-numeric or malformed length prefix', () => {
  const value = epoch();
  const bytes = encode(value);
  const firstField = `${Buffer.byteLength(value.familyId, 'utf8')}:${value.familyId}`;
  assert.ok(bytes.startsWith(firstField));

  const nonNumeric = bytes.replace(firstField, `x:${value.familyId}`);
  const noColon = bytes.replace(firstField, `${Buffer.byteLength(value.familyId, 'utf8')}.5${value.familyId}`);
  assert.notEqual(nonNumeric, bytes);
  assert.notEqual(noColon, bytes);
  assertRejects(nonNumeric);
  assertRejects(noColon);
});

test('decode rejects a leading-zero length prefix', () => {
  const value = epoch();
  const bytes = encode(value);
  const firstField = `${Buffer.byteLength(value.familyId, 'utf8')}:${value.familyId}`;
  assertRejects(bytes.replace(firstField, `0${Buffer.byteLength(value.familyId, 'utf8')}:${value.familyId}`));
});

test('decode rejects a length prefix that does not equal the consumed byte length', () => {
  // A single two-byte character can never satisfy a one-byte prefix (a
  // UTF-8 length cannot land mid-character).
  assertRejects('1:é');

  // Understated ASCII prefix: the field consumes one character less, so the
  // next read starts inside the remainder of the field -- here on a
  // non-digit character, which cannot begin a length prefix.
  const abBytes = encode(epoch({ familyId: 'ab' }));
  assert.ok(abBytes.startsWith('2:ab'));
  const understatedAscii = abBytes.replace('2:ab', '1:ab');
  assert.notEqual(understatedAscii, abBytes);
  assertRejects(understatedAscii);

  // Same reduced-by-one construction on a familyId made only of two-byte
  // code points: every code point boundary is even, so an odd prefix can
  // never be met exactly and the decoder must not stop mid-character.
  const multibyteFamilyId = 'عائلة';
  const multibyteBytes = encode(epoch({ familyId: multibyteFamilyId }));
  const multibytePrefix = `${Buffer.byteLength(multibyteFamilyId, 'utf8')}:${multibyteFamilyId}`;
  assert.ok(multibyteBytes.startsWith(multibytePrefix));
  assertRejects(
    multibyteBytes.replace(multibytePrefix, `${Buffer.byteLength(multibyteFamilyId, 'utf8') - 1}:${multibyteFamilyId}`),
  );

  // A prefix declaring more bytes than remain in the whole input must be
  // rejected while consuming the field, not silently merged with the rest.
  const overlong = encode(epoch()).replace('8:device-1', '999:device-1');
  assertRejects(overlong);
});

test('decode rejects an entry count that does not match the encoded entries', () => {
  const fields = canonicalFields(epoch());

  // Claims two entries but encodes one: the second entry read consumes the
  // issuedAt/supersedes tokens, and 'null' is not a family role.
  assertRejects(buildCanonical([...fields.slice(0, 3), '2', ...fields.slice(4)]));

  // Claims zero entries (parse.ts requires at least one).
  assertRejects(buildCanonical([...fields.slice(0, 3), '0', ...fields.slice(4)]));

  // Exceeds the policy ceiling (MAX_ENTRIES_PER_EPOCH = 64).
  assertRejects(buildCanonical([...fields.slice(0, 3), '65', ...fields.slice(4)]));

  // Claims one entry but two are encoded: the second entry's deviceId lands
  // in the issuedAt slot and fails the exact-ISO round-trip.
  const twoEntryFields = canonicalFields(epoch({ entries: [entry(), entry({ deviceId: 'device-2' })] }));
  assertRejects(buildCanonical([...twoEntryFields.slice(0, 3), '1', ...twoEntryFields.slice(4)]));
});

test('decode rejects a non-ISO or non-round-tripping issuedAt', () => {
  const fields = canonicalFields(epoch());
  const issuedAtIndex = fields.length - 2;
  const withIssuedAt = (token) => buildCanonical(fields.map((field, index) => (index === issuedAtIndex ? token : field)));

  assertRejects(withIssuedAt('2026-01-01T00:00:00Z')); // parses, but not the canonical ISO form
  assertRejects(withIssuedAt('2026-01-01T00:00:00.000+00:00')); // offset form, not the canonical Z form
  assertRejects(withIssuedAt('not-a-timestamp'));
});

test('decode rejects supersedesEpoch that is neither null nor a plausible epoch integer', () => {
  const fields = canonicalFields(epoch());
  const supersedesIndex = fields.length - 1;
  const withSupersedes = (token) =>
    buildCanonical(fields.map((field, index) => (index === supersedesIndex ? token : field)));

  assertRejects(withSupersedes('nullx'));
  assertRejects(withSupersedes('NULL'));
  assertRejects(withSupersedes('0')); // epoch numbers start at MIN_TRUST_SET_EPOCH = 1
  assertRejects(withSupersedes('-1'));
  assertRejects(withSupersedes('01')); // leading zero is not canonical
});

test('decode rejects empty input, empty fields, and unsafe oversized prefixes', () => {
  assertRejects('');
  assertRejects('0:');
  assertRejects('99999999999999999999:');
});

test('decode rejects input above MAX_CANONICAL_TRUST_SET_LENGTH', () => {
  const oversized = '0:'.repeat(131073); // 262146 characters
  assert.ok(oversized.length > MAX_CANONICAL_TRUST_SET_LENGTH);
  assertRejects(oversized);
});
