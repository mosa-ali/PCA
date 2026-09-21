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
// than the number: the ceiling must exceed every per-route limit, and stay below
// the framework default it exists to improve on.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GLOBAL_BODY_LIMIT_BYTES } from '../../dist/http/buildServer.js';

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

test('PCA-P2-13: the global request-body ceiling is above every per-route limit and below the framework default', () => {
  const limits = perRouteBodyLimits();
  assert.ok(limits.size >= 25, `expected to find the route body limits; found only ${limits.size}`);

  const highest = Math.max(...limits.values());
  const highestName = [...limits.entries()].find(([, value]) => value === highest)[0];

  assert.ok(
    GLOBAL_BODY_LIMIT_BYTES > highest,
    `the global ceiling (${GLOBAL_BODY_LIMIT_BYTES}) must exceed the highest per-route limit (${highest} at ${highestName}), ` +
      'or that route would start rejecting legitimate requests with 413',
  );
  assert.ok(
    GLOBAL_BODY_LIMIT_BYTES < FASTIFY_DEFAULT_BODY_LIMIT_BYTES,
    `the global ceiling (${GLOBAL_BODY_LIMIT_BYTES}) must be below Fastify's ${FASTIFY_DEFAULT_BODY_LIMIT_BYTES} default, ` +
      'or it would not tighten anything',
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
