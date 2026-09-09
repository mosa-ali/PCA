# tooling/mutation -- read before citing any number from it

**Backend mutants execute for real; Parent Web and Android mutants do not.**
`run-mutation.mjs` copies each package to a temp directory and applies one
declared string mutation. For `surface: "backend"` mutants
(`classifyBackendMutant`), it then compiles the mutated copy (`tsc`, exactly
what `npm run build` does) and, if it compiles, runs the ENTIRE real non-DB
backend test suite (`scripts/run-tests.mjs`, the same one `npm test` runs)
against it -- `KILLED` means an actual compile failure or an actual test
failure; `SURVIVED` means the real suite passed clean against mutated
production code. This is genuine mutation testing for backend, added
2026-09-08 as part of the engineering closure pass (see git history for the
prior static-only version of this file if you need it).

For `surface: "parent-web"` and `"android-static"` mutants, the harness still
only runs the `check-{parent-web,android}-boundaries.mjs` scripts -- literal
`requireText`/`forbidText` assertions over source text. A mutant there is
`KILLED` when one of those hardcoded string assertions notices that the
string it edits changed -- a tautology when the assertion was written for
that exact anchor. Do not cite parent-web/android `VALID_MUTATION_SURVIVORS`
as test-strength evidence; only the backend portion means anything. The
report JSON's `executesTests`/`classificationMethod` fields are now
per-surface (`{backend: true, "parent-web": false, android: false}`) so a
reader can't mistake one surface's method for another's.

`EQUIVALENT` and `INVALID` are still read from `mutation-scope.json`
(`expectedClassification`) -- BUT for backend mutants the real execution can
now contradict that manifest claim (a declared-`EQUIVALENT` mutant the real
suite actually kills, or a declared-`INVALID` mutant that actually compiles).
When that happens the mutant's classification reflects what was OBSERVED
(not the manifest's claim) and a `manifestAnomaly` string is attached to it
plus surfaced in the report's top-level `manifestAnomalies` array (which also
makes the run exit non-zero) -- the old static-only harness could never
detect this class of error, since it never ran anything capable of
contradicting the manifest.

**Environmental baseline, not exit-code-only.** A handful of backend non-DB
tests are genuine cross-package invariant checks that reach outside anything
this harness can put in a throwaway temp copy -- most concretely,
`test/tooling/RebuildR3DerivedLedgers.test.mjs` exercises a script that calls
`git rev-parse HEAD` unconditionally, which fails 100% of the time in a temp
directory that was never `git init`-ed (deliberately -- copying `.git` into a
scratch copy would be pointless). This was discovered by this harness's own
first real run, not a design assumption. Rather than special-case that one
script, the harness runs the real suite ONCE against the pristine (unmutated)
copy right after setup and records which test names already fail there (see
the report's `backendTestBaseline.preExistingFailures`); every per-mutant
classification then diffs its own failing-test set against that baseline --
only NEW failures count as a kill. Do not treat a non-zero exit code alone as
evidence of anything; read `manifestAnomalies` and the per-mutant `evidence`
field, which name the actual new failures when there are any.

**Known limitation, documented rather than engineered around:** a single
baseline run does not protect against a test that is independently flaky for
reasons unrelated to the environmental gaps above (e.g. genuine CPU-
contention-sensitive timing tests, a documented risk elsewhere in this
codebase). If a mutant is unexpectedly `KILLED`, reproduce it in isolation
(mutate, build, run `scripts/run-tests.mjs` alone, no other mutants in the
same process) before trusting the result -- exactly as this repo's own
"never trust a batch result without checking" convention already requires
elsewhere (see the project's own testing notes on batch-run phantom
failures). Do not add automatic retries here to paper over an anomaly;
diagnose it.

10 backend mutants are declared in `mutation-scope.json` today
(`B-FR137-*`, `B-NFR014-001`, `B-FR063-*`), covering
`src/relay/diagnostics.ts`, `src/http/buildServer.ts`,
`src/relay/RelayService.ts`, and `src/location/SafeZoneRepository.ts`.
Extending real execution to Parent Web (Vitest) and Android (JVM/Gradle,
much heavier per-mutant cost) is future scope, not started.
