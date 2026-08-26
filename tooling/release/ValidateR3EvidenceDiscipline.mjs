import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifestRoot = `${root}/.agent-runtime/manifests/pca-r3-final`;
const matrixPath = `${root}/docs/implementation/PCA_COMPLETION_V2_MATRIX.json`;
const sourcePath = `${manifestRoot}/R3_SOURCE_BACKLOG.csv`;
const progressPath = `${manifestRoot}/R3_PROGRESS_LEDGER.md`;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

const [matrixText, sourceText, progress] = await Promise.all([
  readFile(matrixPath, 'utf8'),
  readFile(sourcePath, 'utf8'),
  readFile(progressPath, 'utf8'),
]);
const matrix = JSON.parse(matrixText);
const sourceRows = parseCsv(sourceText);

const externalGateWithoutEvidence = matrix.requirements
  .filter((requirement) => requirement.status === 'SOURCE_COMPLETE_EXTERNAL_GATE')
  .filter((requirement) => !Array.isArray(requirement.externalGate) || requirement.externalGate.length === 0)
  .map((requirement) => requirement.requirementId);
const malformedBacklogRows = sourceRows
  .filter((row) => ['PARTIAL', 'NOT_STARTED'].includes(row.CURRENT_STATUS))
  .filter((row) => !row.SOURCE_SOLVABLE_CLASS || !row.NEXT_ACTION)
  .map((row) => row.REQUIREMENT_ID);
const unsupportedFinalClaims = progress
  .split(/\r?\n/)
  .filter((line) => /^[-*]\s+[^:]+:\s*(VALIDATED_COMPLETE|PRODUCTION_READY)\s*$/.test(line));

// --- Evidence-shape discipline (2026-08-26 correction) ---------------------
// A real regression class found this session: sourceEvidence/testEvidence/
// externalGate on some rows were plain strings instead of arrays. Every
// consumer (RebuildR3DerivedLedgers.mjs's joinEvidence()/splitGates()) is
// written for arrays and silently treats a string as empty/gate-less --
// meaning R3_REQUIREMENT_AUDIT.csv/R3_VALIDATION_BACKLOG.csv shipped with
// genuinely blank evidence columns for rows the matrix itself had real
// evidence for. This must fail closed so it cannot ship silently again.
const nonArrayEvidenceFields = [];
for (const requirement of matrix.requirements) {
  for (const field of ['sourceEvidence', 'testEvidence', 'externalGate']) {
    if (field in requirement && !Array.isArray(requirement[field])) {
      nonArrayEvidenceFields.push(`${requirement.requirementId}.${field}`);
    }
  }
}

// A second real regression class found this session: a handful of rows had
// sourceEvidence/testEvidence/externalGate mechanically split mid-sentence
// at comma boundaries across all three fields -- leaving whitespace-only or
// leading/trailing-whitespace fragments (" no interaction content
// transmitted)", " setOngoing(true)") sitting in evidence arrays as if they
// were independent citations.
const malformedEvidenceFragments = [];
for (const requirement of matrix.requirements) {
  for (const field of ['sourceEvidence', 'testEvidence']) {
    for (const item of Array.isArray(requirement[field]) ? requirement[field] : []) {
      if (typeof item !== 'string' || item.trim().length === 0 || /^\s/.test(item) || /\s$/.test(item)) {
        malformedEvidenceFragments.push(`${requirement.requirementId}.${field}=${JSON.stringify(item)}`);
      }
    }
  }
}

// A third real regression class found this session: externalGate entries
// that are not a bare canonical UPPER_SNAKE_CASE token (e.g. a gate name
// with a parenthetical decision citation glued on, a bare "YES"/"NO", or
// free-text prose) parse to zero gates under splitGates()'s intentionally
// strict regex -- so a row can carry real, human-readable gate text in the
// matrix while every derived artifact (R3_EXTERNAL_GATE_REGISTER.csv, the
// "External-gate rows" ledger count) reports it as gate-less. Every
// existing legitimate gate in this matrix is a bare token, optionally
// joined with other bare tokens by ';' or '|' -- anything else is malformed
// by construction, not a stricter-than-necessary rule.
const CANONICAL_GATE = /^[A-Z][A-Z0-9_]{2,}$/;
const NON_GATE_VALUES = new Set(['YES', 'NO']);
const nonCanonicalGateTokens = [];
for (const requirement of matrix.requirements) {
  for (const raw of Array.isArray(requirement.externalGate) ? requirement.externalGate : []) {
    const parts = String(raw).split(/[;|]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    for (const part of parts) {
      if (!CANONICAL_GATE.test(part) || NON_GATE_VALUES.has(part)) {
        nonCanonicalGateTokens.push(`${requirement.requirementId}.externalGate=${JSON.stringify(raw)}`);
        break;
      }
    }
  }
}

// Status buckets must sum to the total -- the same invariant
// RebuildR3DerivedLedgers.mjs enforces internally at generation time,
// checked here independently so a hand-edit outside that script cannot
// silently violate it between regenerations.
const ALL_STATUSES = ['SOURCE_COMPLETE', 'SOURCE_COMPLETE_VALIDATION_PENDING', 'SOURCE_COMPLETE_EXTERNAL_GATE', 'PARTIAL', 'NOT_STARTED', 'NOT_APPLICABLE'];
const statusCounts = Object.fromEntries(ALL_STATUSES.map((status) => [status, matrix.requirements.filter((r) => r.status === status).length]));
const totalRequirements = matrix.requirements.length;
const statusBucketSum = ALL_STATUSES.reduce((sum, status) => sum + statusCounts[status], 0);
const unknownStatusRows = matrix.requirements.filter((r) => !ALL_STATUSES.includes(r.status)).map((r) => `${r.requirementId}=${r.status}`);
const statusBucketMismatch = statusBucketSum !== totalRequirements || unknownStatusRows.length > 0
  ? { totalRequirements, statusBucketSum, statusCounts, unknownStatusRows }
  : null;

// A fourth real regression class found this session: docs/implementation/
// PCA_COMPLETION_V2_MATRIX.json's phases/ownerDecisions/futureProgrammeTracks
// sections are hand-maintained narrative snapshots, not derived from
// requirements[] -- so they can (and did, for the entire Addendum-002
// Platform Administration/Billing track) go stale and keep asserting "No
// source exists" / "static placeholder" / "no billing implementation
// exists" for a hundred-plus commits after requirements[] itself recorded
// that work as SOURCE_COMPLETE. Ban the specific phrases that were proven
// false, and additionally cross-check every "phases[]" entry against its
// own itemized requirements[] rows: a phase cannot honestly claim
// NOT_STARTED/"no source exists" while requirements[] already records real
// source for that same phaseId.
// IMPORTANT: only fields that carry the row's LIVE, current-state claim are
// scanned here (status/openItems/description/evidence). A `note` (phases)
// or `correctionNote`/`correctionEvidence` (ownerDecisions/
// futureProgrammeTracks) field is where this correction's own commentary
// quotes the disproven phrase to explain what changed and why -- e.g.
// "previously read ... \"No source exists\" ... corrected to ...". Scanning
// those fields too would make this guard permanently un-satisfiable (it
// would flag the very sentence that documents the fix). Keep correction
// narrative out of the live-claim fields and this stays a real, meaningful
// fail-closed check rather than one perpetually forced off or deleted.
const STALE_PHRASES = [
  /no billing implementation exists/i,
  /static placeholder/i,
  /zero matches for billing/i,
  /no source exists/i,
  /no work has begun/i,
];
const staleCurrentStateClaims = [];
for (const phase of matrix.phases ?? []) {
  const text = [phase.status, ...(phase.openItems ?? [])].filter(Boolean).join(' \n ');
  const matchedPhrase = STALE_PHRASES.find((phrase) => phrase.test(text));
  if (matchedPhrase) staleCurrentStateClaims.push(`phases[${phase.phaseId}] matches banned phrase ${matchedPhrase}`);
}
for (const decision of matrix.ownerDecisions ?? []) {
  const matchedPhrase = STALE_PHRASES.find((phrase) => phrase.test(decision.description ?? ''));
  if (matchedPhrase) staleCurrentStateClaims.push(`ownerDecisions[${decision.decisionId}] matches banned phrase ${matchedPhrase}`);
}
for (const track of matrix.futureProgrammeTracks ?? []) {
  const text = [track.description, ...(track.evidence ?? [])].filter(Boolean).join(' \n ');
  const matchedPhrase = STALE_PHRASES.find((phrase) => phrase.test(text));
  if (matchedPhrase) staleCurrentStateClaims.push(`futureProgrammeTracks[${track.trackId}] matches banned phrase ${matchedPhrase}`);
}

const result = {
  sourceCompleteExternalWithoutGate: externalGateWithoutEvidence,
  malformedBacklogRows,
  unsupportedFinalClaims,
  nonArrayEvidenceFields,
  malformedEvidenceFragments,
  nonCanonicalGateTokens,
  statusBucketMismatch,
  staleCurrentStateClaims,
  status: (
    externalGateWithoutEvidence.length
    || malformedBacklogRows.length
    || unsupportedFinalClaims.length
    || nonArrayEvidenceFields.length
    || malformedEvidenceFragments.length
    || nonCanonicalGateTokens.length
    || statusBucketMismatch
    || staleCurrentStateClaims.length
  ) ? 'FAIL' : 'PASS',
};
console.log(JSON.stringify(result, null, 2));
if (result.status === 'FAIL') process.exitCode = 1;
