import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryEmailOutboxRepository } from '../../dist/email/InMemoryEmailOutboxRepository.js';
import { EmailService } from '../../dist/email/EmailService.js';
import { EmailDeliveryError } from '../../dist/email/EmailProviderAdapter.js';

const ENV = { NODE_ENV: 'test' };

class ScriptedProviderAdapter {
  constructor(script = []) {
    this.providerName = 'SCRIPTED_TEST_PROVIDER';
    this.script = script;
    this.calls = [];
  }
  async send(message) {
    this.calls.push(message);
    const next = this.script.shift();
    if (!next) return { providerMessageId: 'default-msg' };
    if (next.throw) throw next.throw;
    return next.result;
  }
}

test('implements EmailSenderPort: sendVerificationCode resolves on immediate success', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const provider = new ScriptedProviderAdapter([{ result: { providerMessageId: 'msg-1' } }]);
  const service = new EmailService({ repository: repo, providerAdapter: provider, env: ENV });
  await assert.doesNotReject(() => service.sendVerificationCode('parent@example.com', '123456'));
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].toEmail, 'parent@example.com');
});

test('resolves normally even when the immediate send attempt fails (retryable) -- the outbox worker retries later, matching ParentAccountService\'s existing best-effort/swallowed contract', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const provider = new ScriptedProviderAdapter([{ throw: new EmailDeliveryError('transient', true) }]);
  const service = new EmailService({ repository: repo, providerAdapter: provider, env: ENV });
  await assert.doesNotReject(() => service.sendPasswordResetCode('parent@example.com', '654321'));
  assert.equal(provider.calls.length, 1);
});

test('a duplicate call with the SAME kind/email/code is idempotent -- enqueues once, never double-sends', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const provider = new ScriptedProviderAdapter([{ result: { providerMessageId: 'msg-1' } }, { result: { providerMessageId: 'msg-2' } }]);
  const service = new EmailService({ repository: repo, providerAdapter: provider, env: ENV });
  await service.sendVerificationCode('parent@example.com', '123456');
  await service.sendVerificationCode('parent@example.com', '123456');
  assert.equal(provider.calls.length, 1, 'the second call must be recognized as a duplicate enqueue and never reach the provider again');
});

test('a DIFFERENT code for the same email is treated as a distinct message (not deduplicated)', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const provider = new ScriptedProviderAdapter([{ result: { providerMessageId: 'msg-1' } }, { result: { providerMessageId: 'msg-2' } }]);
  const service = new EmailService({ repository: repo, providerAdapter: provider, env: ENV });
  await service.sendVerificationCode('parent@example.com', '111111');
  await service.sendVerificationCode('parent@example.com', '222222');
  assert.equal(provider.calls.length, 2);
});

test('email normalization: differently-cased email addresses for the same code are still deduplicated', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const provider = new ScriptedProviderAdapter([{ result: { providerMessageId: 'msg-1' } }]);
  const service = new EmailService({ repository: repo, providerAdapter: provider, env: ENV });
  await service.sendVerificationCode('Parent@Example.com', '123456');
  await service.sendVerificationCode('parent@example.com', '123456');
  assert.equal(provider.calls.length, 1);
});

test('SECURITY: the outbox row never holds the plaintext recipient or code -- only ciphertext, until purged on completion', async () => {
  const repo = new InMemoryEmailOutboxRepository();
  const service = new EmailService({ repository: repo, providerAdapter: { providerName: 'SLOW', send: () => new Promise(() => {}) }, env: ENV });
  const pending = service.sendVerificationCode('parent@example.com', '123456');
  // Give the enqueue (synchronous relative to the never-resolving send) a tick to land.
  await new Promise((resolve) => setImmediate(resolve));
  const rows = repo.getAllRowsForTest();
  assert.equal(rows.length, 1);
  const stored = JSON.stringify(rows[0]);
  assert.equal(stored.includes('parent@example.com'), false);
  assert.equal(stored.includes('123456'), false);
  void pending; // deliberately never awaited -- the provider above never resolves
});
