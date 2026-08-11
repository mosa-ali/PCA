export type OpaqueFamilyId = string;
export type OpaqueProfileId = string;
export type EventId = string;

export type YouTubeMode = 'A' | 'B';

/** doc 15's per-source capability state -- "Unavailable" is itself a valid, reportable result. */
export type UsageCapabilityStatus = 'GRANTED' | 'REVOKED' | 'UNSUPPORTED';

export type UsageSource = 'ANDROID_USAGE_STATS' | 'IOS_FAMILY_CONTROLS' | 'UNAVAILABLE';

/**
 * doc 15 Mode A: "VERIFIED_WITH_LIMITATION... must label this as `app usage
 * only`... cannot fabricate an exact watched-video list from normal-app
 * usage or network traffic." `label` is a fixed literal, never a caller-
 * supplied string, so nothing downstream can override it into an implied
 * per-video claim. There is deliberately NO field here for a video id,
 * title, or watch list -- Mode A evidence structurally cannot carry one.
 * `durationMs: null` with `capabilityStatus !== 'GRANTED'` represents doc
 * 5's "missing evidence must never be displayed as zero use."
 */
export interface ModeAUsageEvidence {
  familyId: OpaqueFamilyId;
  profileId: OpaqueProfileId;
  source: UsageSource;
  capabilityStatus: UsageCapabilityStatus;
  durationMs: number | null;
  /** doc 15: "preserves a `coverage_gap` rather than inventing an end time." */
  coverageGap: boolean;
  observedAt: Date;
  readonly label: 'app usage only';
}

/**
 * doc 15: "Where officially supported and legally/commercially approved...
 * REQUIRES_FURTHER_OWNER_DECISION and terms verification before release."
 * Mode B is inert until BOTH `enabled` is true (an explicit owner decision,
 * never a per-family/child toggle) AND `termsReviewedAt` records the
 * required current-terms re-verification -- enabled alone is not
 * sufficient, matching doc 15's "release gate must re-verify the current
 * Terms... before enabling Mode B in any production build."
 */
export interface ModeBFeatureFlagState {
  enabled: boolean;
  termsReviewedAt: Date | null;
}

/**
 * doc 15's four honest playback-event boundaries: "started", "played state
 * observed", "completed signal observed", plus an explicit error boundary
 * for doc 15's "some videos cannot be embedded... must be presented
 * honestly." No boundary here or anywhere in this module is named or
 * labeled "watched".
 */
export type ModeBEventType =
  | 'PLAYBACK_STARTED'
  | 'PLAYBACK_STATE_OBSERVED'
  | 'PLAYBACK_COMPLETED_SIGNAL_OBSERVED'
  | 'PLAYBACK_ERROR';

export type ModeBErrorCode = 'EMBEDDING_DISABLED' | 'PLAYBACK_RESTRICTED' | 'NETWORK_ERROR' | 'UNKNOWN';

/**
 * doc 15: "Because PCA initiates the playback, it can maintain a local
 * event for the chosen video ID, resolved title/channel metadata when
 * permitted, start/stop/player-state events, observed duration and
 * errors." Every field here is scoped to ONE PCA-initiated playback
 * attempt -- never aggregated into an implied history list by this type.
 */
export interface ModeBPlaybackEvent {
  id: EventId;
  familyId: OpaqueFamilyId;
  profileId: OpaqueProfileId;
  videoId: string;
  channelId: string | null;
  title: string | null;
  eventType: ModeBEventType;
  observedDurationMs: number | null;
  errorCode: ModeBErrorCode | null;
  occurredAt: Date;
}
