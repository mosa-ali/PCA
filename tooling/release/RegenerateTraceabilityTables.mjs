#!/usr/bin/env node
// Regenerates the per-requirement status tables, status-distribution tables and completion
// counts in docs/implementation/PCA_IMPLEMENTATION_TRACEABILITY.md from the machine-checked
// docs/implementation/PCA_COMPLETION_V2_MATRIX.json.
//
// Why this exists (2026-09-08): the markdown carried the R0/R4 counts (e.g. Addendum 001
// "4 SOURCE_COMPLETE / 9 PARTIAL / 11 NOT_STARTED") for weeks after the JSON -- the source of
// truth every validator reads -- recorded 24 / 1 / 0. Doc 30 called the tables "historical
// until regenerated"; nothing regenerated them. Now they are derived, and `--check` fails the
// release-control CI job whenever the two drift apart again.
//
// What is regenerated (everything else in the file is left byte-for-byte as written):
//   * the Status column of every row in the four addendum matrix tables, and every hand-written
//     Summary whose row changed status gets a dated "re-derived" prefix so a reader sees that the
//     prose predates the status;
//   * rows for requirement ids missing from a table are appended; a table row whose id is not in
//     the JSON is an error (an orphan, never silently kept);
//   * the four "status distribution" tables;
//   * the four per-addendum lines and the Base A-100 sentence in "Completion calculation";
//   * the per-inventory status cells in the "Control and counting" table.
//
// Usage:  node tooling/release/RegenerateTraceabilityTables.mjs          (rewrite)
//         node tooling/release/RegenerateTraceabilityTables.mjs --check  (exit 1 on drift)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MATRIX = join(ROOT, 'docs', 'implementation', 'PCA_COMPLETION_V2_MATRIX.json');
const DOC = join(ROOT, 'docs', 'implementation', 'PCA_IMPLEMENTATION_TRACEABILITY.md');
const CHECK = process.argv.includes('--check');
const STAMP = '2026-09-08';

const matrix = JSON.parse(readFileSync(MATRIX, 'utf8'));
const byId = new Map(matrix.requirements.map((r) => [r.requirementId, r]));

const ADDENDA = [
  { n: '001', prefix: 'PCA-ADD-ENR-', heading: '## Addendum 001 implementation matrix', dist: '### Addendum 001 status distribution', phaseColumn: true },
  { n: '002', prefix: /^PCA-ADD-(PA|BILL)-/, heading: '## Addendum 002 implementation matrix', dist: '### Addendum 002 status distribution', phaseColumn: true },
  { n: '003', prefix: 'PCA-ADD-IDENT-', heading: '## Addendum 003 implementation matrix', dist: '### Addendum 003 status distribution', phaseColumn: false },
  { n: '004', prefix: 'PCA-ADD-COMP-', heading: '## Addendum 004 implementation matrix', dist: '### Addendum 004 status distribution', phaseColumn: false },
];
const STATUS_ORDER = ['SOURCE_COMPLETE', 'SOURCE_COMPLETE_EXTERNAL_GATE', 'SOURCE_COMPLETE_VALIDATION_PENDING', 'PARTIAL', 'NOT_STARTED', 'NOT_APPLICABLE'];

const idsFor = (a) => matrix.requirements.filter((r) => (typeof a.prefix === 'string' ? r.requirementId.startsWith(a.prefix) : a.prefix.test(r.requirementId))).map((r) => r.requirementId).sort(naturalCompare);
function naturalCompare(x, y) { return x.localeCompare(y, 'en', { numeric: true }); }
const cell = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
function summaryFromNotes(notes) {
  const flat = String(notes ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'No note recorded in the matrix.';
  const first = flat.split(/(?<=[.!?])\s+(?=[A-Z`(])/)[0];
  return first.length > 220 ? `${first.slice(0, 217)}...` : first;
}
function counts(ids) {
  const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, []]));
  for (const id of ids) { const st = byId.get(id).status; if (!c[st]) throw new Error(`unknown status ${st} on ${id}`); c[st].push(id); }
  return c;
}
const sourceCompleteTotal = (c) => c.SOURCE_COMPLETE.length + c.SOURCE_COMPLETE_EXTERNAL_GATE.length + c.SOURCE_COMPLETE_VALIDATION_PENDING.length;

let doc = readFileSync(DOC, 'utf8');
const CRLF = doc.includes('\r\n');
doc = doc.replace(/\r\n/g, '\n');
const lines = doc.split('\n');

function findLine(pred, from = 0, label = 'anchor') { const i = lines.findIndex((l, k) => k >= from && pred(l)); if (i < 0) throw new Error(`${label} not found`); return i; }
function tableAfter(headingIndex) {
  const header = findLine((l) => l.startsWith('| Requirement |'), headingIndex, 'table header');
  if (!/^\|[-| :]+\|$/.test(lines[header + 1])) throw new Error(`no separator after table header at line ${header + 1}`);
  let end = header + 2; while (end < lines.length && lines[end].startsWith('|')) end += 1;
  return { header, first: header + 2, end };
}
const splitRow = (row) => row.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim());

for (const a of ADDENDA) {
  const ids = idsFor(a);
  const idSet = new Set(ids);
  const headingIndex = findLine((l) => l.startsWith(a.heading), 0, a.heading);
  const t = tableAfter(headingIndex);
  const cols = splitRow(lines[t.header]).length;
  const statusCol = cols - 2; // Requirement | [phase] | Status | Summary
  const seen = new Set();
  for (let i = t.first; i < t.end; i += 1) {
    const cells = splitRow(lines[i]);
    const id = cells[0].replace(/`/g, '').trim();
    if (!idSet.has(id)) throw new Error(`Addendum ${a.n} table row ${id} is not in the JSON matrix (orphan)`);
    seen.add(id);
    const r = byId.get(id);
    const oldStatus = cells[statusCol];
    if (oldStatus !== r.status) {
      cells[statusCol] = r.status;
      const summary = cells[cols - 1];
      if (!summary.startsWith('Status re-derived')) {
        cells[cols - 1] = `Status re-derived from the JSON matrix on ${STAMP} (was ${oldStatus}): ${summaryFromNotes(r.notes)} Earlier summary: ${summary}`;
      }
    }
    if (a.phaseColumn) cells[1] = cell((r.phase ?? []).join(', '));
    lines[i] = `| ${cells.join(' | ')} |`;
  }
  const missing = ids.filter((id) => !seen.has(id));
  const newRows = missing.map((id) => {
    const r = byId.get(id);
    const parts = [id];
    if (a.phaseColumn) parts.push(cell((r.phase ?? []).join(', ')));
    parts.push(r.status, cell(summaryFromNotes(r.notes)));
    return `| ${parts.join(' | ')} |`;
  });
  lines.splice(t.end, 0, ...newRows);

  // Distribution table: fully regenerated, same heading line kept.
  const distIndex = findLine((l) => l.startsWith(a.dist), headingIndex, a.dist);
  const distHeader = findLine((l) => l.startsWith('| Status |'), distIndex, 'distribution header');
  let distEnd = distHeader + 2; while (distEnd < lines.length && lines[distEnd].startsWith('|')) distEnd += 1;
  const c = counts(ids);
  const withIds = a.n === '001';
  const rows = [withIds ? '| Status | Count | IDs |' : '| Status | Count |', withIds ? '|---|---:|---|' : '|---|---:|'];
  for (const s of STATUS_ORDER) {
    if (c[s].length === 0 && s !== 'SOURCE_COMPLETE' && s !== 'PARTIAL' && s !== 'NOT_STARTED') continue;
    rows.push(withIds ? `| ${s} | ${c[s].length} | ${c[s].map((id) => id.replace(a.prefix, '')).join(', ') || '—'} |` : `| ${s} | ${c[s].length} |`);
  }
  rows.push(withIds ? `| **Total** | ${ids.length} | regenerated from PCA_COMPLETION_V2_MATRIX.json on ${STAMP} |` : `| **Total** | ${ids.length} |`);
  lines.splice(distHeader, distEnd - distHeader, ...rows);
  lines[distIndex] = `${a.dist} (regenerated from the JSON matrix, ${STAMP})`;
}

// Completion calculation: the four per-addendum lines.
for (const a of ADDENDA) {
  const idx = lines.findIndex((l) => new RegExp(`^Addendum ${a.n} \\(`).test(l) && /`SOURCE_COMPLETE = /.test(l));
  if (idx < 0) throw new Error(`completion line for Addendum ${a.n} not found`);
  const c = counts(idsFor(a));
  lines[idx] = `Addendum ${a.n} (regenerated from the JSON matrix on ${STAMP}): \`SOURCE_COMPLETE = ${sourceCompleteTotal(c)}\` (${c.SOURCE_COMPLETE.length} plain + ${c.SOURCE_COMPLETE_EXTERNAL_GATE.length} external-gate + ${c.SOURCE_COMPLETE_VALIDATION_PENDING.length} validation-pending), \`PARTIAL = ${c.PARTIAL.length}\`, \`NOT_STARTED = ${c.NOT_STARTED.length}\`, \`NOT_APPLICABLE = ${c.NOT_APPLICABLE.length}\` of ${idsFor(a).length}.`;
}
// Base A-100 sentence.
{
  const baseIds = matrix.requirements.filter((r) => !/^PCA-ADD-/.test(r.requirementId)).map((r) => r.requirementId);
  const c = counts(baseIds);
  const completion = findLine((l) => l.startsWith('## Completion calculation'), 0, 'Completion calculation heading');
  const idx = lines.findIndex((l, k) => k > completion && l.startsWith('Base A-100'));
  if (idx < 0) throw new Error('Base A-100 completion sentence not found');
  lines[idx] = `Base A-100 (${baseIds.length} rows incl. the four owner-approved lettered additions; regenerated from the JSON matrix on ${STAMP}): \`SOURCE_COMPLETE = ${sourceCompleteTotal(c)}\` (${c.SOURCE_COMPLETE.length} plain + ${c.SOURCE_COMPLETE_EXTERNAL_GATE.length} external-gate + ${c.SOURCE_COMPLETE_VALIDATION_PENDING.length} validation-pending), \`PARTIAL = ${c.PARTIAL.length}\`, \`NOT_STARTED = ${c.NOT_STARTED.length}\`, \`NOT_APPLICABLE = ${c.NOT_APPLICABLE.length}\`. Every remaining PARTIAL/NOT_STARTED row carries an external gate (crypto review, owner decision, YouTube policy, cloud-AI decision, App Link hosting); none is repository-solvable today.`;
}
// Control and counting table cells.
{
  const rowsSpec = [
    { label: '| Base A-100 |', ids: matrix.requirements.filter((r) => !/^PCA-ADD-/.test(r.requirementId)).map((r) => r.requirementId), prefix: 'Immutable accepted baseline; verified unique normative IDs, 0 duplicates, 0 missing, 0 orphans.' },
    ...ADDENDA.map((a) => ({ label: `| Addendum ${a.n} |`, ids: idsFor(a), prefix: 'Owner approved' })),
  ];
  for (const spec of rowsSpec) {
    const idx = lines.findIndex((l) => l.startsWith(spec.label));
    if (idx < 0) throw new Error(`control table row ${spec.label} not found`);
    const cells = splitRow(lines[idx]);
    const c = counts(spec.ids);
    cells[cells.length - 1] = `${spec.prefix}; status regenerated from the JSON matrix on ${STAMP}: ${sourceCompleteTotal(c)} \`SOURCE_COMPLETE\` (${c.SOURCE_COMPLETE.length} plain + ${c.SOURCE_COMPLETE_EXTERNAL_GATE.length} external-gate + ${c.SOURCE_COMPLETE_VALIDATION_PENDING.length} validation-pending), ${c.PARTIAL.length} \`PARTIAL\`, ${c.NOT_STARTED.length} \`NOT_STARTED\`, ${c.NOT_APPLICABLE.length} \`NOT_APPLICABLE\` of ${spec.ids.length}.`;
    lines[idx] = `| ${cells.join(' | ')} |`;
  }
}
// Correction R6 note, inserted once after the R5 correction heading's paragraph block.
if (!lines.some((l) => l.startsWith('### Correction R6'))) {
  const r5 = findLine((l) => l.startsWith('### Correction R5'), 0, 'R5 heading');
  const next = findLine((l) => l.startsWith('## ') , r5, 'section after R5');
  lines.splice(next, 0,
    `### Correction R6 (${STAMP}, mechanical regeneration)`,
    '',
    'Every per-requirement Status cell, every status-distribution table, the per-inventory status cells in "Control and counting" and the per-inventory lines in "Completion calculation" in this document are now **regenerated from `PCA_COMPLETION_V2_MATRIX.json`** by `tooling/release/RegenerateTraceabilityTables.mjs`, and `--check` in the release-control CI job fails whenever they drift from it. Before this correction the markdown still carried the R0/R4 counts (Addendum 001 "4 / 9 / 11 / 1", Addendum 002 "85 / 12 / 1") weeks after the JSON -- the source every validator reads -- recorded 24 / 1 / 0 and 98 / 0 / 0; doc 30 had flagged the tables as "historical until regenerated" and nothing regenerated them. Hand-written Summary prose is preserved; where a row\'s status changed, the Summary is prefixed with a dated "re-derived" note and the earlier wording is kept after it, so the reader sees that the prose predates the status. Nothing here is a `VALIDATED_COMPLETE` or `PRODUCTION_READY` claim.',
    '',
  );
}

let out = lines.join('\n');
if (CRLF) out = out.replace(/\n/g, '\r\n');
const current = readFileSync(DOC, 'utf8');
if (CHECK) {
  if (out !== current) {
    console.error('PCA_IMPLEMENTATION_TRACEABILITY.md is stale relative to PCA_COMPLETION_V2_MATRIX.json -- run `node tooling/release/RegenerateTraceabilityTables.mjs` and commit.');
    process.exit(1);
  }
  console.log('PCA_IMPLEMENTATION_TRACEABILITY.md: OK (matches PCA_COMPLETION_V2_MATRIX.json)');
} else {
  writeFileSync(DOC, out, 'utf8');
  console.log(`PCA_IMPLEMENTATION_TRACEABILITY.md regenerated (${out === current ? 'no change' : 'updated'})`);
}
