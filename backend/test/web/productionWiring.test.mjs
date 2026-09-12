import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAIN_SOURCE = new URL('../../src/main.ts', import.meta.url);
const BACKEND_SRC = new URL('../../src/', import.meta.url);

async function readTypeScriptSources(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const entryUrl = new URL(entry.name, directoryUrl);
    if (entry.isDirectory()) {
      sources.push(...await readTypeScriptSources(new URL(`${entry.name}/`, directoryUrl)));
    } else if (entry.name.endsWith('.ts')) {
      sources.push({ path: join(directoryUrl.pathname, entry.name), source: await readFile(entryUrl, 'utf8') });
    }
  }
  return sources;
}

test('FABLE-A012: no backend production source constructs or injects the readable in-memory store', async () => {
  const mainSource = await readFile(MAIN_SOURCE, 'utf8');
  const sources = await readTypeScriptSources(BACKEND_SRC);
  for (const { path, source } of sources) {
    assert.doesNotMatch(source, /new\s+InMemoryWebRuleRepository\s*\(/, path);
    assert.doesNotMatch(source, /new\s+WebRuleService\s*\(/, path);
  }
  assert.doesNotMatch(mainSource, /import\s+.*(?:InMemoryWebRuleRepository|WebRuleService).*from\s+['"].*WebRuleStore/);
  assert.doesNotMatch(mainSource, /webRuleService\s*:\s*webRuleService/);
  assert.match(mainSource, /webRuleAuthorization:\s*safeZoneParentActionAuthorization/);
});

test('FABLE-A012: the production route source has no readable-store fallback', async () => {
  const routeSource = await readFile(new URL('../../src/http/routes/webRuleRoutes.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(routeSource, /new\s+InMemoryWebRuleRepository\s*\(/);
  assert.doesNotMatch(routeSource, /new\s+WebRuleService\s*\(/);
  assert.match(routeSource, /if\s*\(!deps\.webRuleService\)\s*return reply\.code\(503\)/);
});