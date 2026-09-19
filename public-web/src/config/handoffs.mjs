/*
 * Cross-application authentication handoffs.
 *
 * Public Web owns only the chooser. Parent Web and Platform Admin own their
 * separate login realms. Default rendered hrefs stay neutral so a production
 * reverse proxy may mount those applications on the same host. Deployments
 * using separate origins supply the corresponding PUBLIC_*_WEB_ORIGIN value.
 * The local static server uses this same map to reach the two real Vite apps.
 */
const HANDOFFS = Object.freeze({
  parent: Object.freeze({
    path: '/parent/login/',
    loginPath: '/login/',
    originEnv: 'PUBLIC_PARENT_WEB_ORIGIN',
    localOrigin: 'http://127.0.0.1:4000',
  }),
  platformAdmin: Object.freeze({
    path: '/platform-admin/login/',
    loginPath: '/login/',
    originEnv: 'PUBLIC_PLATFORM_ADMIN_WEB_ORIGIN',
    localOrigin: 'http://127.0.0.1:4100',
  }),
});

function configFor(key) {
  const config = HANDOFFS[key];
  if (!config) throw new Error(`Unknown authentication handoff: ${key}`);
  return config;
}

function originOf(value, label) {
  if (!value?.trim()) return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be an absolute http(s) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error(`${label} must be an origin without credentials or a path`);
  }
  return parsed.origin;
}

function loginUrl(config, origin) {
  return origin ? `${origin}${config.loginPath}` : config.path;
}

export function authHandoffHref(key, env = process.env) {
  const config = configFor(key);
  return loginUrl(config, originOf(env[config.originEnv], config.originEnv));
}

export function localAuthHandoffTarget(key, env = process.env) {
  const config = configFor(key);
  const origin = originOf(env[config.originEnv], config.originEnv) ?? config.localOrigin;
  return loginUrl(config, origin);
}

export function localAuthHandoffForPath(pathname, env = process.env) {
  for (const [key, config] of Object.entries(HANDOFFS)) {
    if (config.path === pathname) return localAuthHandoffTarget(key, env);
  }
  return null;
}
