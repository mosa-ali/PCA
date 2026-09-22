/**
 * Regression gate for the Platform Admin console's same-origin API proxy.
 *
 * WHY THIS TEST EXISTS. The console is built with `apiBaseUrl = ''`
 * (src/config/env.ts), so every API call is same-origin, and its CSP says
 * `connect-src 'self'`. That only works if something serves `/platform-admin/*`
 * from the console's own origin. `nginx.conf` shipped a bare SPA server with no
 * such location, so every API call matched `location /`, took the history
 * fallback, and returned `index.html` with HTTP 200. The observed production
 * symptom was exactly that: `platform.pcasafe.com/platform-admin/auth/whoami`
 * answered with the SPA shell while `api.pcasafe.com` answered the same path
 * with `401 application/json`.
 *
 * The gate is written as a pure function over (config text, client route paths)
 * rather than a handful of `expect(conf).toContain(...)` lines, because the
 * failure it must catch is a ROUTING decision, not a string: what matters is
 * which `location` nginx would actually select for an API path. The `GATE
 * SELF-TEST` block at the bottom feeds that same function deliberately broken
 * configs and asserts it reports them, so this file cannot pass by being
 * vacuous.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest runs with cwd = platform-admin-web (package.json's `test` script and
// the CI job's `working-directory` both guarantee it), so deploy artifacts are
// addressed relative to that. A missing file throws here rather than silently
// asserting about nothing.
const PROJECT_ROOT = process.cwd();

function readProjectFile(relativePath: string): string {
  const absolute = resolve(PROJECT_ROOT, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(`expected ${relativePath} under ${PROJECT_ROOT} (cwd=${PROJECT_ROOT})`);
  }
  return readFileSync(absolute, 'utf8');
}

const NGINX_CONF = readProjectFile('nginx.conf');
const APP_TSX = readProjectFile('src/App.tsx');
const NAV_CONFIG = readProjectFile('src/nav/navConfig.ts');

const API_HOST = 'api.pcasafe.com';
/** A real API path this console calls -- src/api/platformAdminAuthClient.ts. */
const PROBE_API_PATH = '/platform-admin/auth/whoami';

interface LocationBlock {
  readonly spec: string;
  readonly body: string;
}

interface CheckResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/**
 * nginx comments are line-based here (no directive in this file carries a
 * trailing `#` comment), so dropping whole comment lines is a faithful
 * reduction. It matters: this file's comments deliberately discuss the things
 * being asserted about (`try_files`, `add_header`, and an `${VAR}` template),
 * and parsing raw text would test the prose instead of the configuration.
 */
function stripComments(conf: string): string {
  return conf.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
}

function parseLocationBlocks(conf: string): LocationBlock[] {
  const blocks: LocationBlock[] = [];
  const opener = /location\s+([^{]+?)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(conf)) !== null) {
    let depth = 1;
    let index = opener.lastIndex;
    while (index < conf.length && depth > 0) {
      if (conf[index] === '{') depth += 1;
      else if (conf[index] === '}') depth -= 1;
      index += 1;
    }
    blocks.push({ spec: match[1].trim(), body: conf.slice(opener.lastIndex, index - 1) });
    opener.lastIndex = index;
  }
  return blocks;
}

/** A plain prefix location, e.g. `/platform-admin/` -- not `=`, `~`, `~*`, or `^~`. */
function isPlainPrefix(spec: string): boolean {
  return /^\/\S*$/.test(spec);
}

/**
 * The location nginx would select for `path`: an `=` exact match wins outright;
 * otherwise the LONGEST matching prefix wins, regardless of the order the
 * blocks appear in the file. Returning `null` means no location matches.
 */
function selectLocation(blocks: readonly LocationBlock[], path: string): LocationBlock | null {
  const exact = blocks.find((block) => block.spec === `= ${path}`);
  if (exact) return exact;

  let best: LocationBlock | null = null;
  for (const block of blocks) {
    const spec = block.spec.startsWith('^~ ') ? block.spec.slice(3).trim() : block.spec;
    if (!isPlainPrefix(spec)) continue;
    if (!path.startsWith(spec)) continue;
    if (best === null || spec.length > best.spec.length) best = block;
  }
  return best;
}

/**
 * The gate. Returns every problem rather than throwing on the first, so a
 * regressed config reports its full shape in one run.
 */
function checkApiProxyRouting(conf: string, clientRoutePaths: readonly string[]): CheckResult {
  const problems: string[] = [];
  const code = stripComments(conf);
  const blocks = parseLocationBlocks(code);

  if (blocks.length === 0) problems.push('no location blocks were parsed from nginx.conf');

  const selected = selectLocation(blocks, PROBE_API_PATH);
  if (selected === null) {
    problems.push(`no location matches ${PROBE_API_PATH}`);
  } else {
    const spec = selected.spec;
    const prefix = spec.startsWith('^~ ') ? spec.slice(3).trim() : spec;

    if (isPlainPrefix(prefix) && prefix === '/') {
      problems.push(`${PROBE_API_PATH} is served by the SPA fallback (location /) instead of being proxied`);
    }
    // The API prefix must be exactly /platform-admin/ -- a trailing slash stops
    // an unrelated future page such as /platform-administration being proxied.
    if (prefix !== '/platform-admin/') {
      problems.push(`the API prefix must be exactly /platform-admin/ (found ${JSON.stringify(spec)})`);
    }

    const proxyPass = /proxy_pass\s+(https?:\/\/[^\s;]+)\s*;/.exec(selected.body);
    if (!proxyPass) {
      problems.push('the selected API location has no proxy_pass, so it cannot reach the backend');
    } else {
      const upstream = proxyPass[1];
      if (!upstream.startsWith('https://')) {
        problems.push(`the API upstream must be https (found ${upstream})`);
      }
      // App Service terminates TLS with SNI-based routing: without this the
      // upstream handshake carries no hostname and the proxy fails.
      if (!/proxy_ssl_server_name\s+on\s*;/.test(selected.body)) {
        problems.push('the API upstream is HTTPS but proxy_ssl_server_name on; is missing (App Service needs SNI)');
      }
      // App Service routes on the inbound Host header, so forwarding the
      // console's own hostname would misroute the request.
      const upstreamHost = new URL(upstream).host;
      if (!new RegExp(`proxy_set_header\\s+Host\\s+${upstreamHost.replace(/\./g, '\\.')}\\s*;`).test(selected.body)) {
        problems.push(`the API location must set Host to the upstream host ${upstreamHost}`);
      }
    }

    // An unreachable upstream must yield a truthful 502, never the SPA shell.
    if (/try_files/.test(selected.body)) {
      problems.push('the API location must not use try_files: a failed upstream must not fall back to index.html');
    }
  }

  // The CAUTION documented at the top of nginx.conf: an add_header inside any
  // location discards every security header inherited from the server level.
  for (const block of blocks) {
    if (/add_header/.test(block.body)) {
      problems.push(`location ${block.spec} sets add_header, which discards the inherited security headers`);
    }
  }

  // The SPA must keep working: client-side routes are served by the history
  // fallback, so that block must still exist and still fall back to index.html.
  const spa = blocks.find((block) => block.spec === '/');
  if (!spa) {
    problems.push('the SPA history-fallback location / is missing');
  } else if (!/try_files\s+[^;]*\/index\.html\s*;/.test(spa.body)) {
    problems.push('the SPA fallback no longer resolves client routes to /index.html');
  }

  // The collision guard. Every client route in this app is declared WITHOUT the
  // /platform-admin prefix; if one ever gains it, the proxy above would swallow
  // a page instead of an API call.
  if (clientRoutePaths.length < 15) {
    problems.push(`only ${clientRoutePaths.length} client route paths were extracted, which is implausibly few -- the extraction is probably broken`);
  }
  for (const route of clientRoutePaths) {
    const normalized = route.startsWith('/') ? route : `/${route}`;
    if (normalized.startsWith('/platform-admin')) {
      problems.push(`client route ${route} collides with the proxied /platform-admin/ prefix`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Declared client-side routes, from the router and from the nav config. */
function clientRoutePaths(): string[] {
  const fromRouter = [...APP_TSX.matchAll(/path="([^"]+)"/g)].map((match) => match[1]);
  const fromNav = [...NAV_CONFIG.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]);
  return [...fromRouter, ...fromNav].filter((path) => path !== '*' && path.length > 0);
}

describe('platform-admin-web nginx: /platform-admin/ is proxied to the API', () => {
  it('extracts a plausible set of client routes from the router and nav config', () => {
    const paths = clientRoutePaths();
    expect(paths.length).toBeGreaterThanOrEqual(15);
    expect(paths).toContain('/dashboard');
    expect(paths).toContain('login');
  });

  it('no client route lives under the proxied /platform-admin/ prefix', () => {
    for (const path of clientRoutePaths()) {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      expect(normalized.startsWith('/platform-admin')).toBe(false);
    }
  });

  it('an API call is proxied to the https API upstream with SNI and an explicit Host -- not served the SPA shell', () => {
    const result = checkApiProxyRouting(NGINX_CONF, clientRoutePaths());
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('the selected location for an API path is the API prefix, not the history fallback', () => {
    const blocks = parseLocationBlocks(stripComments(NGINX_CONF));
    const selected = selectLocation(blocks, PROBE_API_PATH);
    expect(selected?.spec).toBe('/platform-admin/');
    expect(selected?.body).toContain(`proxy_pass https://${API_HOST}`);
    expect(selected?.body).not.toContain('try_files');
  });

  it('the SPA still resolves its own client routes and the health endpoint is untouched', () => {
    const blocks = parseLocationBlocks(stripComments(NGINX_CONF));
    const spa = blocks.find((block) => block.spec === '/');
    expect(spa?.body).toContain('/index.html');
    expect(blocks.some((block) => block.spec === '= /healthz')).toBe(true);
  });

  // ---------------------------------------------------------------------
  // GATE SELF-TEST: a gate must be demonstrably able to fail.
  // ---------------------------------------------------------------------
  describe('GATE SELF-TEST: the checker rejects defective configurations', () => {
    // A realistic route list, deliberately longer than the checker's
    // extraction floor: a synthetic list below that floor would make every
    // defective case "fail" for the wrong reason (a broken extraction rather
    // than the defect under test), which is exactly the vacuous pass this
    // self-test exists to rule out.
    const goodRoutes = [
      'login', 'activate', 'dashboard', 'accounts', 'accounts/:accountId',
      'entitlements', 'entitlement-requests', 'complimentary-capacity',
      'free-access-policy', 'billing/plans', 'billing/pricing', 'billing/quotes',
      'billing/invoices', 'billing/payments', 'settlement/accounts',
      'settlement/batches', 'settlement/reconciliation', 'admin-users', 'audit',
      'settings', 'not-permitted',
    ];
    const goodConfig = `
server {
    add_header X-Content-Type-Options "nosniff" always;

    location = /healthz { return 200 "ok\\n"; }

    location /assets/ { try_files $uri =404; }

    location /platform-admin/ {
        proxy_pass https://${API_HOST};
        proxy_ssl_server_name on;
        proxy_set_header Host ${API_HOST};
    }

    location / { try_files $uri $uri/ /index.html; }
}
`;

    it('accepts a correct configuration, so the defective cases below are meaningful', () => {
      expect(checkApiProxyRouting(goodConfig, goodRoutes)).toEqual({ ok: true, problems: [] });
    });

    const defective: Array<[string, string, string[]]> = [
      [
        'no API proxy at all (the shipped defect: API calls hit the SPA fallback)',
        `
server {
    location /assets/ { try_files $uri =404; }
    location / { try_files $uri $uri/ /index.html; }
}
`,
        goodRoutes,
      ],
      [
        'an API location with try_files, which can fall back to index.html',
        `
server {
    location /platform-admin/ {
        proxy_pass https://${API_HOST};
        proxy_ssl_server_name on;
        proxy_set_header Host ${API_HOST};
        try_files $uri $uri/ /index.html;
    }
    location / { try_files $uri $uri/ /index.html; }
}
`,
        goodRoutes,
      ],
      [
        'HTTPS upstream without proxy_ssl_server_name (SNI missing)',
        `
server {
    location /platform-admin/ {
        proxy_pass https://${API_HOST};
        proxy_set_header Host ${API_HOST};
    }
    location / { try_files $uri $uri/ /index.html; }
}
`,
        goodRoutes,
      ],
      [
        'no explicit Host header, so App Service would see the console hostname',
        `
server {
    location /platform-admin/ {
        proxy_pass https://${API_HOST};
        proxy_ssl_server_name on;
    }
    location / { try_files $uri $uri/ /index.html; }
}
`,
        goodRoutes,
      ],
      [
        'a plaintext upstream',
        `
server {
    location /platform-admin/ {
        proxy_pass http://${API_HOST};
        proxy_ssl_server_name on;
        proxy_set_header Host ${API_HOST};
    }
    location / { try_files $uri $uri/ /index.html; }
}
`,
        goodRoutes,
      ],
      [
        'an add_header inside a location, which discards the inherited security headers',
        `
server {
    location /platform-admin/ {
        proxy_pass https://${API_HOST};
        proxy_ssl_server_name on;
        proxy_set_header Host ${API_HOST};
        add_header Cache-Control "no-store" always;
    }
    location / { try_files $uri $uri/ /index.html; }
}
`,
        goodRoutes,
      ],
      [
        'a SPA fallback that no longer resolves to index.html',
        `
server {
    location /platform-admin/ {
        proxy_pass https://${API_HOST};
        proxy_ssl_server_name on;
        proxy_set_header Host ${API_HOST};
    }
    location / { try_files $uri $uri/ =404; }
}
`,
        goodRoutes,
      ],
      [
        'a client route that collides with the proxied prefix',
        `
server {
    location /platform-admin/ {
        proxy_pass https://${API_HOST};
        proxy_ssl_server_name on;
        proxy_set_header Host ${API_HOST};
    }
    location / { try_files $uri $uri/ /index.html; }
}
`,
        ['/dashboard', '/platform-admin/settings'],
      ],
      [
        'a prefix that is not exactly /platform-admin/, which would not proxy the API',
        `
server {
    location /admin/ {
        proxy_pass https://${API_HOST};
        proxy_ssl_server_name on;
        proxy_set_header Host ${API_HOST};
    }
    location / { try_files $uri $uri/ /index.html; }
}
`,
        goodRoutes,
      ],
      [
        'client route extraction returning nothing, which would make the collision check vacuous',
        `
server {
    location /platform-admin/ {
        proxy_pass https://${API_HOST};
        proxy_ssl_server_name on;
        proxy_set_header Host ${API_HOST};
    }
    location / { try_files $uri $uri/ /index.html; }
}
`,
        [],
      ],
    ];

    it.each(defective)('rejects: %s', (_label, config, routes) => {
      const result = checkApiProxyRouting(config, routes);
      expect(result.ok).toBe(false);
      expect(result.problems.length).toBeGreaterThan(0);
    });
  });
});
