import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evaluateSchedule } from '../../dist/schedule/engine.js';

/**
 * Feeds contracts/schedule-runtime/vectors/schedule-conformance-v1.json into the UNMODIFIED
 * reference engine (backend/src/schedule/engine.ts, via its build output). This is the TS side
 * of PCA-RUNTIME-SCHEDULE-1's cross-runtime conformance suite -- the Kotlin evaluator
 * (android/.../runtime/schedule/ScheduleEvaluator.kt) is checked against the SAME vector file in
 * ScheduleConformanceVectorTest.kt. A failure here means either a vector was mis-derived from
 * engine.ts's documented precedence, or a real behavior change in the reference engine -- per
 * mission section 8, this file must never be "fixed" by editing engine.ts's own logic; a real
 * mismatch is recorded, not silently patched.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const vectorsPath = path.join(here, '..', '..', '..', 'contracts', 'schedule-runtime', 'vectors', 'schedule-conformance-v1.json');
const { vectors } = JSON.parse(readFileSync(vectorsPath, 'utf8'));

function reviveDate(value) {
  return value === null || value === undefined ? undefined : new Date(value);
}

function toEvaluationInput(input) {
  return {
    nowUtc: reviveDate(input.nowUtc),
    timezone: input.timezone,
    appToken: input.appToken,
    windows: input.windows,
    bonusGrants: input.bonusGrants.map((grant) => ({
      ...grant,
      grantedAtUtc: reviveDate(grant.grantedAtUtc),
      expiresAtUtc: reviveDate(grant.expiresAtUtc),
    })),
    exceptions: input.exceptions.map((exception) => ({
      ...exception,
      startAtUtc: reviveDate(exception.startAtUtc),
      endAtUtc: reviveDate(exception.endAtUtc),
    })),
    dailyLimit: input.dailyLimit ?? undefined,
    enforcementCapability: input.enforcementCapability,
    connectivity: input.connectivity,
    lastPolicySyncAtUtc: reviveDate(input.lastPolicySyncAtUtc) ?? null,
  };
}

test(`schedule-conformance-v1.json has vectors`, () => {
  assert.ok(vectors.length > 0, 'expected at least one shared conformance vector');
});

for (const vector of vectors) {
  test(`conformance vector: ${vector.id}`, () => {
    const result = evaluateSchedule(toEvaluationInput(vector.input));
    const expected = vector.expected;

    assert.equal(result.decision, expected.decision, `decision mismatch for ${vector.id}`);

    if ('matchedWindowId' in expected) {
      assert.equal(result.matchedWindowId, expected.matchedWindowId, `matchedWindowId mismatch for ${vector.id}`);
    }
    if ('matchedWindowIds' in expected) {
      assert.deepEqual(result.matchedWindowIds, expected.matchedWindowIds, `matchedWindowIds mismatch for ${vector.id}`);
    }
    if ('intendedDecision' in expected) {
      assert.equal(result.intendedDecision, expected.intendedDecision, `intendedDecision mismatch for ${vector.id}`);
    }
    if ('remainingMinutesToday' in expected) {
      assert.equal(result.remainingMinutesToday, expected.remainingMinutesToday, `remainingMinutesToday mismatch for ${vector.id}`);
    }
    if (expected.hasConfigErrors) {
      assert.ok(result.configErrors && result.configErrors.length > 0, `expected configErrors for ${vector.id}`);
    }
  });
}
