import assert from 'node:assert/strict';
import test from 'node:test';

import { CONTENT } from '../src/content/index.mjs';
import { renderPages } from '../build.mjs';
import { auditArabicContent, auditArabicPages } from '../scripts/lib/arabic-latin.mjs';

test('Arabic public content has no unapproved Latin source text', () => {
  const audit = auditArabicContent(CONTENT.ar);
  assert.deepEqual(audit.unapproved, []);
  assert.deepEqual(audit.terminologyViolations, []);
  assert.deepEqual(
    audit.retained.map(({ key, token, classification }) => ({ key, token, classification })),
    [
      { key: 'footer.group.pca', token: 'PCA', classification: 'BRAND_REQUIRED' },
      { key: 'privacy.advanced.items[1].body', token: 'TLS', classification: 'TECHNICAL_IDENTIFIER_REQUIRED' },
    ]
  );
});

test('rendered Arabic pages have no unapproved Latin text', () => {
  const pages = renderPages('https://www.pcasafe.com');
  const audit = auditArabicPages(pages);
  assert.deepEqual(audit.unapproved, []);
  assert.deepEqual(audit.terminologyViolations, []);
  assert.equal(audit.retained.length, 1);
  assert.equal(pages.filter((page) => page.locale === 'ar').length, 9);
});
