import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { DEFAULT_PARENT_WEB_ORIGIN, registerParentWebCors, resolveParentWebOrigin } from '../../dist/http/parentWebCors.js';

test('parent-web CORS defaults to the local parent console origin and rejects malformed configuration', () => {
  assert.equal(resolveParentWebOrigin({}), DEFAULT_PARENT_WEB_ORIGIN);
  assert.equal(resolveParentWebOrigin({ PCA_PARENT_WEB_ORIGIN: 'https://parent.example.test' }), 'https://parent.example.test');
  assert.throws(() => resolveParentWebOrigin({ PCA_PARENT_WEB_ORIGIN: 'https://parent.example.test/path' }));
  assert.throws(() => resolveParentWebOrigin({ PCA_PARENT_WEB_ORIGIN: '*' }));
});

test('parent-web CORS allows credentialed reads and the CSRF preflight from the exact configured origin only', async () => {
  const app = Fastify({ logger: false });
  registerParentWebCors(app, 'http://localhost:4000');
  app.get('/api/parent/session', async () => ({ ok: true }));
  await app.ready();

  const read = await app.inject({ method: 'GET', url: '/api/parent/session', headers: { origin: 'http://localhost:4000' } });
  assert.equal(read.statusCode, 200);
  assert.equal(read.headers['access-control-allow-origin'], 'http://localhost:4000');
  assert.equal(read.headers['access-control-allow-credentials'], 'true');

  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/api/parent/session',
    headers: {
      origin: 'http://localhost:4000',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type, x-pca-csrf-token',
    },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:4000');

  const wrongOrigin = await app.inject({ method: 'OPTIONS', url: '/api/parent/session', headers: { origin: 'https://evil.example.test', 'access-control-request-method': 'POST' } });
  assert.equal(wrongOrigin.statusCode, 403);
  await app.close();
});
