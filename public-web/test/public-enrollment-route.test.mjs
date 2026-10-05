import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CONTENT } from '../src/content/index.mjs';
import { REQUIRED_RESPONSE_HEADERS } from '../src/lib/seo.mjs';
import { renderEnrollmentFallbackPage } from '../src/pages/enrollmentFallback.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const nginx = await readFile(join(ROOT, 'deploy/nginx.conf'), 'utf8');

test('enrollment fallback is bilingual, private, token-agnostic, and honest without a configured destination', () => {
  const page = renderEnrollmentFallbackPage(
    (key) => CONTENT.en[key],
    (key) => CONTENT.ar[key]
  );

  assert.match(page, /<html lang="en" dir="ltr">/);
  assert.match(page, /lang="ar" dir="rtl"/);
  assert.match(page, /meta name="referrer" content="no-referrer"/);
  assert.match(page, /meta name="robots" content="noindex, nofollow"/);
  assert.match(page, /This Public Web page does not have an approved PCA Child installation destination/);
  assert.match(page, /لم تُضبط في هذه الصفحة العامة وجهة معتمدة لتثبيت تطبيق حماية الطفل/);
  assert.match(page, /This link can authorize a device setup step/);
  assert.doesNotMatch(page, /href="\/child-app\/"/);
  assert.doesNotMatch(page, /<script\b|https?:\/\/|play\.google\.com|apps\.apple\.com/i);
  assert.doesNotMatch(page, /A{43}/);
});

test('enrollment fallback links to installation options only when approved distribution is configured', () => {
  const page = renderEnrollmentFallbackPage(
    (key) => CONTENT.en[key],
    (key) => CONTENT.ar[key],
    true,
  );

  assert.match(page, /An approved PCA Child installation destination is available/);
  assert.match(page, /تتوفر وجهة معتمدة لتثبيت تطبيق حماية الطفل/);
  assert.equal((page.match(/href="\/child-app\/"/g) ?? []).length, 2);
  assert.match(page, /View PCA Child installation options/);
  assert.match(page, /عرض خيارات تثبيت تطبيق حماية الطفل/);
  assert.doesNotMatch(page, /<script\b|https?:\/\//i);
  assert.doesNotMatch(page, /A{43}/);
});

test('nginx protects the full enrollment prefix and admits only canonical token paths', () => {
  const location = nginx.match(/location ~\* \^\/enroll \{([\s\S]*?)\n    \}/);
  assert.ok(location, 'the full enrollment prefix must be captured before generic routing');
  assert.match(location[1], /\$request_uri !~ "\^\/enroll\/\[A-Za-z0-9_-\]\{43\}\/\?\$"/);
  assert.match(location[1], /access_log off;/);
  assert.match(location[1], /try_files \/assets\/enrollment-fallback\.html =404;/);
  assert.doesNotMatch(location[1], /add_header\s/, 'the route inherits the complete server header policy');
  assert.match(nginx, /map \$request_uri \$pca_log_request \{\s*default 1;\s*~\*\^\/enroll 0;/);
  assert.match(nginx, /access_log \/var\/log\/nginx\/access\.log main if=\$pca_log_request;/);
  assert.match(nginx, /map \$request_uri \$pca_referrer_policy \{\s*default "strict-origin-when-cross-origin";\s*~\*\^\/enroll "no-referrer";/);
  assert.match(nginx, /add_header Referrer-Policy \$pca_referrer_policy always;/);
  assert.match(nginx, /map \$request_uri \$pca_robots_policy \{\s*default "";\s*~\*\^\/enroll "noindex, nofollow";/);
  assert.match(nginx, /add_header X-Robots-Tag \$pca_robots_policy always;/);
});

test('only the exact asset-links path is allowed through the dotfile denial', () => {
  const location = nginx.match(/location = \/\.well-known\/assetlinks\.json \{([\s\S]*?)\n    \}/);
  assert.ok(location, 'the exact asset-links route must exist');
  assert.match(location[1], /default_type application\/json;/);
  assert.match(location[1], /expires -1;/);
  assert.match(location[1], /try_files \$uri =404;/);
  assert.match(nginx, /location ~ \/\\\.\s*\{[\s\S]*?deny all;/);
  assert.match(nginx, /try_files \$uri \$uri\/ =404;/);
  assert.doesNotMatch(nginx, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html/);
});
