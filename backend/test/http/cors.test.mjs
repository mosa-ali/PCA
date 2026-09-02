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

test('parent-web CORS preflights GET/HEAD/POST/PATCH/DELETE and refuses PUT and every other method', async () => {
  const app = Fastify({ logger: false });
  registerParentWebCors(app, 'http://localhost:4000');
  app.get('/api/parent/session', async () => ({ ok: true }));
  await app.ready();

  const preflight = async (requestedMethod) =>
    app.inject({
      method: 'OPTIONS',
      url: '/api/parent/session',
      headers: {
        origin: 'http://localhost:4000',
        'access-control-request-method': requestedMethod,
        'access-control-request-headers': 'content-type, x-pca-csrf-token',
      },
    });

  // DELETE is a registered, credentialed, cross-origin parent route (safe-zone deletion), so it
  // mandates a preflight and omitting it from the allowlist would 403 before the route is reached.
  for (const method of ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']) {
    const allowed = await preflight(method);
    assert.equal(allowed.statusCode, 204, `expected ${method} preflight to be allowed`);
    assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:4000');
    assert.ok(
      allowed.headers['access-control-allow-methods'].split(', ').includes(method),
      `expected ${method} to be advertised in Access-Control-Allow-Methods`,
    );
  }

  // The allowlist stays an allowlist: methods no cross-origin client sends are refused. PUT is in
  // that set -- the only PUT routes are same-origin platform-admin settings routes, which are
  // rejected at the origin check long before the method is inspected, so granting PUT here would
  // widen the cross-origin surface for no client.
  for (const method of ['PUT', 'TRACE', 'CONNECT', 'PROPFIND']) {
    const rejected = await preflight(method);
    assert.equal(rejected.statusCode, 403, `expected ${method} preflight to be rejected`);
    assert.equal(rejected.headers['access-control-allow-methods'], undefined);
  }

  // ... and PUT is not advertised either, so a browser never caches it as permitted.
  const advertised = (await preflight('POST')).headers['access-control-allow-methods'].split(', ');
  assert.ok(!advertised.includes('PUT'), 'PUT must not be advertised in Access-Control-Allow-Methods');

  await app.close();
});
