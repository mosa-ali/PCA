/**
 * Minimal RFC 4180 CSV reader.
 *
 * Extracted because a naive `line.split(',')` was written three times in this
 * programme and got it wrong once with real consequences: the claim register's
 * evidence column contains commas inside quotes, so every column after it
 * shifted and the adversarial pass reported 19 CRITICAL claim mismatches on a
 * corpus where every claim actually agreed with the register. A checker that
 * fabricates nineteen criticals is worse than no checker, because a real
 * finding would be invisible among them.
 *
 * Handles quoted fields, escaped quotes (""), embedded newlines and CRLF, and
 * strips a UTF-8 BOM. It does not handle anything else, and does not need to.
 */

/** @returns {string[][]} rows of raw cells, blank lines dropped. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** Rows as objects keyed by the header row. */
export function parseCsvObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
