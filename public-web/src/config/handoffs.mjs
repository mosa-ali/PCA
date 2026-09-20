/*
 * Cross-application authentication handoffs.
 *
 * Public Web owns only the information handoff. Parent Web and Platform Admin
 * own their separate login realms. Production links use the authoritative
 * dedicated origins; local/UAT routing can still override those origins with
 * PUBLIC_*_WEB_ORIGIN or the local Vite targets.
 */
const HANDOFFS = Object.freeze({
  parent: Object.freeze({
    publicPath: '/parent/login/',
    path: 'https://parent.pcasafe.com/login/',
    loginPath: '/login/',
    registerPath: '/register/',
    productionOrigin: 'https://parent.pcasafe.com',
    originEnv: 'PUBLIC_PARENT_WEB_ORIGIN',
    localOrigin: 'http://127.0.0.1:4000',
  }),
  platformAdmin: Object.freeze({
    publicPath: '/platform-admin/login/',
    path: 'https://platform.pcasafe.com/login/',
    loginPath: '/login/',
    productionOrigin: 'https://platform.pcasafe.com',
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
  return loginUrl(config, originOf(env[config.originEnv], config.originEnv) ?? config.productionOrigin);
}

export function parentRegistrationHref(env = process.env) {
  const config = configFor('parent');
  const origin = originOf(env[config.originEnv], config.originEnv) ?? config.productionOrigin;
  return `${origin}${config.registerPath}`;
}

export function localAuthHandoffTarget(key, env = process.env) {
  const config = configFor(key);
  const origin = originOf(env[config.originEnv], config.originEnv) ?? config.localOrigin;
  return loginUrl(config, origin);
}

export function localAuthHandoffForPath(pathname, env = process.env) {
  for (const [key, config] of Object.entries(HANDOFFS)) {
    if (config.publicPath === pathname) return localAuthHandoffTarget(key, env);
  }
  return null;
}

export function configuredAuthHandoffOrigins(env = process.env) {
  return new Set(
    Object.values(HANDOFFS)
      .map((config) => originOf(env[config.originEnv], config.originEnv) ?? config.productionOrigin)
      .filter(Boolean),
  );
}
