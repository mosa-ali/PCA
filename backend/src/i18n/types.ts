import type { SafeExplanationKind } from '../ai/types.js';
import type { ChildRequestErrorCode } from '../childrequests/ChildRequestService.js';
import type { DeviceAuthErrorCode } from '../deviceauth/DeviceAuthService.js';
import type { DeviceDirectoryErrorCode } from '../device/DeviceDirectoryService.js';
import type { EnrollmentErrorCode } from '../enrollment/EnrollmentCoordinator.js';
import type { InvitationErrorCode } from '../invitation/InvitationService.js';
import type { ModelLifecycleErrorCode } from '../model/ModelLifecycleService.js';
import type { PairingErrorCode } from '../pairing/PairingService.js';
import type { RecoveryErrorCode } from '../recovery/RecoveryService.js';
import type { ScheduleDecisionKind } from '../schedule/types.js';
import type { ExportOutcomeKind } from '../export/types.js';
import type { PurgePlanEntry } from '../retention/engine.js';
import type { ModeBEventErrorCode } from '../youtube/ModeBPlaybackEventService.js';
import type { ModeBEventType } from '../youtube/types.js';
import type { WebRuleSource } from '../web/types.js';

/** doc 20 Section 1: launch languages only -- "PCA-FR-110/111." Adding a third locale is a product decision, not a silent code change. */
export type SupportedLocale = 'en' | 'ar';

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['en', 'ar'];

/**
 * Every message id is DOMAIN-NAMESPACED (`domain.CODE`), never a bare error/reason code. This
 * is deliberate: an audit across backend/src/ (PCA-16A wave 2) found that many domains reuse the
 * SAME bare code (e.g. `NOT_FOUND` appears in enrollment/, invitation/, deviceauth/, model/,
 * childrequests/) with DIFFERENT English sentences ("Invitation was not found." vs "Model
 * lifecycle record does not exist."). A flat `Record<'NOT_FOUND', string>` could only ever hold
 * ONE of those meanings -- namespacing by domain is what makes every domain's own wording
 * independently correct and collision-proof by construction, not just by convention.
 *
 * Each namespace reuses the SOURCE MODULE'S OWN already-typed error/reason code as the suffix
 * (never a hand-duplicated copy), so a new code added to e.g. EnrollmentErrorCode is a type
 * error here until this module's message tables are updated to match -- the same
 * compiler-enforced completeness guarantee the web/ai integration already relies on.
 */
export type WebDecisionMessageId = `web.${WebRuleSource | 'CLASSIFIER' | 'DEFAULT'}`;
export type AiExplanationMessageId = `ai.${SafeExplanationKind}`;
export type EnrollmentMessageId = `enrollment.${EnrollmentErrorCode}`;
export type InvitationMessageId = `invitation.${InvitationErrorCode}`;
export type PairingMessageId = `pairing.${PairingErrorCode}`;
export type DeviceAuthMessageId = `deviceAuth.${DeviceAuthErrorCode}`;
export type DeviceMessageId = `device.${DeviceDirectoryErrorCode}`;
export type RecoveryMessageId = `recovery.${RecoveryErrorCode}`;
export type YoutubeModeBEventMessageId = `youtube.modeBEvent.${ModeBEventType}`;
export type YoutubeModeBErrorMessageId = `youtube.modeBError.${ModeBEventErrorCode}`;
export type ChildRequestMessageId = `childRequest.${ChildRequestErrorCode}`;
export type ModelMessageId = `model.${ModelLifecycleErrorCode}`;
export type ScheduleMessageId = `schedule.${ScheduleDecisionKind}`;
export type RetentionMessageId = `retention.${PurgePlanEntry['reason']}`;
export type ExportMessageId = `export.${ExportOutcomeKind}`;

/** One additional message demonstrating the typed-placeholder + bidi-isolation pattern (doc 20 Section 3) for a domain-bearing notice. */
export type DomainNoticeMessageId = 'DOMAIN_BLOCKED_NOTICE';

export type MessageId =
  | WebDecisionMessageId
  | AiExplanationMessageId
  | EnrollmentMessageId
  | InvitationMessageId
  | PairingMessageId
  | DeviceAuthMessageId
  | DeviceMessageId
  | RecoveryMessageId
  | YoutubeModeBEventMessageId
  | YoutubeModeBErrorMessageId
  | ChildRequestMessageId
  | ModelMessageId
  | ScheduleMessageId
  | RetentionMessageId
  | ExportMessageId
  | DomainNoticeMessageId;

/**
 * Named, typed placeholders only -- never positional string concatenation (doc 20 Section 2).
 * `domain` is an LTR token always bidi-isolated when embedded in an Arabic message (see
 * translate.ts). The schedule-specific fields are plain numbers/opaque ids, never a pre-formatted
 * sentence fragment -- doc 20 Section 4's locale-aware presentation ("Present ... numbers ...
 * using the device locale/preference") is the CALLER's job (e.g. Android's NumberFormat/
 * String.format(locale, ...), mirroring formatDuration's approach on the Android side) once it
 * receives these raw values; this module only ever hands off numeric/opaque data, never a
 * pre-localized string, so a caller can always apply its own locale-correct number formatting.
 */
export interface MessageParams {
  domain?: string;
  windowId?: string;
  windowCount?: number;
  totalWindowCount?: number;
  usedMinutes?: number;
  limitMinutes?: number;
  bonusMinutes?: number;
  enforcementCapability?: string;
}
