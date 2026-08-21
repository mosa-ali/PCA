// Deterministic regression coverage for
// tooling/release/RebuildR3DerivedLedgers.mjs's fail-closed guards
// (PCA-FINAL-CLOSURE Prompt 1, section 4). Runs the REAL script as a child
// process against a disposable temp fixture directory (via PCA_R3_TEST_ROOT
// -- see the script's own header comment), never against the controlled
// repository's real matrix/manifest files.
//
// The fixture rows below are keyed to specific IDs the script's real
// SOURCE_UPDATES table currently declares (PCA-NFR-021 = SOURCE_COMPLETE,
// PCA-FR-008 = PARTIAL, PCA-ADD-PA-020 = SOURCE_COMPLETE with an
// externalGate). If that table's entries for these three IDs are ever
// removed or their declared status/evidence/externalGate change, update
// EXPECTED_* below to match -- the point of this suite is to prove the
// guard mechanism itself still works, not to freeze SOURCE_UPDATES's
// content.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../../../tooling/release/RebuildR3DerivedLedgers.mjs', import.meta.url));

const EXPECTED = {
  'PCA-NFR-021': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'parent-web/src/domain/types.ts',
      'parent-web/src/pages/Dashboard.tsx',
      'parent-web/src/components/common/DeviceOfflineNotice.tsx',
    ],
  },
  'PCA-FR-008': { status: 'PARTIAL' },
  'PCA-ADD-PA-020': { status: 'SOURCE_COMPLETE', externalGate: ['PLATFORM_ADMIN_ALERT_DELIVERY'] },
};

const CSV_HEADERS = {
  audit: '"REQUIREMENT_ID","NORMATIVE_TEXT","NORMATIVE_SOURCE","CURRENT_STATUS","SOURCE_EVIDENCE","TEST_EVIDENCE","RUNTIME_REACHABILITY","EXTERNAL_GATE","SOURCE_SOLVABLE","SOURCE_GAP","VALIDATION_GAP","PRIMARY_DOMAIN","DEPENDENCIES","WRITER"\n',
  source: '"REQUIREMENT_ID","PHASE","CURRENT_STATUS","SOURCE_SOLVABLE_CLASS","EXTERNAL_GATE","SOURCE_EVIDENCE","TEST_EVIDENCE","CURRENT_GAP","NEXT_ACTION","WRITER"\n',
  validation: '"REQUIREMENT_ID","PHASE","CURRENT_STATUS","TEST_EVIDENCE","VALIDATION_STATE","REQUIRED_VALIDATION","EXTERNAL_GATE","OWNER"\n',
  external: '"GATE_ID","REQUIREMENT_ID","STATUS","EVIDENCE_REQUIRED","OWNER","BLOCKING_SCOPE"\n',
};

function baseRequirement(id, overrides = {}) {
  return {
    requirementId: id,
    phase: ['PCA-1'],
    status: 'NOT_APPLICABLE',
    sourceEvidence: [],
    testEvidence: [],
    externalGate: [],
    notes: 'fixture row',
    ...overrides,
  };
}

async function makeFixture(requirements) {
  const root = await mkdtemp(join(tmpdir(), 'pca-r3-ledger-test-'));
  await mkdir(join(root, 'docs', 'implementation'), { recursive: true });
  const manifestDir = join(root, '.agent-runtime', 'manifests', 'pca-r3-final');
  await mkdir(manifestDir, { recursive: true });
  await writeFile(join(root, 'docs', 'implementation', 'PCA_COMPLETION_V2_MATRIX.json'), JSON.stringify({ requirements }, null, 2), 'utf8');
  for (const [name, header] of Object.entries(CSV_HEADERS)) {
    const fileName = { audit: 'R3_REQUIREMENT_AUDIT.csv', source: 'R3_SOURCE_BACKLOG.csv', validation: 'R3_VALIDATION_BACKLOG.csv', external: 'R3_EXTERNAL_GATE_REGISTER.csv' }[name];
    await writeFile(join(manifestDir, fileName), header, 'utf8');
  }
  await writeFile(
    join(manifestDir, 'R3_PROGRESS_LEDGER.md'),
    [
      '# Fixture Progress Ledger',
      '',
      'Generated from the completion matrix and repository evidence on 2020-01-01.',
      '',
      '| Metric | Count |',
      '|---|---:|',
      '| Total matrix requirements | 0 |',
      '| SOURCE_COMPLETE | 0 |',
      '| PARTIAL | 0 |',
      '| NOT_STARTED | 0 |',
      '| NOT_APPLICABLE | 0 |',
      '| UNMAPPED_PHASE_CROSSWALK_PENDING | 0 |',
      '| Partial plus not-started | 0 |',
      '| External-gate rows | 0 |',
      '| Terminology audit rows | 0 |',
      '',
      '- Android assembleDebug: PASS.',
      '- Android full test: PASS.',
      '- Parent Web typecheck: PASS.',
      '- Backend build: PASS.',
      '- iOS/macOS/Xcode and physical-device validation: EXTERNAL_GATE on Windows.',
      '',
      '## Open work',
      '',
      '### Current-head database validation',
      '',
      '- PRE_WAVE11_DB_BASELINE = PASS',
      '- CURRENT_HEAD_0000_DB_VALIDATION = NOT_EXECUTED',
      '- MIGRATION_0000_APPLIED = NOT_EXECUTED',
      '- MIGRATION_0000_SCHEMA_VERIFIED = NOT_EXECUTED',
      '- MYSQL_STANDARD = NOT_EXECUTED',
      '- MYSQL_PRIVILEGE = NOT_EXECUTED',
      '- DB_CRITICAL_SKIPPED = NOT_EXECUTED',
      '- Scope: fixture placeholder.',
      '### Wave placeholder',
      '',
      '### Current-head mutation validation',
      '',
    ].join('\n'),
    'utf8',
  );
  return root;
}

async function runGenerator(root) {
  // The real script hardcodes an expectation of exactly 375 rows (the
  // controlled repository's real requirement count) unless overridden --
  // derive the override from however many rows THIS fixture actually has,
  // so every test below can just call runGenerator(root) uniformly.
  const { requirements } = await readMatrix(root);
  return execFileAsync(process.execPath, [scriptPath], {
    env: { ...process.env, PCA_R3_TEST_ROOT: root, PCA_R3_TEST_EXPECTED_TOTAL: String(requirements.length) },
  });
}

async function runGeneratorExpectingFailure(root) {
  try {
    await runGenerator(root);
    throw new Error('expected the generator to exit non-zero, but it succeeded');
  } catch (error) {
    if (error.code === undefined) throw error; // not a process-exit failure -- rethrow
    return error; // has .stdout/.stderr/.code
  }
}

async function readMatrix(root) {
  const raw = await readFile(join(root, 'docs', 'implementation', 'PCA_COMPLETION_V2_MATRIX.json'), 'utf8');
  return JSON.parse(raw);
}

test('a fixture whose evidence/status already matches SOURCE_UPDATES exactly runs clean (baseline sanity)', async () => {
  const root = await makeFixture([
    baseRequirement('PCA-NFR-021', { status: EXPECTED['PCA-NFR-021'].status, sourceEvidence: EXPECTED['PCA-NFR-021'].sourceEvidence, notes: 'no R3 marker here' }),
    baseRequirement('PCA-FR-008', { status: EXPECTED['PCA-FR-008'].status }),
  ]);
  try {
    await runGenerator(root);
    const matrix = await readMatrix(root);
    const row = matrix.requirements.find((r) => r.requirementId === 'PCA-NFR-021');
    assert.equal(row.status, 'SOURCE_COMPLETE');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('A: a newer SOURCE_COMPLETE row cannot be downgraded by a stale (lower-rank) SOURCE_UPDATES entry', async () => {
  // PCA-FR-008 is PARTIAL in the real SOURCE_UPDATES table; presenting it
  // here as already SOURCE_COMPLETE must be refused, not silently reverted.
  const root = await makeFixture([baseRequirement('PCA-FR-008', { status: 'SOURCE_COMPLETE', notes: 'no R3 marker' })]);
  try {
    const failure = await runGeneratorExpectingFailure(root);
    assert.match(failure.stderr, /PCA-FR-008/);
    assert.match(failure.stderr, /downgrade|regress/i);
    const matrix = await readMatrix(root);
    assert.equal(matrix.requirements.find((r) => r.requirementId === 'PCA-FR-008').status, 'SOURCE_COMPLETE', 'the fixture file itself must be untouched on refusal');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('B/C: newer sourceEvidence/testEvidence cannot be replaced by SOURCE_UPDATES\'s narrower list', async () => {
  const root = await makeFixture([
    baseRequirement('PCA-NFR-021', {
      status: 'SOURCE_COMPLETE',
      sourceEvidence: [...EXPECTED['PCA-NFR-021'].sourceEvidence, 'parent-web/src/pages/family/NewerFileNotYetInSourceUpdates.tsx'],
      notes: 'no R3 marker here',
    }),
  ]);
  try {
    const failure = await runGeneratorExpectingFailure(root);
    assert.match(failure.stderr, /PCA-NFR-021/);
    assert.match(failure.stderr, /drop already-recorded evidence/i);
    const matrix = await readMatrix(root);
    assert.ok(
      matrix.requirements.find((r) => r.requirementId === 'PCA-NFR-021').sourceEvidence.includes('parent-web/src/pages/family/NewerFileNotYetInSourceUpdates.tsx'),
      'the newer evidence entry must survive the refused run',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('D: a dated "R3 update"/"R3 re-derivation" note cannot be overwritten by an unmarked, older note', async () => {
  const root = await makeFixture([
    baseRequirement('PCA-NFR-021', {
      status: EXPECTED['PCA-NFR-021'].status,
      sourceEvidence: EXPECTED['PCA-NFR-021'].sourceEvidence,
      notes: 'R3 update (2099-01-01, base deadbeef): this is a newer finding SOURCE_UPDATES does not know about.',
    }),
  ]);
  try {
    const failure = await runGeneratorExpectingFailure(root);
    assert.match(failure.stderr, /PCA-NFR-021/);
    assert.match(failure.stderr, /notes.*overwrite|dated R3/i);
    const matrix = await readMatrix(root);
    assert.match(matrix.requirements.find((r) => r.requirementId === 'PCA-NFR-021').notes, /R3 update \(2099-01-01/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('E/F: externalGate cannot be silently dropped/narrowed, and SOURCE_COMPLETE_EXTERNAL_GATE-style rows keep their gate', async () => {
  const root = await makeFixture([
    baseRequirement('PCA-ADD-PA-020', {
      status: EXPECTED['PCA-ADD-PA-020'].status,
      externalGate: [...EXPECTED['PCA-ADD-PA-020'].externalGate, 'A_NEWER_GATE_SOURCE_UPDATES_DOES_NOT_KNOW_ABOUT'],
      notes: 'no R3 marker here',
    }),
  ]);
  try {
    const failure = await runGeneratorExpectingFailure(root);
    assert.match(failure.stderr, /PCA-ADD-PA-020/);
    assert.match(failure.stderr, /externalGate/);
    const matrix = await readMatrix(root);
    assert.ok(
      matrix.requirements.find((r) => r.requirementId === 'PCA-ADD-PA-020').externalGate.includes('A_NEWER_GATE_SOURCE_UPDATES_DOES_NOT_KNOW_ABOUT'),
      'the newer gate entry must survive the refused run',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('G: a requirement row with no SOURCE_UPDATES entry is never touched', async () => {
  const untouched = baseRequirement('PCA-ZZZ-DOES-NOT-EXIST-IN-SOURCE-UPDATES', {
    status: 'PARTIAL',
    sourceEvidence: ['some/file.ts'],
    notes: 'completely unrelated row',
  });
  const root = await makeFixture([untouched, baseRequirement('PCA-NFR-021', { status: EXPECTED['PCA-NFR-021'].status, sourceEvidence: EXPECTED['PCA-NFR-021'].sourceEvidence, notes: 'no R3 marker' })]);
  try {
    await runGenerator(root);
    const matrix = await readMatrix(root);
    const row = matrix.requirements.find((r) => r.requirementId === 'PCA-ZZZ-DOES-NOT-EXIST-IN-SOURCE-UPDATES');
    assert.deepEqual(row, untouched);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('H: matrix status counters remain denominator-consistent with the total row count', async () => {
  const rows = [
    baseRequirement('PCA-NFR-021', { status: EXPECTED['PCA-NFR-021'].status, sourceEvidence: EXPECTED['PCA-NFR-021'].sourceEvidence, notes: 'no R3 marker' }),
    baseRequirement('PCA-FR-008', { status: EXPECTED['PCA-FR-008'].status }),
    baseRequirement('PCA-ZZZ-EXTRA-1', { status: 'PARTIAL' }),
    baseRequirement('PCA-ZZZ-EXTRA-2', { status: 'NOT_APPLICABLE' }),
    baseRequirement('PCA-ZZZ-EXTRA-3', { status: 'NOT_STARTED' }),
  ];
  const root = await makeFixture(rows);
  try {
    const { stdout } = await runGenerator(root);
    const summary = JSON.parse(stdout.trim().split('\n').pop());
    assert.equal(summary.total, rows.length);
    const sum = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    assert.equal(sum, summary.total, 'every status bucket must sum back to the total row count');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('I/J: re-running against an already-converged fixture is deterministic (no-op, identical output)', async () => {
  const root = await makeFixture([
    baseRequirement('PCA-NFR-021', { status: EXPECTED['PCA-NFR-021'].status, sourceEvidence: EXPECTED['PCA-NFR-021'].sourceEvidence, notes: 'no R3 marker' }),
    baseRequirement('PCA-FR-008', { status: EXPECTED['PCA-FR-008'].status }),
  ]);
  try {
    await runGenerator(root);
    const firstRun = await readFile(join(root, 'docs', 'implementation', 'PCA_COMPLETION_V2_MATRIX.json'), 'utf8');
    await runGenerator(root);
    const secondRun = await readFile(join(root, 'docs', 'implementation', 'PCA_COMPLETION_V2_MATRIX.json'), 'utf8');
    assert.equal(secondRun, firstRun, 'a second run against the same converged fixture must produce byte-identical output');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
