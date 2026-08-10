import { createHash } from 'node:crypto';

// TEST-ONLY verified-identity issuer. This file lives entirely under
// backend/test/ -- it is not part of the TypeScript build (tsconfig's
// "include" is src/**/*.ts only) and nothing under backend/src/ imports
// from backend/test/, so it structurally cannot reach backend/dist/ or a
// production runtime. See test/db/auth.pg.test.mjs's
// "test identity provider impossible in production runtime" assertion for
// the automated proof.
//
// A real identity provider (passkey / platform authentication / reviewed
// external IdP integration) is a separate, later, production-controlled
// concern. This stub only produces the VerifiedIdentity shape AuthService
// expects, from a synthetic test subject id -- it performs no actual
// credential verification and must never be treated as one.
export function verifyTestOnlyIdentity(syntheticSubjectId) {
  if (typeof syntheticSubjectId !== 'string' || syntheticSubjectId.length === 0) {
    throw new Error('verifyTestOnlyIdentity requires a non-empty synthetic subject id.');
  }
  return {
    accountReferenceHash: createHash('sha256').update(`test-only:${syntheticSubjectId}`, 'utf8').digest(),
  };
}
