import type { DashboardCardProvider } from './DashboardCardProvider.js';
import type { CapabilityState, DashboardCard } from './types.js';
import type { ModeTransitionService } from '../youtube/ModeTransitionService.js';
import type { ModeAUsageReportService } from '../youtube/ModeAUsageReportService.js';
import type { ModeAUsageEvidence, UsageCapabilityStatus, UsageSource } from '../youtube/types.js';

/** One profile's current Mode A raw usage signal, as handed to ModeAUsageReportService.buildEvidence. */
export interface CurrentModeAUsage {
  source: UsageSource;
  capabilityStatus: UsageCapabilityStatus;
  durationMs: number | null;
}

/**
 * The narrow port this provider depends on for a profile's CURRENT Mode A
 * usage figure. No production implementation of this exists anywhere in
 * this codebase yet (checked: backend/src/usage/ is a DEVICE-local
 * normalization module PCA-2/PCA-4 own, never a server-queryable per-family
 * store -- see usage/types.ts's own doc comment), so main.ts wires the
 * honestly fail-closed UnavailableModeAUsageEvidenceSource below by
 * default, exactly like this codebase's other Unavailable* stubs
 * (UnavailableTrustSetRoleResolver, UnavailableChildProfileMembershipResolver,
 * etc.) rather than inventing a fabricated figure.
 */
export interface ModeAUsageEvidenceSource {
  getCurrentUsage(familyId: string, profileId: string): Promise<CurrentModeAUsage>;
}

/** doc 15: "Unavailable is itself a valid, reportable result." No real usage-evidence source is wired in production yet -- see this module's own ModeAUsageEvidenceSource doc comment. */
export class UnavailableModeAUsageEvidenceSource implements ModeAUsageEvidenceSource {
  async getCurrentUsage(): Promise<CurrentModeAUsage> {
    return { source: 'UNAVAILABLE', capabilityStatus: 'UNSUPPORTED', durationMs: null };
  }
}

function mapUsageCapabilityStatus(status: UsageCapabilityStatus): CapabilityState {
  switch (status) {
    case 'GRANTED':
      return 'AVAILABLE';
    case 'REVOKED':
      return 'PERMISSION_REQUIRED';
    case 'UNSUPPORTED':
      return 'UNAVAILABLE';
  }
}

/** doc 5: "missing evidence must never be displayed as zero use" -- a null durationMs (coverage gap) produces no fabricated summary text at all, only the capability state communicates the gap. */
function formatModeASummaryLabel(evidence: ModeAUsageEvidence): string | null {
  if (evidence.durationMs === null) return null;
  const minutes = Math.round(evidence.durationMs / 60_000);
  return `${minutes}m (${evidence.label})`;
}

/**
 * Adapts ModeTransitionService's real, persisted per-profile mode state and
 * ModeAUsageReportService's Mode A evidence builder into a YOUTUBE
 * DashboardCard (doc 18 Section 6). Mode B stays correctly out of scope
 * (doc 15 REQUIRES_FURTHER_OWNER_DECISION) -- this provider only ever
 * summarizes CURRENT mode state (which carries no such gate, per
 * ModeTransitionService.getMode) and Mode A app-usage evidence; it never
 * builds or exposes a Mode B playback/watch summary of any kind.
 *
 * A family-wide caller (`childId === null`, e.g. the family-level dashboard
 * overview) cannot report one aggregate mode across every child -- doc 15
 * models mode as strictly PER-PROFILE, and this codebase has no readable
 * central child-profile directory to enumerate a family's children by (see
 * childprofiles/ChildProfileMembershipResolver.ts's own doc comment) -- so
 * that case honestly reports LIMITED rather than fabricating a
 * cross-profile aggregate.
 */
export class YouTubeDashboardCardProvider implements DashboardCardProvider {
  readonly kind = 'YOUTUBE' as const;

  private readonly modeTransitionService: Pick<ModeTransitionService, 'getMode'>;
  private readonly usageReportService: ModeAUsageReportService;
  private readonly usageSource: ModeAUsageEvidenceSource;

  constructor(
    modeTransitionService: Pick<ModeTransitionService, 'getMode'>,
    usageReportService: ModeAUsageReportService,
    usageSource: ModeAUsageEvidenceSource = new UnavailableModeAUsageEvidenceSource(),
  ) {
    this.modeTransitionService = modeTransitionService;
    this.usageReportService = usageReportService;
    this.usageSource = usageSource;
  }

  async getCard(familyId: string, childId: string | null): Promise<DashboardCard> {
    if (childId === null) {
      return {
        kind: this.kind,
        capabilityState: 'LIMITED',
        lastAcknowledgedPolicyRevision: null,
        pendingOrOfflineStatus: 'NONE',
        summaryLabel: null,
      };
    }

    const mode = await this.modeTransitionService.getMode(familyId, childId);
    if (mode === 'B') {
      // Current mode state only -- Mode B usage/playback summarization
      // stays out of scope (see this class's own doc comment).
      return {
        kind: this.kind,
        capabilityState: 'AVAILABLE',
        lastAcknowledgedPolicyRevision: null,
        pendingOrOfflineStatus: 'NONE',
        summaryLabel: 'Mode B',
      };
    }

    const usage = await this.usageSource.getCurrentUsage(familyId, childId);
    const evidence = this.usageReportService.buildEvidence(familyId, childId, usage.source, usage.capabilityStatus, usage.durationMs);
    return {
      kind: this.kind,
      capabilityState: mapUsageCapabilityStatus(evidence.capabilityStatus),
      lastAcknowledgedPolicyRevision: null,
      pendingOrOfflineStatus: 'NONE',
      summaryLabel: formatModeASummaryLabel(evidence),
    };
  }
}
