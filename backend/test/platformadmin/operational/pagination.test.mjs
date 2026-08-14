import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePageRequest, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, MAX_PAGE_OFFSET } from '../../../dist/platformadmin/api/pagination.js';

test('parsePageRequest defaults when limit/offset absent', () => {
  const page = parsePageRequest({});
  assert.equal(page.limit, DEFAULT_PAGE_LIMIT);
  assert.equal(page.offset, 0);
});

test('parsePageRequest clamps an over-large limit to MAX_PAGE_LIMIT', () => {
  const page = parsePageRequest({ limit: '999999' });
  assert.equal(page.limit, MAX_PAGE_LIMIT);
});

test('parsePageRequest clamps an over-large offset to MAX_PAGE_OFFSET', () => {
  const page = parsePageRequest({ offset: '999999999' });
  assert.equal(page.offset, MAX_PAGE_OFFSET);
});

test('parsePageRequest rejects (falls back on) a negative/zero/non-numeric limit', () => {
  assert.equal(parsePageRequest({ limit: '0' }).limit, DEFAULT_PAGE_LIMIT);
  assert.equal(parsePageRequest({ limit: '-5' }).limit, DEFAULT_PAGE_LIMIT);
  assert.equal(parsePageRequest({ limit: 'not-a-number' }).limit, DEFAULT_PAGE_LIMIT);
});

test('parsePageRequest rejects (falls back on) a negative/non-numeric offset', () => {
  assert.equal(parsePageRequest({ offset: '-1' }).offset, 0);
  assert.equal(parsePageRequest({ offset: 'nope' }).offset, 0);
});

test('parsePageRequest accepts a valid in-range limit/offset unchanged', () => {
  const page = parsePageRequest({ limit: '50', offset: '10' });
  assert.equal(page.limit, 50);
  assert.equal(page.offset, 10);
});
