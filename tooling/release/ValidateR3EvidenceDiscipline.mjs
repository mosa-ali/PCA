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
const result = {
  sourceCompleteExternalWithoutGate: externalGateWithoutEvidence,
  malformedBacklogRows,
  unsupportedFinalClaims,
  status: externalGateWithoutEvidence.length || malformedBacklogRows.length || unsupportedFinalClaims.length ? 'FAIL' : 'PASS',
};
console.log(JSON.stringify(result));
if (result.status === 'FAIL') process.exitCode = 1;
