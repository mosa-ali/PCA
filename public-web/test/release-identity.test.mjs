import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function source(relativePath) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

test('every production container requires and records an exact source SHA', async () => {
  const dockerfiles = [
    'backend/Dockerfile',
    'parent-web/Dockerfile',
    'platform-admin-web/Dockerfile',
    'public-web/deploy/Dockerfile',
  ];
  for (const dockerfile of dockerfiles) {
    const text = await source(dockerfile);
    assert.match(text, /ARG PCA_BUILD_SOURCE_SHA/, `${dockerfile} must require source provenance`);
    assert.match(text, /grep -Eq '\^\[0-9a-f\]\{40\}\$'/, `${dockerfile} must enforce a full lowercase SHA`);
    assert.match(text, /org\.opencontainers\.image\.revision="\$\{PCA_BUILD_SOURCE_SHA\}"/, `${dockerfile} must label the image`);
  }
});

test('release identity compares image provenance and covers both claim registers', async () => {
  const text = await source('public-web/deploy/release-identity.mjs');
  assert.match(text, /org\.opencontainers\.image\.revision/);
  assert.match(text, /imageSourceSha !== sha/);
  assert.match(text, /PCA_Public_Programme_Documentation_Package_v0\.2\/PCA_PUBLIC_CLAIM_REGISTER\.csv/);
  assert.match(text, /REFUSING TO ISSUE A RELEASE IDENTITY: provenance checks failed/);
});

test('local compose passes exact source provenance and uses the supported MySQL line', async () => {
  const text = await source('docker-compose.yml');
  assert.equal((text.match(/PCA_BUILD_SOURCE_SHA: \$\{PCA_BUILD_SOURCE_SHA:\?/g) ?? []).length, 2);
  assert.match(text, /image: mysql:8\.4\.11/);
  assert.match(text, /--collation-server=utf8mb4_bin/);
  assert.match(text, /--default-time-zone=\+00:00/);
});
