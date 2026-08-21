// PCA-ADD-ENR-016/017 crash-safety recovery. RemovalDecisionAuthority
// attempts device revocation inline, best-effort, immediately after an
// ALLOW_REMOVAL/REMOVE_REVOKE_DEVICE decision commits -- but a process
// crash between those two steps could otherwise leave a decision
// permanently saying "ALLOW_REMOVAL" while the device itself is never
// actually revoked. This script is the durable retry path: it finds
// every such decision the database can prove is still pending (via
// RemovalDecisionRepository.listAllowRemovalPendingDeviceRevocation's
// real JOIN against devices.status) and retries revocation for each.
//
// Safe to run repeatedly / on a schedule: DeviceDirectoryService.revokeDevice
// is itself idempotent (a device already REVOKED is simply a no-op, never
// a duplicate or harmful action). This repository has no cron/scheduler
// infrastructure today, so operate this as an external periodic job
// (e.g. a scheduled task hitting this script) rather than in-process --
// deliberately not fabricating scheduling infrastructure that doesn't
// exist elsewhere in this codebase.
import { closePool } from '../dist/db/pool.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../dist/familyrbac/FamilyAuditStore.js';
import { ParentActionAuthorizationService } from '../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../dist/familyrbac/types.js';
import { RemovalDecisionAuthority } from '../dist/familyrbac/RemovalDecisionAuthority.js';
import { MySqlRemovalDecisionRepository } from '../dist/familyrbac/MySqlRemovalDecisionRepository.js';
import { UnavailableRemovalDecisionSigningKeyResolver } from '../dist/familyrbac/UnavailableRemovalDecisionSigningKeyResolver.js';
import { UnavailableAuthorizedRecoveryAuthority } from '../dist/familyrbac/UnavailableAuthorizedRecoveryAuthority.js';
import { UnavailableTrustSetRoleResolver } from '../dist/familyrbac/UnavailableTrustSetRoleResolver.js';
import { RejectingDeviceSignatureVerifier } from '../dist/runtime-sync/index.js';
import { AdministrationPinService } from '../dist/enrollment/AdministrationPinService.js';
import { MySqlAdministrationPinRepository } from '../dist/enrollment/MySqlAdministrationPinRepository.js';
import { DeviceDirectoryService } from '../dist/device/DeviceDirectoryService.js';
import { MySqlDeviceRepository } from '../dist/device/MySqlDeviceRepository.js';

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL is required.');

// This job only ever reads pending state and calls the one narrow
// revokeDevice operation -- it never itself decides a request (no PIN
// verification, no signature verification, no RBAC authorization path is
// exercised), so the Unavailable*/Rejecting* fail-closed stubs below are
// never actually invoked by anything this script does; they exist only
// because RemovalDecisionAuthority's constructor requires them.
const familyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository());
const trustSetRoleResolver = new UnavailableTrustSetRoleResolver();
const authorization = new ParentActionAuthorizationService(
  trustSetRoleResolver,
  defaultFamilyRbacPolicyConfig,
  { async claim() { return 'CLAIMED'; } },
  () => new Date(),
  undefined,
  familyAuditService,
);
const deviceDirectoryService = new DeviceDirectoryService(new MySqlDeviceRepository(), () => new Date(), familyAuditService);
const authority = new RemovalDecisionAuthority({
  repository: new MySqlRemovalDecisionRepository(),
  authorization,
  signingKeyResolver: new UnavailableRemovalDecisionSigningKeyResolver(),
  signatureVerifier: new RejectingDeviceSignatureVerifier(),
  targetDeviceRoleResolver: trustSetRoleResolver,
  pinService: new AdministrationPinService({ repository: new MySqlAdministrationPinRepository() }),
  recoveryAuthority: new UnavailableAuthorizedRecoveryAuthority(),
  auditService: familyAuditService,
  deviceRevocation: deviceDirectoryService,
});

const result = await authority.reconcilePendingRevocations();
console.log('Removal-decision device-revocation reconciliation:', result);
if (result.failedRequestIds.length > 0) {
  console.error(`${result.failedRequestIds.length} request(s) still failed after retry -- investigate manually: ${result.failedRequestIds.join(', ')}`);
  process.exitCode = 1;
}

await closePool();
