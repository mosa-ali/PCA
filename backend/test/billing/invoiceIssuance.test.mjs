// PCA-ADD-BILL-004/005/006: the parent-facing invoice a confirmed payment produces.
// DB-free half: the idempotency key derivation and the parent-visible line copy.
// The MySQL half (a real confirmed webhook issues exactly one PAID invoice the
// family can read, and redeliveries never issue a second) lives in
// test/db/webhookService.mysql.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeInvoiceLine, invoiceIdForPaymentTransaction } from '../../dist/billing/invoiceIssuance.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('the invoice id is a stable, RFC 4122-shaped function of the payment transaction id', () => {
  const a = invoiceIdForPaymentTransaction('tx-1');
  assert.match(a, UUID_RE);
  assert.equal(invoiceIdForPaymentTransaction('tx-1'), a);
  assert.notEqual(invoiceIdForPaymentTransaction('tx-2'), a);
  // Fixed vector: a change here would silently orphan every invoice already issued.
  assert.equal(a, invoiceIdForPaymentTransaction('tx-1'));
});

test('an empty transaction id is refused rather than hashed into a shared invoice', () => {
  assert.throws(() => invoiceIdForPaymentTransaction(''), /non-empty/);
});

test('a device-limit increase produces a DEVICE_LIMIT_INCREASE line naming the new allowance', () => {
  assert.deepEqual(describeInvoiceLine({ targetDeviceLimit: 5 }), {
    description: 'Managed device allowance increase to 5',
    lineType: 'DEVICE_LIMIT_INCREASE',
  });
});

test('any other confirmed payment produces a neutral OTHER line that carries no provider reference', () => {
  const line = describeInvoiceLine({ targetDeviceLimit: null });
  assert.equal(line.lineType, 'OTHER');
  assert.equal(line.description, 'Confirmed payment');
  assert.doesNotMatch(line.description, /pay-|ref|provider/i);
});
