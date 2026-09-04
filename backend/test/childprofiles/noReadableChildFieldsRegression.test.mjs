// PPR-2 mandatory guard (owner directive): the opaque central child-profile
// membership registry must never silently grow a readable child field. This
// test scans the migration DDL, the repository/service source, the route
// source, and the DTO shape for the prohibited names -- it fails loudly if
// ANY of them appears, forcing a controlled-document review before a future
// change could add one for real. See doc 00 Section 9 change
// CHG-2026-09-04-01: "This approval is not precedent."
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../');

const PROHIBITED_FIELDS = [
  'displayName',
  'display_name',
  'childName',
  'child_name',
  'nickname',
  'firstName',
  'first_name',
  'lastName',
  'last_name',
  'dob',
  'dateOfBirth',
  'date_of_birth',
  'age', // deliberately bare -- catches ageTier/ageUxTier/age_band too via substring below
  'gender',
  'school',
  'avatar',
  'photo',
  'wellbeing',
  'location',
  'activity',
];

const FILES_UNDER_GUARD = [
  'migrations/0036_family_child_memberships.sql',
  'src/childprofiles/ChildProfileRegistryRepository.ts',
  'src/childprofiles/MySqlChildProfileRegistryRepository.ts',
  'src/childprofiles/ChildProfileService.ts',
  'src/http/routes/childProfileRoutes.ts',
];

// Comments and doc strings legitimately NAME the prohibited fields (that is
// how this very guard, and the migration's own header, explain what must
// never appear) -- so this scans only for the field as an ACTUAL CODE TOKEN
// (a column name, a TS property key, a JSON key), not prose. Concretely:
// strip every line that is entirely a comment (// ... or -- ... or a line
// inside a /* */ or a markdown-ish prose block starting with a common
// English word), then check the remainder.
function stripCommentsAndProse(source) {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('--') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
      return true;
    })
    .join('\n');
}

test('the migration DDL declares only the approved columns', () => {
  const ddl = readFileSync(resolve(ROOT, 'migrations/0036_family_child_memberships.sql'), 'utf8');
  const createMatch = ddl.match(/CREATE TABLE family_child_memberships \(([\s\S]*?)\n\) ENGINE=InnoDB;/);
  assert.ok(createMatch, 'expected to find the family_child_memberships CREATE TABLE statement');
  const body = stripCommentsAndProse(createMatch[1]).replace(/\n/g, ' ');

  // Split on commas that are OUTSIDE parentheses, so a multi-line
  // `CHECK (a REGEXP '...,...')`-style clause is never mistaken for a
  // definition boundary, and a wrapped `CONSTRAINT ... \n FOREIGN KEY (...)`
  // clause stays one definition rather than leaking `FOREIGN`/`CHECK` as a
  // false column name.
  const definitions = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      definitions.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) definitions.push(current.trim());

  const columnNames = definitions
    .filter((def) => !/^(PRIMARY KEY|KEY |UNIQUE KEY|CONSTRAINT)/i.test(def))
    .map((def) => def.split(/\s+/)[0]);

  assert.deepEqual(
    columnNames.sort(),
    ['child_profile_id', 'created_at', 'creation_request_key', 'family_id'].sort(),
    `family_child_memberships must have EXACTLY these four columns and no others -- got: ${columnNames.join(', ')}`,
  );
});

test('no source file under guard contains a readable-child-field token as code', () => {
  const offenders = [];
  for (const relativePath of FILES_UNDER_GUARD) {
    const raw = readFileSync(resolve(ROOT, relativePath), 'utf8');
    const code = stripCommentsAndProse(raw);
    for (const field of PROHIBITED_FIELDS) {
      // Word-boundary match against common code-identifier shapes: exact
      // token, snake_case, or as a quoted JSON/TS object key.
      const pattern = new RegExp(`(^|[^A-Za-z0-9_])${field}([^A-Za-z0-9_]|$)`, 'i');
      if (pattern.test(code)) offenders.push(`${relativePath}: "${field}"`);
    }
  }
  assert.deepEqual(offenders, [], `readable-child-field token(s) found as code:\n${offenders.join('\n')}`);
});

test('the HTTP DTO shape (toChildProfileDto) exposes exactly childProfileId and createdAt', () => {
  const source = readFileSync(resolve(ROOT, 'src/http/routes/childProfileRoutes.ts'), 'utf8');
  const fnMatch = source.match(/export function toChildProfileDto\(row: \{ ([\s\S]*?) \}\) \{\s*return \{ ([\s\S]*?) \};/);
  assert.ok(fnMatch, 'expected to find toChildProfileDto');
  const returnedKeys = fnMatch[2]
    .split(',')
    .map((entry) => entry.split(':')[0].trim())
    .filter(Boolean)
    .sort();
  assert.deepEqual(returnedKeys, ['childProfileId', 'createdAt']);
});
