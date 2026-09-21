import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {
  DEFAULT_PARENT_WEB_ORIGIN,
  InsecureProductionOriginError,
  MissingParentWebOriginError,
  registerParentWebCors,
  resolveParentWebOrigin,
  resolvePlatformAdminWebOrigin,
} from '../../dist/http/parentWebCors.js';

test('parent-web CORS uses the local parent console origin only in non-production runtimes', () => {
  // Development/test keep the deliberate localhost default so local work needs no configuration.
  assert.equal(resolveParentWebOrigin({ NODE_ENV: 'test' }), DEFAULT_PARENT_WEB_ORIGIN);
  assert.equal(resolveParentWebOrigin({ NODE_ENV: 'development' }), DEFAULT_PARENT_WEB_ORIGIN);
  assert.equal(
    resolveParentWebOrigin({ NODE_ENV: 'test', PCA_PARENT_WEB_ORIGIN: 'http://localhost:4000' }),
    DEFAULT_PARENT_WEB_ORIGIN,
  );

  // Production accepts an explicit https origin.
  assert.equal(
    resolveParentWebOrigin({ NODE_ENV: 'production', PCA_PARENT_WEB_ORIGIN: 'https://parent.pcasafe.com' }),
    'https://parent.pcasafe.com',
  );

  // Malformed configuration is rejected in every runtime.
  assert.throws(() => resolveParentWebOrigin({ NODE_ENV: 'test', PCA_PARENT_WEB_ORIGIN: 'https://parent.example.test/path' }));
  assert.throws(() => resolveParentWebOrigin({ NODE_ENV: 'test', PCA_PARENT_WEB_ORIGIN: '*' }));
  assert.throws(() => resolveParentWebOrigin({ NODE_ENV: 'test', PCA_PARENT_WEB_ORIGIN: 'ftp://parent.example.test' }));
});

// PCA full read-only assessment, finding P1-02. An unset or unrecognized
// NODE_ENV is production-sensitive by design (runtime/environment.ts), so the
// resolver must fail closed rather than silently trusting a localhost origin.
test('SECURITY (P1-02): parent-web CORS fails closed in production when PCA_PARENT_WEB_ORIGIN is unset or blank', () => {
  assert.throws(() => resolveParentWebOrigin({}), MissingParentWebOriginError, 'unset NODE_ENV is production-sensitive');
  assert.throws(() => resolveParentWebOrigin({ NODE_ENV: 'production' }), MissingParentWebOriginError);
  assert.throws(() => resolveParentWebOrigin({ NODE_ENV: 'production', PCA_PARENT_WEB_ORIGIN: '   ' }), MissingParentWebOriginError);
  assert.throws(() => resolveParentWebOrigin({ NODE_ENV: 'Production' }), MissingParentWebOriginError, 'wrong-case value is not recognized');
});

test('SECURITY (P1-02): parent-web CORS refuses a plaintext origin in production but allows it locally', () => {
  assert.throws(
    () => resolveParentWebOrigin({ NODE_ENV: 'production', PCA_PARENT_WEB_ORIGIN: 'http://parent.pcasafe.com' }),
    InsecureProductionOriginError,
  );
  assert.equal(
    resolveParentWebOrigin({ NODE_ENV: 'test', PCA_PARENT_WEB_ORIGIN: 'http://localhost:5173' }),
    'http://localhost:5173',
    'http remains permitted outside production so local development is unaffected',
  );
});

test('platform-admin origin is optional, is never a localhost fallback, and requires https in production', () => {
  assert.equal(resolvePlatformAdminWebOrigin({ NODE_ENV: 'test' }), null);
  assert.equal(resolvePlatformAdminWebOrigin({ NODE_ENV: 'production' }), null, 'absent means same-origin deployment, not a fallback');
  assert.equal(
    resolvePlatformAdminWebOrigin({ NODE_ENV: 'production', PCA_PLATFORM_ADMIN_WEB_ORIGIN: 'https://platform.pcasafe.com' }),
    'https://platform.pcasafe.com',
  );
  assert.throws(
    () => resolvePlatformAdminWebOrigin({ NODE_ENV: 'production', PCA_PLATFORM_ADMIN_WEB_ORIGIN: 'http://platform.pcasafe.com' }),
    InsecureProductionOriginError,
  );
  assert.throws(() => resolvePlatformAdminWebOrigin({ NODE_ENV: 'test', PCA_PLATFORM_ADMIN_WEB_ORIGIN: '*' }));
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

// PCA full assessment ARCH-001 / P0-05: the Platform Administration console is a
// separate authority plane whose documented topology (platform.pcasafe.com ->
// console, api.pcasafe.com -> API) is cross-origin, but before this change it had
// no admissible origin at all. It is now expressible -- WITHOUT widening the
// parent plane, and without a wildcard -- and gets its own method allowlist.
test('platform-admin origin, when configured, gets its own method allowlist: PUT is granted there and never to the parent origin', async () => {
  const app = Fastify({ logger: false });
  registerParentWebCors(app, 'https://parent.pcasafe.com', 'https://platform.pcasafe.com');
  app.get('/api/parent/session', async () => ({ ok: true }));
  app.put('/platform-admin/settings', async () => ({ ok: true }));
  await app.ready();

  const preflight = (origin, requestedMethod) =>
    app.inject({
      method: 'OPTIONS',
      url: '/platform-admin/settings',
      headers: {
        origin,
        'access-control-request-method': requestedMethod,
        'access-control-request-headers': 'authorization, content-type',
      },
    });

  const adminPut = await preflight('https://platform.pcasafe.com', 'PUT');
  assert.equal(adminPut.statusCode, 204, 'the admin console must be able to PUT its settings once explicitly configured');
  assert.equal(adminPut.headers['access-control-allow-origin'], 'https://platform.pcasafe.com');
  assert.ok(adminPut.headers['access-control-allow-methods'].split(', ').includes('PUT'));

  const parentPut = await preflight('https://parent.pcasafe.com', 'PUT');
  assert.equal(parentPut.statusCode, 403, 'PUT must never be granted to the parent origin');
  assert.equal(parentPut.headers['access-control-allow-methods'], undefined);

  const unknownOrigin = await preflight('https://evil.example.test', 'GET');
  assert.equal(unknownOrigin.statusCode, 403);
  assert.equal(unknownOrigin.headers['access-control-allow-origin'], undefined);

  await app.close();
});
