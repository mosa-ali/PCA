/**
 * PCA-PA-3B -- privacy scan (mission Section 22): proves absence of
 * childUrl/locationHistory/appUsage/youtubeHistory/screenTimeActivity/
 * familyPolicy/FDEK/DSK/DEK/recoverySecret anywhere in this lane's new
 * source (route handlers, DTO mapping, read models). This lane introduces
 * no new migration/schema, so there is no new table to scan -- this test
 * scans the actual TypeScript source this lane authored instead, which is
 * the complete surface where such a field could have been introduced
 * (SELECT column lists, DTO field lists, response shapes).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendSrc = path.resolve(__dirname, '../../../src');

const SCAN_DIRS = [
  path.join(backendSrc, 'http', 'routes', 'platformadmin'),
  path.join(backendSrc, 'platformadmin', 'readmodels'),
  path.join(backendSrc, 'platformadmin', 'api'),
];

const PROHIBITED_PATTERNS = [
  /childUrl/i,
  /locationHistory/i,
  /appUsage/i,
  /youtubeHistory/i,
  /screenTimeActivity/i,
  /familyPolicy/i,
  /\bFDEK\b/,
  /\bDSK\b/,
  /\bDEK\b/,
  /recoverySecret/i,
];

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

test('no PCA-PA-3B route/readmodel/DTO source file contains a prohibited family-data field name', () => {
  const files = SCAN_DIRS.flatMap(listFiles);
  assert.ok(files.length > 0, 'expected to find at least one PCA-PA-3B source file to scan');
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of PROHIBITED_PATTERNS) {
      assert.equal(pattern.test(content), false, `${file} matched prohibited pattern ${pattern}`);
    }
  }
});
