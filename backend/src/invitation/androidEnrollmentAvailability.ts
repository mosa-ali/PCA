import { isProductionSensitiveRuntime } from '../runtime/environment.js';

/**
 * Resolve whether Android device enrollment can issue invitations.
 *
 * Production defaults closed and requires the owner to set the explicit
 * readiness value after the signed installer, landing page, App Link route,
 * and Digital Asset Links statement have been verified. A landing-page URL
 * alone never opens this API. Development and tests remain usable when the
 * variable is absent; an explicit `false` closes them too.
 */
export function resolveAndroidEnrollmentReady(env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = env.PCA_CHILD_APP_ENROLLMENT_READY;
  if (configured === 'true') return true;
  if (configured === 'false' || configured !== undefined) return false;
  return !isProductionSensitiveRuntime(env);
}
