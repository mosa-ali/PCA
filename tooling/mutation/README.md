# tooling/mutation -- read before citing any number from it

**This harness executes zero tests.** `run-mutation.mjs` copies a package to a
temp directory, applies one declared string mutation, and then runs the
`check-*-boundaries.mjs` scripts, which are literal `requireText`/`forbidText`
assertions over source text. A mutant is `KILLED` when one of those hardcoded
string assertions notices that the string it edits changed -- a tautology when
the assertion was written for that exact anchor. `EQUIVALENT` and `INVALID` are
asserted by `mutation-scope.json` (`expectedClassification`), never derived.

Consequently `VALID_MUTATION_SURVIVORS = 0` is reproducible and means nothing
about test strength. Six historical documents cite it as quality evidence;
those citations are historical and must not be repeated. The R3 progress
ledger already marks the figures `NOT_PROVEN_AT_CURRENT_HEAD` whenever the
report's SHA is not today's HEAD, and the report JSON now carries
`executesTests: false`.

A real mutation run would have to execute the requirement's listed test files
(`backend/test/mutation/*.test.mjs`, `parent-web/tests/mutation/*.test.ts`,
Android `PrivacyBoundaryMutationTest`) against the mutated copy, with the
package built and its dependencies installed there. That was deliberately not
built during the 2026-09-08 assessment: it is a genuine engineering item, not a
documentation fix, and this harness is not wired into CI, so leaving it
labelled honestly costs nothing.
