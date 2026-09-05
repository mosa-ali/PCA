/**
 * SHA-256 manifest of every byte that ships.
 *
 * Written OUTSIDE dist/ so the artifact can be audited without the manifest
 * itself becoming part of the artifact it describes. Inside the image it lives
 * at /etc/pca/MANIFEST.sha256, which nginx does not serve.
 *
 * What it is for: proving that the container running at www.pcasafe.com holds
 * the exact bytes that were reviewed. Without it, "the right image is deployed"
 * rests on a tag, and a tag can be moved.
 *
 * Usage:  node deploy/manifest.mjs [outputPath]
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const out = process.argv[2] ?? join(ROOT, 'reports/MANIFEST.sha256');

async function walk(dir, prefix = '') {
  const entries = [];
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) entries.push(...(await walk(abs, rel)));
    else entries.push({ abs, rel });
  }
  return entries;
}

const files = await walk(DIST);
if (files.length === 0) {
  console.error('MANIFEST ERROR: dist/ is empty. Run the build first.');
  process.exitCode = 1;
} else {
  const lines = [];
  let totalBytes = 0;
  for (const f of files) {
    const bytes = await readFile(f.abs);
    totalBytes += bytes.length;
    lines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${f.rel}`);
  }

  // A manifest of the manifest: one value to compare between a reviewed build
  // and a running container, rather than 26 lines to eyeball.
  const rollup = createHash('sha256').update(lines.join('\n')).digest('hex');

  const body = [
    `# PCA Public Release A artifact manifest`,
    `# files: ${files.length}  bytes: ${totalBytes}`,
    `# artifact-sha256: ${rollup}`,
    ...lines,
    '',
  ].join('\n');

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, body, 'utf8');
  console.log(`manifest: ${files.length} file(s), ${totalBytes} B, artifact-sha256 ${rollup}`);
  console.log(`written:  ${out}`);
}
