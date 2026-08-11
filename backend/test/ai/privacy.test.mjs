import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aiSrcDir = fileURLToPath(new URL('../../dist/ai/', import.meta.url));
const modelSrcDir = fileURLToPath(new URL('../../dist/model/', import.meta.url));

function jsFilesIn(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f));
}

// doc 23 Section 5/lane brief Section 35: "no secret logging," "no raw input logging/persistence." A static
// sweep of the compiled ai/ and model/ output -- these modules must never call console.*/process.stdout
// directly, since any such call is a potential channel for raw classification content or model metadata
// to leave the process boundary uncontrolled.
test('ai/ and model/ compiled output contain no console/logging statements', () => {
  const files = [...jsFilesIn(aiSrcDir), ...jsFilesIn(modelSrcDir)];
  assert.ok(files.length > 0, 'expected compiled .js files to exist -- run `npm run build` first');
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /console\.(log|warn|error|info|debug)/, `${file} must not log`);
  }
});
