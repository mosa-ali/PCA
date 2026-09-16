/**
 * TEMPORARY (PCA-DW-W3-E, 2026-09-16) runtime DB identity diagnostic.
 *
 * Exists solely to answer one question the owner cannot otherwise safely
 * answer: which MySQL identity does this deployed backend actually
 * authenticate as at runtime? Reading PCA_DATABASE_URL (even just its
 * username portion) is not an option -- that would require exposing part
 * of a Key-Vault-resolved secret. This route instead asks the database
 * itself, through the app's own already-configured pool (same TLS posture,
 * same credential, same everything a real request would use), and returns
 * ONLY non-secret session facts: the authenticated identity, active
 * database, server version, and negotiated TLS protocol/cipher. It can
 * never return a password, connection string, secret value, admin ID, or
 * any table content.
 *
 * NOT platform-admin-session-gated: no Platform Admin can complete
 * activation/MFA and log in yet (that is one of the things this whole
 * reconciliation is unblocking), so a session-gated route would be
 * unusable when it's needed most. Gated instead by a dedicated bearer
 * token that must be explicitly configured (PCA_TEMP_RUNTIME_IDENTITY_DIAGNOSTIC_TOKEN)
 * -- absent by default in every environment, including production today,
 * so this route does not exist in practice unless someone deliberately
 * turns it on for exactly this one-time evidence-gathering purpose. A
 * missing/wrong token returns 404 (never 401), so an unauthenticated
 * prober cannot distinguish "wrong token" from "route removed."
 *
 * MUST be removed in the deployment immediately following the one that
 * captures this evidence -- see docs/supervision/
 * PCA_PRODUCTION_MIGRATION_0041_0042_RECONCILIATION_2026-09-16.md's
 * runbook addendum for the exact removal-and-404-proof step. This is not a
 * product API and must never become one.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { getPool } from '../../../db/pool.js';
import type { createRateLimiter } from '../../rateLimit.js';

const TOKEN_ENV_VAR = 'PCA_TEMP_RUNTIME_IDENTITY_DIAGNOSTIC_TOKEN';

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function registerTempRuntimeIdentityDiagnosticRoute(app: FastifyInstance, deps: { rateLimiter: ReturnType<typeof createRateLimiter> }): void {
  const expectedToken = process.env[TOKEN_ENV_VAR];
  // Registered ONLY when the operator has explicitly opted in -- absent
  // (the default everywhere, including production as configured today),
  // this route does not exist at all, exactly like every other feature
  // this codebase gates on an explicit environment variable.
  if (!expectedToken) return;

  app.get(
    '/platform-admin/internal/temp-runtime-identity',
    { preHandler: deps.rateLimiter({ windowMs: 60 * 60_000, max: 5, bucket: 'temp-runtime-identity-diagnostic' }) },
    async (request, reply) => {
      const suppliedToken = request.headers['x-pca-diagnostic-token'];
      if (typeof suppliedToken !== 'string' || !constantTimeEquals(suppliedToken, expectedToken)) {
        // 404, not 401: an unauthenticated caller must not learn this route exists at all.
        reply.code(404).send({ error: 'not_found' });
        return;
      }

      const pool = getPool();
      // CURRENT_USER is a reserved word -- cannot be used bare as a column
      // alias (confirmed: MySQL raises ER_PARSE_ERROR on `AS current_user`
      // without backticks). Aliased to runtime_user instead, matching the
      // same naming already used in the owner-relayed production SQL.
      const [[identityRow]] = await pool.query<any>(
        'SELECT CURRENT_USER() AS runtime_user, DATABASE() AS active_database, VERSION() AS mysql_version',
      );
      const [tlsRows] = await pool.query<any>(`SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_version', 'Ssl_cipher')`);
      const tls: Record<string, string> = {};
      for (const row of tlsRows as Array<{ Variable_name: string; Value: string }>) {
        tls[row.Variable_name] = row.Value;
      }

      reply.send({
        currentUser: identityRow.runtime_user,
        activeDatabase: identityRow.active_database,
        mysqlVersion: identityRow.mysql_version,
        tlsVersion: tls.Ssl_version ?? null,
        tlsCipher: tls.Ssl_cipher ?? null,
      });
    },
  );
}
