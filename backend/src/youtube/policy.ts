import type { ModeBErrorCode, ModeBEventType, ModeBFeatureFlagState, ModeBPlaybackEvent, YouTubeMode } from './types.js';

export const MAX_VIDEO_ID_LENGTH = 64;
export const MAX_CHANNEL_ID_LENGTH = 64;
export const MAX_TITLE_LENGTH = 512;

/** doc 15: "MODE_B feature flag = OFF by default." The only zero-argument way to obtain a flag state in this module -- every FeatureFlagStore starts here. */
export function defaultModeBFeatureFlagState(): ModeBFeatureFlagState {
  return { enabled: false, termsReviewedAt: null };
}

/**
 * doc 15: "REQUIRES_FURTHER_OWNER_DECISION and terms verification before
 * release... A release gate must re-verify the current Terms." Both the
 * owner's enable decision AND a recorded terms review must be present --
 * an owner enabling the flag without a recorded review, or a stale review
 * predating the enable decision, must not activate Mode B.
 */
export function isModeBActive(flag: ModeBFeatureFlagState): boolean {
  return flag.enabled && flag.termsReviewedAt !== null;
}

const MODE_TRANSITIONS: Record<YouTubeMode, ReadonlySet<YouTubeMode>> = {
  A: new Set(['B']),
  B: new Set(['A']),
};

/**
 * doc 15: Mode A and Mode B are "two deliberately different modes" a
 * profile is in one of at a time -- switching to B is only legal while the
 * feature flag is active (see isModeBActive); switching back to A is
 * always legal, since A has no activation precondition.
 */
export function isLegalModeTransition(from: YouTubeMode, to: YouTubeMode, flag: ModeBFeatureFlagState): boolean {
  if (!MODE_TRANSITIONS[from].has(to)) return false;
  if (to === 'B') return isModeBActive(flag);
  return true;
}

const EVENT_TYPES: ReadonlySet<ModeBEventType> = new Set([
  'PLAYBACK_STARTED',
  'PLAYBACK_STATE_OBSERVED',
  'PLAYBACK_COMPLETED_SIGNAL_OBSERVED',
  'PLAYBACK_ERROR',
]);

const ERROR_CODES: ReadonlySet<ModeBErrorCode> = new Set([
  'EMBEDDING_DISABLED',
  'PLAYBACK_RESTRICTED',
  'NETWORK_ERROR',
  'UNKNOWN',
]);

export function isPlausibleEventType(candidate: unknown): candidate is ModeBEventType {
  return typeof candidate === 'string' && EVENT_TYPES.has(candidate as ModeBEventType);
}

export function isPlausibleErrorCode(candidate: unknown): candidate is ModeBErrorCode {
  return typeof candidate === 'string' && ERROR_CODES.has(candidate as ModeBErrorCode);
}

/** doc 15: "must not obscure player controls... falsely identify the playback origin." A PLAYBACK_ERROR event must always carry a recognized error code -- never a silent/blank error. */
export function isPlausibleModeBEventShape(
  eventType: ModeBEventType,
  errorCode: unknown,
): errorCode is ModeBErrorCode | null {
  if (eventType === 'PLAYBACK_ERROR') return isPlausibleErrorCode(errorCode);
  return errorCode === null;
}

export function isPlausibleVideoId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_VIDEO_ID_LENGTH;
}

export function isPlausibleChannelId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_CHANNEL_ID_LENGTH;
}

export function isPlausibleTitle(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_TITLE_LENGTH;
}

/**
 * doc 15: "Parent reports label every item `Mode B—PCA-controlled`,
 * include source/coverage and distinguish `started`, `played state
 * observed`, and `completed signal observed`; no label says `watched`
 * unless a documented evidence rule supports it." This module defines no
 * such evidence rule, so `watched` never appears in any label this
 * function returns -- COMPLETED_SIGNAL is deliberately worded as an
 * observed signal, not a completion claim.
 */
export function labelForModeBEvent(event: Pick<ModeBPlaybackEvent, 'eventType'>): string {
  switch (event.eventType) {
    case 'PLAYBACK_STARTED':
      return 'Mode B—PCA-controlled: started';
    case 'PLAYBACK_STATE_OBSERVED':
      return 'Mode B—PCA-controlled: played state observed';
    case 'PLAYBACK_COMPLETED_SIGNAL_OBSERVED':
      return 'Mode B—PCA-controlled: completed signal observed';
    case 'PLAYBACK_ERROR':
      return 'Mode B—PCA-controlled: playback error';
  }
}
