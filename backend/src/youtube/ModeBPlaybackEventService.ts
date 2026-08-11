import { randomUUID } from 'node:crypto';
import { isModeBActive } from './policy.js';
import {
  isPlausibleChannelId,
  isPlausibleModeBEventShape,
  isPlausibleEventType,
  isPlausibleTitle,
  isPlausibleVideoId,
} from './policy.js';
import type {
  EventId,
  ModeBErrorCode,
  ModeBEventType,
  ModeBFeatureFlagState,
  ModeBPlaybackEvent,
  OpaqueFamilyId,
  OpaqueProfileId,
} from './types.js';

/** Local persistence port -- Mode B events are family-device-local per doc 15's "remain encrypted on family devices under the same retention/deletion controls as app activity." */
export interface ModeBPlaybackEventRepository {
  put(event: ModeBPlaybackEvent): Promise<void>;
  listForProfile(familyId: OpaqueFamilyId, profileId: OpaqueProfileId): Promise<ModeBPlaybackEvent[]>;
}

export class InMemoryModeBPlaybackEventRepository implements ModeBPlaybackEventRepository {
  private readonly events: ModeBPlaybackEvent[] = [];

  async put(event: ModeBPlaybackEvent): Promise<void> {
    this.events.push(event);
  }

  async listForProfile(familyId: OpaqueFamilyId, profileId: OpaqueProfileId): Promise<ModeBPlaybackEvent[]> {
    return this.events.filter((e) => e.familyId === familyId && e.profileId === profileId);
  }
}

export type ModeBEventErrorCode =
  | 'FEATURE_DISABLED'
  | 'INVALID_VIDEO_ID'
  | 'INVALID_CHANNEL_ID'
  | 'INVALID_TITLE'
  | 'INVALID_EVENT_TYPE'
  | 'INVALID_EVENT_SHAPE'
  | 'INVALID_DURATION';

export class ModeBEventError extends Error {
  readonly code: ModeBEventErrorCode;
  constructor(code: ModeBEventErrorCode) {
    super(MODE_B_ERROR_MESSAGES[code]);
    this.name = 'ModeBEventError';
    this.code = code;
  }
}

const MODE_B_ERROR_MESSAGES: Record<ModeBEventErrorCode, string> = {
  FEATURE_DISABLED: 'Mode B is not active (feature flag disabled or terms not reviewed).',
  INVALID_VIDEO_ID: 'videoId is not plausible.',
  INVALID_CHANNEL_ID: 'channelId is not plausible.',
  INVALID_TITLE: 'title is not plausible.',
  INVALID_EVENT_TYPE: 'eventType is not recognized.',
  INVALID_EVENT_SHAPE: 'errorCode is required for PLAYBACK_ERROR and must be absent otherwise.',
  INVALID_DURATION: 'observedDurationMs must be a non-negative finite number when supplied.',
};

/**
 * doc 15 Mode B: every write is gated on the feature flag being fully
 * active (owner-enabled AND terms-reviewed, see policy.ts's isModeBActive)
 * -- this is the enforcement point, not just the flag's own storage, so a
 * caller cannot record a Mode B event merely because a flag record exists
 * with a stale or missing terms review.
 */
export class ModeBPlaybackEventService {
  private readonly repository: ModeBPlaybackEventRepository;
  private readonly now: () => Date;

  constructor(repository: ModeBPlaybackEventRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  async recordEvent(
    flag: ModeBFeatureFlagState,
    familyId: OpaqueFamilyId,
    profileId: OpaqueProfileId,
    input: {
      videoId: string;
      channelId?: string | null;
      title?: string | null;
      eventType: ModeBEventType;
      observedDurationMs?: number | null;
      errorCode?: ModeBErrorCode | null;
    },
  ): Promise<ModeBPlaybackEvent> {
    if (!isModeBActive(flag)) throw new ModeBEventError('FEATURE_DISABLED');
    if (!isPlausibleVideoId(input.videoId)) throw new ModeBEventError('INVALID_VIDEO_ID');
    if (input.channelId != null && !isPlausibleChannelId(input.channelId)) throw new ModeBEventError('INVALID_CHANNEL_ID');
    if (input.title != null && !isPlausibleTitle(input.title)) throw new ModeBEventError('INVALID_TITLE');
    if (!isPlausibleEventType(input.eventType)) throw new ModeBEventError('INVALID_EVENT_TYPE');

    const errorCode = input.errorCode ?? null;
    if (!isPlausibleModeBEventShape(input.eventType, errorCode)) throw new ModeBEventError('INVALID_EVENT_SHAPE');

    const observedDurationMs = input.observedDurationMs ?? null;
    if (observedDurationMs !== null && (!Number.isFinite(observedDurationMs) || observedDurationMs < 0)) {
      throw new ModeBEventError('INVALID_DURATION');
    }

    const event: ModeBPlaybackEvent = {
      id: randomUUID() as EventId,
      familyId,
      profileId,
      videoId: input.videoId,
      channelId: input.channelId ?? null,
      title: input.title ?? null,
      eventType: input.eventType,
      observedDurationMs,
      errorCode,
      occurredAt: this.now(),
    };
    await this.repository.put(event);
    return event;
  }
}
