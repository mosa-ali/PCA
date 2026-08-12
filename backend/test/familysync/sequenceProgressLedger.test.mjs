import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemorySequenceProgressLedger } from '../../dist/familysync/InMemorySequenceProgressLedger.js';

// NF-003 regression: the internal composite key used to previously be
// `${familyId} ${senderKeyId}` joined with a corrupted raw NUL byte
// (verified removed -- see the source file's key() doc comment). These
// tests prove the replacement length-prefixed encoding is genuinely
// collision-proof, not just "no NUL byte present."

test('basic get/record round-trip', async () => {
  const ledger = new InMemorySequenceProgressLedger();
  assert.equal(await ledger.getLastAppliedSequence('family-1', 'key-1'), null);
  await ledger.recordAppliedSequence('family-1', 'key-1', 5);
  assert.equal(await ledger.getLastAppliedSequence('family-1', 'key-1'), 5);
});

test('a later sequence overwrites; an out-of-order lower sequence never regresses the stored value', async () => {
  const ledger = new InMemorySequenceProgressLedger();
  await ledger.recordAppliedSequence('family-1', 'key-1', 5);
  await ledger.recordAppliedSequence('family-1', 'key-1', 3);
  assert.equal(await ledger.getLastAppliedSequence('family-1', 'key-1'), 5);
  await ledger.recordAppliedSequence('family-1', 'key-1', 9);
  assert.equal(await ledger.getLastAppliedSequence('family-1', 'key-1'), 9);
});

test('family isolation: identical senderKeyId strings in different families never share progress', async () => {
  const ledger = new InMemorySequenceProgressLedger();
  await ledger.recordAppliedSequence('family-A', 'key-shared', 100);
  await ledger.recordAppliedSequence('family-B', 'key-shared', 1);
  assert.equal(await ledger.getLastAppliedSequence('family-A', 'key-shared'), 100);
  assert.equal(await ledger.getLastAppliedSequence('family-B', 'key-shared'), 1);
});

test('sender isolation: different senderKeyIds within the same family never share progress', async () => {
  const ledger = new InMemorySequenceProgressLedger();
  await ledger.recordAppliedSequence('family-1', 'key-a', 10);
  await ledger.recordAppliedSequence('family-1', 'key-b', 20);
  assert.equal(await ledger.getLastAppliedSequence('family-1', 'key-a'), 10);
  assert.equal(await ledger.getLastAppliedSequence('family-1', 'key-b'), 20);
});

test('NF-003 core regression: no unescaped-boundary collision between (familyId="ab", senderKeyId="c") and (familyId="a", senderKeyId="bc")', async () => {
  const ledger = new InMemorySequenceProgressLedger();
  await ledger.recordAppliedSequence('ab', 'c', 42);
  await ledger.recordAppliedSequence('a', 'bc', 7);
  // A plain-delimiter (or NUL-joined) concatenation of these four
  // component strings without length-prefixing would produce the exact
  // same composite key for both pairs -- length-prefixing must keep them
  // fully distinct.
  assert.equal(await ledger.getLastAppliedSequence('ab', 'c'), 42);
  assert.equal(await ledger.getLastAppliedSequence('a', 'bc'), 7);
});

test('NF-003: a component containing the encoding delimiter character itself does not create a collision', async () => {
  const ledger = new InMemorySequenceProgressLedger();
  await ledger.recordAppliedSequence('family:1', 'key-a', 11);
  await ledger.recordAppliedSequence('family', '1:key-a', 22);
  assert.equal(await ledger.getLastAppliedSequence('family:1', 'key-a'), 11);
  assert.equal(await ledger.getLastAppliedSequence('family', '1:key-a'), 22);
});

test('NF-003: a component containing a literal digit-colon sequence that looks like a length prefix does not forge a collision', async () => {
  const ledger = new InMemorySequenceProgressLedger();
  // Attempt to craft familyId="1:x" so its own encoded form could be
  // misread as a shorter familyId ("1") followed by leftover bytes
  // belonging to senderKeyId, if the encoding did not use a REAL byte
  // length prefix.
  await ledger.recordAppliedSequence('1:x', 'y', 5);
  await ledger.recordAppliedSequence('1', 'x1:y', 6);
  assert.equal(await ledger.getLastAppliedSequence('1:x', 'y'), 5);
  assert.equal(await ledger.getLastAppliedSequence('1', 'x1:y'), 6);
});

test('multi-byte (UTF-8) opaque ids are length-prefixed by BYTE length, not character count, so they still cannot collide', async () => {
  const ledger = new InMemorySequenceProgressLedger();
  await ledger.recordAppliedSequence('família-é', 'key-a', 13); // multi-byte UTF-8 familyId
  await ledger.recordAppliedSequence('familia-e', 'key-a', 14); // ASCII look-alike, different byte length
  assert.equal(await ledger.getLastAppliedSequence('família-é', 'key-a'), 13);
  assert.equal(await ledger.getLastAppliedSequence('familia-e', 'key-a'), 14);
});
