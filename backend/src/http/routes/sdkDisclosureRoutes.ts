/**
 * PCA-NFR-064 (Writer65) -- backend-served third-party-SDK disclosure
 * endpoint. Serves `THIRD_PARTY_SDK_DISCLOSURE`
 * (backend/src/sdkDisclosure/thirdPartySdks.generated.ts), a file
 * mechanically GENERATED from the real dependency manifests
 * (backend/package.json, platform-admin-web/package.json,
 * android/gradle/libs.versions.toml -- see
 * backend/scripts/generateSdkDisclosure.mjs) -- never a hand-maintained
 * parallel list that could drift from what actually ships.
 * backend/test/security/sdkDisclosure.test.mjs fails CI if the committed
 * generated file is stale relative to the manifests.
 *
 * Public, unauthenticated, read-only, GET-only: this is a disclosure
 * surface (what SDKs does this product actually use), not an
 * administrative or family-data endpoint, so it carries no session
 * requirement -- mirrors the public posture of a privacy-policy/SDK-list
 * page. No family activity, credential, or PII of any kind is reachable
 * from this file (structurally: it only ever re-serves the static
 * generated constant below).
 *
 * NOT WIRED into buildServer.ts by this lane (mission: this lane owns no
 * edits to buildServer.ts/main.ts) -- see this lane's final report's
 * COORDINATOR_BINDING_REQUIRED wiring instructions, same pattern
 * settlementRoutes.ts already established.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { THIRD_PARTY_SDK_DISCLOSURE } from '../../sdkDisclosure/thirdPartySdks.generated.js';
import type { createRateLimiter } from '../rateLimit.js';

export interface SdkDisclosureRoutesDeps {
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

export function registerSdkDisclosureRoutes(app: FastifyInstance, deps: SdkDisclosureRoutesDeps): void {
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'sdk-disclosure' });

  app.get('/sdk-disclosure', { preHandler: [readLimiter] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(THIRD_PARTY_SDK_DISCLOSURE);
  });
}
