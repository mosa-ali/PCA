/**
 * Platform Administration HTTP surface for release management -- thin
 * adapter over `release/ReleaseService.ts`'s already-built and already-
 * tested (`backend/test/release/service.test.mjs`) publish/find/retire/
 * getCurrent/rollback operations, backed by the real `release_packages` /
 * `release_current_pointers` tables (`backend/migrations/0001_mysql_baseline.sql`,
 * `0002_sync_durability.sql`).
 *
 * This is an operator-facing capability (a platform administrator ships
 * signed app/model/rule package metadata for clients to fetch), never a
 * family-authorization one -- `ReleaseRecord` carries no family/child data
 * (see `release/types.ts`'s own doc comment) and RBAC here uses the
 * Platform Administration operation matrix (`VIEW_RELEASE`/
 * `ADMINISTER_RELEASE` in `platformadmin/auth/rbacPolicy.ts`), exactly the
 * same pattern `planRoutes.ts`/`entitlementRoutes.ts` already use --
 * `authorizePlatformAdminOperation(roles, operation)` checked before the
 * service is ever called.
 *
 * `ReleaseService` treats `signedMetadata` as an opaque, already-externally-
 * signed blob -- it never generates or verifies a signature, and neither
 * does this route layer. The wire representation of that blob is base64
 * (never raw bytes over JSON); this route does no cryptographic validation
 * of its contents beyond the service's own opaque-blob shape/size checks
 * (`ReleaseError.INVALID_INPUT`).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import { ReleaseError } from '../../../release/ReleaseService.js';
import type { ReleaseService } from '../../../release/ReleaseService.js';
import type { PackageType, Platform, ReleaseRecord } from '../../../release/types.js';
import { dateToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminReleaseRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  releaseService: ReleaseService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_BODY_BYTES = 64 * 1024; // headroom over the service's own 32 KiB signedMetadata ceiling
const RELEASE_ID_MAX_LENGTH = 256;
const VERSION_MAX_LENGTH = 64;
const PACKAGE_TYPES: PackageType[] = ['ANDROID_APP', 'IOS_APP', 'MODEL_PACKAGE', 'RULE_PACKAGE'];
const PLATFORMS: Platform[] = ['ANDROID', 'IOS', 'SHARED'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function releaseToDto(record: ReleaseRecord) {
  return {
    releaseId: record.releaseId,
    packageType: record.packageType,
    platform: record.platform,
    version: record.version,
    artifactDigest: record.artifactDigest,
    artifactSizeBytes: record.artifactSizeBytes,
    signingKeyId: record.signingKeyId,
    // Opaque externally-signed blob -- base64 on the wire, never interpreted here.
    signedMetadata: record.signedMetadata.toString('base64'),
    minimumSupportedVersion: record.minimumSupportedVersion,
    state: record.state,
    publishedAt: dateToJson(record.publishedAt),
    retiredAt: dateToJson(record.retiredAt),
  };
}

/** Fixed HTTP status per ReleaseError code -- never echoes the caller-supplied blob/digest/key back (mirrors ReleaseError's own fixed-message discipline). */
function mapReleaseError(error: unknown, reply: FastifyReply): boolean {
  if (!(error instanceof ReleaseError)) return false;
  switch (error.code) {
    case 'INVALID_INPUT':
      reply.code(400).send({ error: 'invalid_request' });
      return true;
    case 'CONFLICT':
      reply.code(409).send({ error: 'conflict' });
      return true;
    case 'NOT_FOUND':
      reply.code(404).send({ error: 'not_found' });
      return true;
    case 'ROLLBACK_TARGET_NOT_FOUND':
      reply.code(404).send({ error: 'rollback_target_not_found' });
      return true;
    case 'ROLLBACK_TARGET_NOT_PUBLISHED':
      reply.code(409).send({ error: 'rollback_target_not_published' });
      return true;
  }
}

export function registerPlatformAdminReleaseRoutes(app: FastifyInstance, deps: PlatformAdminReleaseRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-release-read' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'platform-admin-release-mutate' });

  function requireView(request: FastifyRequest, reply: FastifyReply): boolean {
    const roles = request.platformAdminRoles ?? [];
    if (authorizePlatformAdminOperation(roles, 'VIEW_RELEASE') !== 'ALLOW') {
      reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  function requireAdminister(request: FastifyRequest, reply: FastifyReply): boolean {
    const roles = request.platformAdminRoles ?? [];
    if (authorizePlatformAdminOperation(roles, 'ADMINISTER_RELEASE') !== 'ALLOW') {
      reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  // ---- Publish ----
  app.post(
    '/platform-admin/releases',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireAdminister(request, reply)) return;
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { packageType, platform, version, artifactDigest, artifactSizeBytes, signingKeyId, signedMetadata, minimumSupportedVersion } = body;
      if (typeof packageType !== 'string' || !PACKAGE_TYPES.includes(packageType as PackageType)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof platform !== 'string' || !PLATFORMS.includes(platform as Platform)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof version !== 'string' || version.length === 0 || version.length > VERSION_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof artifactDigest !== 'string') return reply.code(400).send({ error: 'invalid_request' });
      if (typeof artifactSizeBytes !== 'number') return reply.code(400).send({ error: 'invalid_request' });
      if (typeof signingKeyId !== 'string') return reply.code(400).send({ error: 'invalid_request' });
      if (typeof signedMetadata !== 'string') return reply.code(400).send({ error: 'invalid_request' });
      if (minimumSupportedVersion !== undefined && minimumSupportedVersion !== null && typeof minimumSupportedVersion !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      let signedMetadataBuffer: Buffer;
      try {
        signedMetadataBuffer = Buffer.from(signedMetadata, 'base64');
      } catch {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const record = await deps.releaseService.publishRelease({
          packageType: packageType as PackageType,
          platform: platform as Platform,
          version,
          artifactDigest,
          artifactSizeBytes,
          signingKeyId,
          signedMetadata: signedMetadataBuffer,
          minimumSupportedVersion: (minimumSupportedVersion as string | null | undefined) ?? null,
        });
        return reply.code(201).send(releaseToDto(record));
      } catch (error) {
        if (mapReleaseError(error, reply)) return;
        throw error;
      }
    },
  );

  // ---- Find by releaseId ----
  app.get(
    '/platform-admin/releases/:releaseId',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireView(request, reply)) return;
      const { releaseId } = request.params as { releaseId?: string };
      if (typeof releaseId !== 'string' || releaseId.length === 0 || releaseId.length > RELEASE_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const record = await deps.releaseService.findRelease(releaseId);
        return reply.code(200).send(releaseToDto(record));
      } catch (error) {
        if (mapReleaseError(error, reply)) return;
        throw error;
      }
    },
  );

  // ---- Retire ----
  app.post(
    '/platform-admin/releases/:releaseId/retire',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireAdminister(request, reply)) return;
      const { releaseId } = request.params as { releaseId?: string };
      if (typeof releaseId !== 'string' || releaseId.length === 0 || releaseId.length > RELEASE_ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const record = await deps.releaseService.retireRelease(releaseId);
        return reply.code(200).send(releaseToDto(record));
      } catch (error) {
        if (mapReleaseError(error, reply)) return;
        throw error;
      }
    },
  );

  // ---- Current release for a package/platform ----
  app.get(
    '/platform-admin/releases/current/:packageType/:platform',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireView(request, reply)) return;
      const { packageType, platform } = request.params as { packageType?: string; platform?: string };
      if (typeof packageType !== 'string' || !PACKAGE_TYPES.includes(packageType as PackageType)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof platform !== 'string' || !PLATFORMS.includes(platform as Platform)) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const record = await deps.releaseService.getCurrentRelease(packageType as PackageType, platform as Platform);
        return reply.code(200).send(releaseToDto(record));
      } catch (error) {
        if (mapReleaseError(error, reply)) return;
        throw error;
      }
    },
  );

  // ---- Rollback ----
  app.post(
    '/platform-admin/releases/rollback',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireAdminister(request, reply)) return;
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { packageType, platform, targetVersion } = body;
      if (typeof packageType !== 'string' || !PACKAGE_TYPES.includes(packageType as PackageType)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof platform !== 'string' || !PLATFORMS.includes(platform as Platform)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof targetVersion !== 'string' || targetVersion.length === 0 || targetVersion.length > VERSION_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const pointer = await deps.releaseService.rollbackToRelease(packageType as PackageType, platform as Platform, targetVersion);
        return reply.code(200).send({
          packageType: pointer.packageType,
          platform: pointer.platform,
          version: pointer.version,
          isExplicitRollback: pointer.isExplicitRollback,
          updatedAt: dateToJson(pointer.updatedAt),
        });
      } catch (error) {
        if (mapReleaseError(error, reply)) return;
        throw error;
      }
    },
  );
}
