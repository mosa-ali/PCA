/**
 * WellbeingMessageControlV1 -- canonical parent-controlled wellbeing message
 * policy contract (docs/architecture/36_PARENT_WELLBEING_MESSAGE_CONTROL.md).
 *
 * This is a logical client domain model only. It performs no server-side
 * authorization and selects no wire serialization or crypto suite -- it
 * produces a canonical payload for the existing family envelope.
 */

export const WELLBEING_CONTROL_CONTRACT_VERSION = 1 as const;

export type TargetMode = 'ONE_CHILD' | 'MULTIPLE_CHILDREN' | 'ALL_CHILDREN';

export interface TargetScope {
  readonly mode: TargetMode;
  /** Opaque child profile IDs. Empty/ignored when mode is ALL_CHILDREN. */
  readonly childProfileIds: readonly string[];
}

export type WellbeingCategory =
  | 'SKILLS_AND_LEARNING'
  | 'READING'
  | 'FAITH_POSITIVE'
  | 'GRATITUDE'
  | 'GOOD_DEED'
  | 'FAMILY_HELP'
  | 'HOME_RESPONSIBILITY'
  | 'CREATIVITY'
  | 'MOVEMENT_RESET'
  | 'REST_AND_RESET'
  | 'OUTDOOR_OR_OFFSCREEN'
  | 'PLANNING_AND_ORGANIZATION'
  | 'CUSTOM';

export const WELLBEING_CATEGORIES: readonly WellbeingCategory[] = [
  'SKILLS_AND_LEARNING', 'READING', 'FAITH_POSITIVE', 'GRATITUDE', 'GOOD_DEED',
  'FAMILY_HELP', 'HOME_RESPONSIBILITY', 'CREATIVITY', 'MOVEMENT_RESET',
  'REST_AND_RESET', 'OUTDOOR_OR_OFFSCREEN', 'PLANNING_AND_ORGANIZATION', 'CUSTOM',
];

export type WellbeingTrigger =
  | 'PERIODIC'
  | 'AFTER_UNLOCK'
  | 'RAPID_GAME_RETURN'
  | 'BREAK_STARTED'
  | 'BREAK_ACTIVE'
  | 'BREAK_COMPLETED'
  | 'LONG_SESSION_ENDED'
  | 'SCHEDULED_TIME'
  | 'CHILD_REQUESTED_IDEA';

export const WELLBEING_TRIGGERS: readonly WellbeingTrigger[] = [
  'PERIODIC', 'AFTER_UNLOCK', 'RAPID_GAME_RETURN', 'BREAK_STARTED', 'BREAK_ACTIVE',
  'BREAK_COMPLETED', 'LONG_SESSION_ENDED', 'SCHEDULED_TIME', 'CHILD_REQUESTED_IDEA',
];

/** Ordinary delivery surfaces. Full-screen/system-impersonating surfaces are never defined here (doc 36 §6.1). */
export type WellbeingDeliverySurface =
  | 'IN_APP_SMALL_CARD'
  | 'STANDARD_NOTIFICATION'
  | 'LOCK_SCREEN_REDACTED'
  | 'NEXT_UNLOCK_SMALL_CARD'
  | 'BREAK_SHIELD_OPTIONAL_CARD';

export const WELLBEING_DELIVERY_SURFACES: readonly WellbeingDeliverySurface[] = [
  'IN_APP_SMALL_CARD', 'STANDARD_NOTIFICATION', 'LOCK_SCREEN_REDACTED',
  'NEXT_UNLOCK_SMALL_CARD', 'BREAK_SHIELD_OPTIONAL_CARD',
];

/** BCP-47-shaped language tag, e.g. "en", "ar". Not auto-translated -- doc 36 §5.1. */
export type LanguageTag = string;

export interface LanguageText {
  readonly title: string;
  readonly body: string;
}

export type LanguageTextMap = Readonly<Record<LanguageTag, LanguageText>>;

export interface TimeWindow {
  /** Minutes since local midnight, [0, 1440). May exceed `endMinute` to express a midnight-crossing window. */
  readonly startMinute: number;
  readonly endMinute: number;
}

export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export const DAYS_OF_WEEK: readonly DayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export interface DeliveryPolicy {
  readonly triggers: readonly WellbeingTrigger[];
  readonly minimumIntervalMinutes: number;
  readonly maximumPerDay: number;
  readonly repeatCooldownMinutes: number;
  readonly lockScreenAllowed: boolean;
  readonly dismissible: boolean;
  readonly snoozable: boolean;
  readonly requiresAdultSupervision: boolean;
}

export interface ScheduleWindow {
  /** ISO-8601 date (YYYY-MM-DD), inclusive. Absent means "no lower bound". */
  readonly startDate?: string;
  /** ISO-8601 date (YYYY-MM-DD), inclusive. Absent means "no upper bound". */
  readonly endDate?: string;
  readonly daysOfWeek: readonly DayOfWeek[];
  readonly timeWindows: readonly TimeWindow[];
  /** IANA timezone identifier, e.g. "Asia/Riyadh". Absent means device-local. */
  readonly timezoneId?: string;
}

export interface CustomWellbeingMessage {
  readonly messageId: string;
  readonly enabled: boolean;
  readonly category: WellbeingCategory;
  readonly languageTexts: LanguageTextMap;
  readonly schedule: ScheduleWindow;
  readonly delivery: DeliveryPolicy;
  readonly target: TargetScope;
  readonly archivedAt?: string;
}

export interface CuratedSuggestionSelection {
  readonly suggestionId: string;
  readonly enabled: boolean;
}

export interface WellbeingMessageControlV1 {
  readonly version: 1;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly familyScopeRef: string;
  readonly targets: TargetScope;
  readonly enabled: boolean;
  readonly selectedCuratedSuggestionIds: readonly CuratedSuggestionSelection[];
  readonly customMessages: readonly CustomWellbeingMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WellbeingCommandType =
  | 'CREATE_CUSTOM_MESSAGE'
  | 'UPDATE_CUSTOM_MESSAGE'
  | 'ARCHIVE_CUSTOM_MESSAGE'
  | 'RESTORE_CUSTOM_MESSAGE'
  | 'ENABLE_CURATED_MESSAGE'
  | 'DISABLE_CURATED_MESSAGE'
  | 'UPDATE_DELIVERY_POLICY'
  | 'UPDATE_TARGETS';

interface CommandEnvelope<TType extends WellbeingCommandType, TPayload> {
  readonly type: TType;
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly newRevision: number;
  readonly actorMemberId: string;
  readonly targetScope: TargetScope;
  readonly payload: TPayload;
}

export type CreateCustomMessageCommand = CommandEnvelope<'CREATE_CUSTOM_MESSAGE', { readonly message: CustomWellbeingMessage }>;
export type UpdateCustomMessageCommand = CommandEnvelope<'UPDATE_CUSTOM_MESSAGE', { readonly messageId: string; readonly message: CustomWellbeingMessage }>;
export type ArchiveCustomMessageCommand = CommandEnvelope<'ARCHIVE_CUSTOM_MESSAGE', { readonly messageId: string; readonly archivedAt: string }>;
export type RestoreCustomMessageCommand = CommandEnvelope<'RESTORE_CUSTOM_MESSAGE', { readonly messageId: string }>;
export type EnableCuratedMessageCommand = CommandEnvelope<'ENABLE_CURATED_MESSAGE', { readonly suggestionId: string }>;
export type DisableCuratedMessageCommand = CommandEnvelope<'DISABLE_CURATED_MESSAGE', { readonly suggestionId: string }>;
export type UpdateDeliveryPolicyCommand = CommandEnvelope<'UPDATE_DELIVERY_POLICY', { readonly messageId: string; readonly delivery: DeliveryPolicy }>;
export type UpdateTargetsCommand = CommandEnvelope<'UPDATE_TARGETS', { readonly targets: TargetScope }>;

export type WellbeingCommand =
  | CreateCustomMessageCommand
  | UpdateCustomMessageCommand
  | ArchiveCustomMessageCommand
  | RestoreCustomMessageCommand
  | EnableCuratedMessageCommand
  | DisableCuratedMessageCommand
  | UpdateDeliveryPolicyCommand
  | UpdateTargetsCommand;

export interface WellbeingAuditEntry {
  readonly actionType: WellbeingCommandType;
  readonly actorOpaqueId: string;
  readonly targetOpaqueId: string;
  readonly messageId?: string;
  readonly policyRevision: number;
  readonly timestampUtc: string;
  readonly operationId: string;
}

export type PreviewSurface = 'IN_APP_SMALL_CARD' | 'STANDARD_NOTIFICATION' | 'LOCK_SCREEN_REDACTED' | 'ARABIC_RTL' | 'ENGLISH';

export interface CuratedSuggestion {
  readonly suggestionId: string;
  readonly category: WellbeingCategory;
  readonly languageTexts: LanguageTextMap;
}
