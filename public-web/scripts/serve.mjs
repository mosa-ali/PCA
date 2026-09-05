/**
 * Zero-dependency static server for local review of dist/.
 *
 * Development convenience only -- it is NOT the production host. It also sets
 * the response headers listed in src/lib/seo.mjs REQUIRED_RESPONSE_HEADERS, so
 * local review exercises the same policy the real host must serve. PUBLIC-0
 * recorded that no hosting layer exists anywhere in this repository and that
 * meta-delivered frame-ancestors is inert, which is why those headers are a
 * Release-A predeploy blocker rather than something a build can close.
 *
 * Directory URLs resolve to <dir>/index.html, matching the prerendered layout,
 * so no SPA history fallback is involved.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { REQUIRED_RESPONSE_HEADERS } from '../src/lib/seo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 4200);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let target = join(DIST, clean);
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
  } catch {
    if (!extname(target)) target = join(target, 'index.html');
  }
  return target;
}

createServer(async (req, res) => {
  const headers = { ...REQUIRED_RESPONSE_HEADERS };
  try {
    const file = await resolveFile(req.url ?? '/');
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(DIST, '404.html'));
      res.writeHead(404, { ...headers, 'Content-Type': TYPES['.html'] });
      res.end(body);
    } catch {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`PCA Public dist/ served at http://127.0.0.1:${PORT}/  (Arabic: /ar/)`);
});
