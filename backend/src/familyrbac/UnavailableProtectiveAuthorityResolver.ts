/**
 * Structurally matches ../http/routes/removalDecisionRoutes.ts's
 * `ProtectiveAuthorityResolver` (PCA-ADD-ENR-016: whether protective
 * authority currently applies to a target child/device before a
 * removal/disable request may even be created). Defined here rather than
 * importing that route module's type to avoid a routes -> familyrbac ->
 * routes import cycle; the shape is intentionally kept in lockstep with it.
 *
 * Explicit production composition boundary while no real binding to the
 * device's actual platform-authority state (doc
 * 08_ENROLLMENT_DEVICE_LIFECYCLE.md Section 8/PCA-FR-145) exists yet.
 * Mirrors UnavailableTrustSetRoleResolver's fail-closed posture: this
 * resolver never asserts that protective authority applies, so
 * `POST /removal-decisions` always responds 409
 * (`protective_authority_not_applicable`) rather than silently admitting a
 * removal/disable request the coordinator never actually verified.
 * Replacing it with the real, reviewed device-authority binding is a
 * wiring change, not a policy change.
 */
export class UnavailableProtectiveAuthorityResolver {
  async resolve(_familyId: string, _deviceId: string): Promise<boolean> {
    return false;
  }
}
