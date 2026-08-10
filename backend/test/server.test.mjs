import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../dist/server.js';

test('health endpoint has no family-data surface', async () => {
  const app = buildServer();
  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { service: 'pca-backend', status: 'ok' });
    const unavailable = await app.inject({ method: 'GET', url: '/families' });
    assert.equal(unavailable.statusCode, 404);
  } finally {
    await app.close();
  }
});
