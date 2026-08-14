// Static shape/dependency proof for the payment provider abstraction
// (PCA-ADD-BILL-027/028): no provider SDK is a dependency of this repo, and
// no concrete PaymentProvider implementation exists in this lane.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('backend/package.json introduces zero payment-provider SDK dependencies (Stripe/PayPal/Mastercard/bank gateway)', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const prohibitedNamePatterns = /stripe|paypal|braintree|adyen|mastercard|square|checkout\.com|razorpay/i;
  for (const name of Object.keys(allDeps)) {
    assert.equal(prohibitedNamePatterns.test(name), false, `unexpected payment-provider SDK dependency: ${name}`);
  }
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['fastify', 'mysql2'], 'dependency set must remain unchanged by this lane');
});

test('providerContract.ts source contains no provider-SDK import statement', async () => {
  const source = await readFile(new URL('../../src/billing/providerContract.ts', import.meta.url), 'utf8');
  assert.equal(/^import .* from ['"](?!\.\/|\.\.\/|node:)/m.test(source), false, 'providerContract.ts must import nothing but relative/node built-in modules');
});

test('no file under backend/src/billing imports a Stripe/PayPal/payment-gateway SDK package', async () => {
  const { readdir } = await import('node:fs/promises');
  const dir = new URL('../../src/billing/', import.meta.url);
  const files = await readdir(dir);
  for (const file of files) {
    if (!file.endsWith('.ts')) continue;
    const content = await readFile(new URL(file, dir), 'utf8');
    assert.equal(/from ['"]stripe['"]|from ['"]paypal|from ['"]braintree/i.test(content), false, `${file} imports a payment-provider SDK`);
  }
});
