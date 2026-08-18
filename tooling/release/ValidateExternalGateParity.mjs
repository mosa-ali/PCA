import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const registerPath = `${root}/.agent-runtime/manifests/pca-r3-final/R3_EXTERNAL_GATE_REGISTER.csv`;
const matrixPath = `${root}/docs/release_readiness/external_gate_matrix.json`;

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

const [registerText, matrixText] = await Promise.all([readFile(registerPath, 'utf8'), readFile(matrixPath, 'utf8')]);
const registerRows = parseCsv(registerText);
const registerIds = [...new Set(registerRows.map((row) => row.GATE_ID).filter(Boolean))];
const duplicateRegisterIds = registerRows.map((row) => row.GATE_ID).filter((id, index, ids) => id && ids.indexOf(id) !== index);
const matrix = JSON.parse(matrixText);
const matrixGates = Array.isArray(matrix.gates) ? matrix.gates : [];
const matrixById = new Map(matrixGates.map((gate) => [gate.id, gate]));
const missing = registerIds.filter((id) => !matrixById.has(id));
const unregisteredMatrixIds = matrixGates.map((gate) => gate.id).filter((id) => id && !registerIds.includes(id));
const closedWithoutEvidence = matrixGates.filter((gate) => gate.status === 'CLOSED' && (typeof gate.evidence !== 'string' || gate.evidence.trim().length === 0 || typeof gate.owner !== 'string' || gate.owner.trim().length === 0));
const invalid = matrixGates.filter((gate) => !gate.id || !['BLOCKED', 'EXTERNAL', 'CLOSED'].includes(gate.status) || typeof gate.description !== 'string' || typeof gate.owner !== 'string' || !Object.prototype.hasOwnProperty.call(gate, 'evidence'));
const duplicateMatrixIds = matrixGates.map((gate) => gate.id).filter((id, index, ids) => ids.indexOf(id) !== index);

const result = {
  registerRows: registerRows.length,
  registerUniqueGateIds: registerIds.length,
  matrixGateRows: matrixGates.length,
  missingGateIds: missing,
  unregisteredMatrixIds: [...new Set(unregisteredMatrixIds)],
  invalidMatrixRows: invalid.map((gate) => gate.id ?? null),
  closedWithoutEvidence: closedWithoutEvidence.map((gate) => gate.id ?? null),
  duplicateMatrixIds: [...new Set(duplicateMatrixIds)],
  duplicateRegisterIds: [...new Set(duplicateRegisterIds)],
};
console.log(JSON.stringify(result));
// The register is requirement-scoped, so one gate may intentionally appear
// on several rows. Matrix IDs, missing mappings, invalid statuses, and
// evidence-less CLOSED gates remain fatal parity errors.
if (missing.length || unregisteredMatrixIds.length || invalid.length || closedWithoutEvidence.length || duplicateMatrixIds.length) process.exitCode = 1;
