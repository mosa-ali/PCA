import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Static (no-DB, no-build) source-grep gate mirroring the spirit of
// test/schema-privacy.test.mjs's migration-text grep, pointed instead at
// every TypeScript source file under backend/src/platformadmin/. Asserts
// none of doc 09 Section 5.2's prohibited-data-class field-name terms
// appear anywhere in this domain's source -- a structural, independently
// checkable proof that no field capable of carrying family plaintext was
// introduced, on top of (not instead of) the migration's own equivalent
// gate over 0005's SQL text.
const prohibitedTerms = [
  'browsing',
  'location',
  'appUsage',
  'app_usage',
  'youtube',
  'screenTime',
  'screen_time',
  'wellbeing',
  'familyPolicy',
  'family_policy',
  'fdek',
  'dsk',
  'dek',
  'recoverySecret',
  'recovery_secret',
];

async function collectTsFiles(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dirUrl);
    if (entry.isDirectory()) files.push(...(await collectTsFiles(entryUrl)));
    else if (entry.name.endsWith('.ts')) files.push(entryUrl);
  }
  return files;
}

test('platformadmin/**/*.ts source contains no doc 09 Section 5.2 prohibited-data-class field name', async () => {
  const root = new URL('../../src/platformadmin/', import.meta.url);
  const files = await collectTsFiles(root);
  assert.ok(files.length > 0, 'sanity check: platformadmin source files must exist');
  for (const fileUrl of files) {
    const content = await readFile(fileUrl, 'utf8');
    // Strip comments so this test does not false-positive on the
    // documentation ABOUT the prohibition itself (this file's own list
    // above, and every module's doc comments that name the excluded data
    // classes by way of explaining why they can never appear as a field).
    const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const term of prohibitedTerms) {
      const lower = withoutComments.toLowerCase();
      assert.equal(lower.includes(term.toLowerCase()), false, `${fileURLToPath(fileUrl)} contains prohibited term "${term}" outside a comment`);
    }
  }
});
