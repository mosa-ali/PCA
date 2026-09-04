/**
 * The trusted parent context's own readable child-label store.
 *
 * OWNER RULING (docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part F/H2):
 * "The parent sees Ahmed, not a UUID. The server sees only the opaque
 * child identifier." A child's readable display name is collected and
 * shown entirely from here, and MUST NEVER cross ../api/childProfileClient
 * in either direction -- see that file's own header.
 *
 * DELIBERATELY A PLAIN, TAB-LIFETIME, IN-MEMORY MODULE MAP -- not
 * localStorage, not sessionStorage, not IndexedDB. This is not a shortcut;
 * it is the owner's explicit, reasoned decision (Part F/H2, and the
 * discovery this session ran before touching any storage code):
 *
 *   - ../security/trustedEndpointKeyStore.ts's non-extractable browser
 *     signing key -- the ONLY thing that could make "this browser is
 *     trusted" survive a reload -- is ITSELF tab-lifetime only, by design
 *     ("today, a page reload requires re-pairing ... which is the safe
 *     default, not a regression"). Persisting a readable label across
 *     reload while the TRUST that label depends on does not survive reload
 *     would be incoherent -- the label would outlive the very thing that
 *     justified showing it.
 *   - Persisting trust itself across reload is explicitly classified
 *     TRUSTED_BROWSER_PRIVATE_PERSISTENCE = NEW_FEATURE_ARCHITECTURE_REQUIRED
 *     + EXTERNAL_SECURITY_REVIEW -- not repo-solvable in this wave, and
 *     this file must not quietly reopen that decision from the label side.
 *
 * So: within the CURRENT session, a label set here is available
 * immediately (no round trip, no flash of "unresolved" for a child THIS
 * browser just created). After a reload, this map is empty by construction
 * -- exactly the honest SETUP_REQUIRED_EXPECTED behaviour the owner
 * accepted, and the UI must render the resulting unresolved state, never
 * the raw childProfileId, as its primary label (see ../pages/family/
 * devices/AddDeviceWizard.tsx's own use of this module).
 */

const labelsByChildProfileId = new Map<string, string>();

export function setChildLabel(childProfileId: string, label: string): void {
  const trimmed = label.trim();
  if (trimmed.length === 0) return;
  labelsByChildProfileId.set(childProfileId, trimmed);
}

export function getChildLabel(childProfileId: string): string | null {
  return labelsByChildProfileId.get(childProfileId) ?? null;
}

export function hasChildLabel(childProfileId: string): boolean {
  return labelsByChildProfileId.has(childProfileId);
}

/** Test-only reset hook, matching the fixture-reset convention already used by the dev API clients (../dev/devDeviceEnrollmentClient.ts's __resetDevDeviceEnrollmentState). */
export function __resetChildLabelsForTest(): void {
  labelsByChildProfileId.clear();
}
