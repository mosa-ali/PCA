// PCA full read-only assessment finding F-17 / P2-13.
//
// Every mutating route in this service sets its own tight bodyLimit (1 KiB to
// 96 KiB), but the Fastify INSTANCE previously declared none, so a route that
// forgot to set one silently inherited Fastify's 1 MiB framework default rather
// than any project-wide ceiling. GLOBAL_BODY_LIMIT_BYTES now supplies that
// ceiling.
//
// The subtle risk in adding a global ceiling is the opposite direction: if it is
// ever set at or below a route's own limit, that route's legitimate requests
// start being rejected with 413 -- and nothing else would catch it, because each
// route's own limit is still "correct". So this test pins the invariant rather
// than the number: the ceiling must stay below the framework default it exists
// to improve on, and every route must either sit under the ceiling or be a
// REGISTERED, contract-driven override of it.
//
// The register exists because the first version of this gate got the model
// wrong: it asserted "ceiling > every declared per-route limit", which held only
// by coincidence (no route had ever needed more than 96 KiB) and which actively
// FORBADE the correct fix for /v1/runtime-sync/outbound -- a route whose own
// contract is legitimately multi-megabyte. A ceiling that no route may ever
// exceed is not a ceiling, it is a bug; raising the global instead would have
// weakened all ~26 other routes at once.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GLOBAL_BODY_LIMIT_BYTES } from '../../dist/http/buildServer.js';
import { MAX_OUTBOUND_BODY_BYTES } from '../../dist/http/routes/runtimeSyncRoutes.js';

const HTTP_DIR = fileURLToPath(new URL('../../src/http/', import.meta.url));
const BUILD_SERVER_PATH = fileURLToPath(new URL('../../src/http/buildServer.ts', import.meta.url));

/** Fastify's own default, which this ceiling exists to tighten. */
const FASTIFY_DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * Evaluates the restricted arithmetic the route modules actually use for their
 * limits (`96 * 1024`, `2048`, ...). Deliberately not `eval`: a string-building
 * escape here would be a worse bug than the one being tested. Returns null for
 * anything unrecognised so the caller can fail loudly rather than skip.
 */
function evaluateByteExpression(expression) {
  const parts = expression.split('*').map((part) => part.trim());
  if (parts.length === 0 || parts.length > 2) return null;
  let product = 1;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    product *= Number(part);
  }
  return product;
}

function perRouteBodyLimits() {
  const found = new Map();
  for (const entry of readdirSync(HTTP_DIR, { recursive: true })) {
    if (!String(entry).endsWith('.ts')) continue;
    const text = readFileSync(join(HTTP_DIR, String(entry)), 'utf8');
    for (const match of text.matchAll(/const (MAX_[A-Z_]*BODY_BYTES)\s*=\s*([^;]+);/g)) {
      const value = evaluateByteExpression(match[2].replace(/\/\/.*$/, '').trim());
      if (value === null) {
        throw new Error(`unrecognised body-limit expression in ${entry}: ${match[2].trim()}`);
      }
      found.set(`${entry}:${match[1]}`, value);
    }
  }
  return found;
}

test('NEGATIVE CONTROL: the byte-expression evaluator handles both real forms and rejects anything else', () => {
  assert.equal(evaluateByteExpression('4 * 1024'), 4096);
  assert.equal(evaluateByteExpression('2048'), 2048);
  assert.equal(evaluateByteExpression('96 * 1024'), 98304);
  assert.equal(evaluateByteExpression('process.env.X'), null, 'must not silently accept arbitrary code');
  assert.equal(evaluateByteExpression('1024 * SIZE'), null);
  assert.equal(evaluateByteExpression('1 * 2 * 3'), null, 'more than one multiplication is out of scope');
});

/**
 * Routes permitted to declare a body limit ABOVE the global ceiling.
 *
 * The ceiling applies to routes that declare nothing. A route whose own contract
 * needs more MUST override it locally and be listed here with the reason:
 * inheriting the ceiling would reject contract-legal requests with 413, and
 * raising the ceiling globally would weaken every other route at once.
 */
const DELIBERATE_CEILING_OVERRIDES = new Set(['MAX_OUTBOUND_BODY_BYTES']);

test('PCA-P2-13: every route either sits under the ceiling or deliberately overrides it', () => {
  const limits = perRouteBodyLimits();
  assert.ok(limits.size >= 25, `expected to find the route body limits; found only ${limits.size}`);

  const overrides = [...limits.entries()]
    .filter(([, value]) => value > GLOBAL_BODY_LIMIT_BYTES)
    .map(([name, value]) => ({ name: name.split(':').pop(), value }));

  for (const { name, value } of overrides) {
    assert.ok(
      DELIBERATE_CEILING_OVERRIDES.has(name),
      `${name} (${value}) exceeds the global ceiling (${GLOBAL_BODY_LIMIT_BYTES}) but is not registered in ` +
        'DELIBERATE_CEILING_OVERRIDES; a route may exceed the ceiling only deliberately -- either lower it, ' +
        'or record the contract reason that requires it',
    );
  }

  assert.deepEqual(
    overrides.map((entry) => entry.name).sort(),
    [...DELIBERATE_CEILING_OVERRIDES].sort(),
    'the register must match reality in both directions, so it cannot rot into a stale allowlist',
  );

  const bounded = limits.size - overrides.length;
  assert.ok(bounded >= 25, `expected at least 25 routes bounded by the ceiling; ${bounded} are`);

  assert.ok(
    GLOBAL_BODY_LIMIT_BYTES < FASTIFY_DEFAULT_BODY_LIMIT_BYTES,
    `the global ceiling (${GLOBAL_BODY_LIMIT_BYTES}) must be below Fastify's ${FASTIFY_DEFAULT_BODY_LIMIT_BYTES} default, ` +
      'or it would not tighten anything',
  );
});

// Found by an independent adversarial review, and a real regression when first
// shipped: this detector only sees `const MAX_*BODY_BYTES = <expr>;`, so it is
// blind to BOTH routes with an inline limit and routes with NO limit at all --
// and a route with no limit is exactly the case that changes when a global
// ceiling is introduced (1 MiB -> the new ceiling). Claiming the ceiling
// "cannot change any existing route's behaviour" was therefore false.
//
// /v1/runtime-sync/outbound is the route where that mattered: its own contract
// accepts up to MAX_OUTBOUND_BATCH_SIZE envelopes of up to
// MAX_CIPHERTEXT_BASE64_LENGTH characters each, so a contract-legal batch is
// megabytes and three maximum-size envelopes already exceed 256 KiB. It now
// carries an explicit, contract-sized limit, and this test locks that in: if the
// outlier ever falls back to the global ceiling, this fails.
test('PCA-P2-13 (regression): the runtime-sync outbound route is explicitly bounded above the global ceiling', () => {
  assert.ok(
    MAX_OUTBOUND_BODY_BYTES > GLOBAL_BODY_LIMIT_BYTES,
    `MAX_OUTBOUND_BODY_BYTES (${MAX_OUTBOUND_BODY_BYTES}) must exceed GLOBAL_BODY_LIMIT_BYTES (${GLOBAL_BODY_LIMIT_BYTES}); ` +
      'this route carries multi-megabyte contract-legal batches and must not inherit the global ceiling',
  );
  assert.ok(
    MAX_OUTBOUND_BODY_BYTES > FASTIFY_DEFAULT_BODY_LIMIT_BYTES,
    `MAX_OUTBOUND_BODY_BYTES (${MAX_OUTBOUND_BODY_BYTES}) must also exceed Fastify's former ${FASTIFY_DEFAULT_BODY_LIMIT_BYTES} default, ` +
      'because the previous default was ALREADY below this route\'s contract -- sizing it lower would regress batches that used to work',
  );
});

test('PCA-P2-13: the ceiling is actually wired onto the Fastify instance', () => {
  const source = readFileSync(BUILD_SERVER_PATH, 'utf8');
  assert.match(
    source,
    /const app = Fastify\(\{[\s\S]*?bodyLimit:\s*GLOBAL_BODY_LIMIT_BYTES/,
    'buildServer must pass GLOBAL_BODY_LIMIT_BYTES to Fastify, not merely declare the constant',
  );
});
