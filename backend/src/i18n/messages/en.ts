import type { MessageId } from '../types.js';

/**
 * English source strings -- the SOLE presentation-text authority for every id below.
 * web/WebFilterEngine.ts and ai/policy.ts previously carried their own local English string
 * maps (REASON_CODES, EXPLANATION_LABELS); both were removed in favor of calling `translate()`
 * against this table directly (PCA-16A correction: BACKEND_I18N_NOT_WIRED). The wording here is
 * unchanged from what those maps used to contain, so English output is byte-identical to before
 * -- this was a wiring fix, not a copy change. Other entries reuse the exact wording already
 * accepted in the remaining frozen source modules' own `*_ERROR_MESSAGES` maps /
 * `labelForModeBEvent()`, plus a small number of NEW messages for domains that had no prior
 * English text at all (retention/export deletion-and-export confirmations, doc 20 FR-113) and
 * one placeholder-bearing demo message.
 */
export const EN_MESSAGES: Record<MessageId, string> = {
  // web filtering decision reasons (formerly web/WebFilterEngine.ts's local REASON_CODES)
  'web.SECURITY_DENYLIST': 'blocked by a security threat rule',
  'web.PARENT_ALLOWLIST': "allowed by your family's allow list",
  'web.PARENT_DENYLIST': "blocked by your family's block list",
  'web.CATEGORY_RULE': "blocked by your family's content category rule",
  'web.SCHEDULE_RULE': "blocked by your family's schedule rule",
  'web.CLASSIFIER': "blocked by your family's explicit-content rule",
  'web.DEFAULT': 'no matching rule; allowed by default',
  'web.VPN_UNAVAILABLE': 'network filtering capability was unavailable for this request',

  // ai/policy.ts EXPLANATION_LABELS
  'ai.CATEGORY_RULE_MATCHED': "blocked under your family's category rule",
  'ai.SUPPLEMENTARY_RISK_SIGNAL': 'flagged by a supplementary risk signal for parent review',
  'ai.MODEL_UNAVAILABLE': 'on-device analysis was unavailable for this item',
  'ai.CONFIDENCE_BELOW_THRESHOLD': 'signal confidence was below the configured threshold',

  // enrollment/EnrollmentCoordinator.ts ENROLLMENT_ERROR_MESSAGES
  'enrollment.INVALID_TOKEN': 'Invitation token is malformed.',
  'enrollment.INVALID_PUBLIC_KEY': 'Device public key is malformed.',
  'enrollment.KEYS_NOT_DISTINCT': 'Signing and encryption public keys must be distinct.',
  'enrollment.INVALID_PLATFORM': 'Platform is not supported.',
  'enrollment.NOT_FOUND': 'Invitation was not found.',
  'enrollment.EXPIRED': 'Invitation has expired.',
  'enrollment.REVOKED': 'Invitation was revoked.',
  'enrollment.ALREADY_REDEEMED': 'Invitation was already redeemed.',
  'enrollment.PLATFORM_MISMATCH': 'Device platform does not match the invitation.',
  'enrollment.DUPLICATE_KEY': 'This public key is already registered to a device.',
  'enrollment.INVALID_ATTEMPT_ID': 'Bootstrap attempt id is malformed.',
  'enrollment.INVALID_RECOVERY_TOKEN': 'Attempt recovery token is malformed.',
  'enrollment.ATTEMPT_CONFLICT': 'This bootstrap attempt id cannot be used for this request.',

  // invitation/InvitationService.ts INVITATION_ERROR_MESSAGES
  'invitation.INVALID_TOKEN': 'Invitation token is malformed.',
  'invitation.NOT_FOUND': 'Invitation was not found.',
  'invitation.EXPIRED': 'Invitation has expired.',
  'invitation.REVOKED': 'Invitation was revoked.',
  'invitation.ALREADY_REDEEMED': 'Invitation was already redeemed.',
  'invitation.INVALID_STATE': 'Invitation is not in a state that allows this action.',
  'invitation.FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED': 'New managed-device capacity is unavailable after free access expires.',
  'invitation.MANAGED_DEVICE_LIMIT_REACHED': 'The managed-device limit for this family has been reached.',

  // pairing/PairingService.ts PAIRING_ERROR_MESSAGES
  'pairing.NOT_FOUND': 'Pairing request was not found.',
  'pairing.INVALID_STATE': 'Pairing request is not in a state that permits this operation.',
  'pairing.SELF_APPROVAL_DENIED': 'This account registered this endpoint and cannot also confirm it.',

  // deviceauth/DeviceAuthService.ts DEVICE_AUTH_ERROR_MESSAGES
  'deviceAuth.DEVICE_NOT_FOUND': 'Device was not found.',
  'deviceAuth.DEVICE_REVOKED': 'Device has been revoked.',
  'deviceAuth.NOT_FOUND': 'Challenge was not found.',
  'deviceAuth.EXPIRED': 'Challenge has expired.',
  'deviceAuth.ALREADY_CONSUMED': 'Challenge has already been used.',
  'deviceAuth.INVALID_SIGNATURE': 'Signature verification failed.',

  // device/DeviceDirectoryService.ts DEVICE_ERROR_MESSAGES
  'device.INVALID_PUBLIC_KEY': 'Public key is malformed.',
  'device.DUPLICATE_KEY': 'This public key is already registered to a device.',
  'device.DEVICE_NOT_FOUND': 'Device was not found.',
  'device.DEVICE_REVOKED': 'Device has been revoked.',
  'device.KEY_NOT_FOUND': 'Device key was not found.',
  'device.INVALID_STATE': 'Device is not in a state that permits this operation.',
  'device.SELF_APPROVAL_DENIED': 'This account registered this endpoint and cannot also confirm it.',

  // recovery/RecoveryService.ts RECOVERY_ERROR_MESSAGES
  'recovery.INVALID_INPUT': 'Recovery envelope input is malformed.',
  'recovery.VERSION_MISMATCH': 'Recovery envelope was changed by another writer; re-read before retrying.',
  'recovery.NOT_FOUND': 'Recovery envelope was not found.',

  // youtube/policy.ts labelForModeBEvent()
  'youtube.modeBEvent.PLAYBACK_STARTED': 'Mode B—PCA-controlled: started',
  'youtube.modeBEvent.PLAYBACK_STATE_OBSERVED': 'Mode B—PCA-controlled: played state observed',
  'youtube.modeBEvent.PLAYBACK_COMPLETED_SIGNAL_OBSERVED': 'Mode B—PCA-controlled: completed signal observed',
  'youtube.modeBEvent.PLAYBACK_ERROR': 'Mode B—PCA-controlled: playback error',

  // youtube/ModeBPlaybackEventService.ts MODE_B_ERROR_MESSAGES
  'youtube.modeBError.FEATURE_DISABLED': 'Mode B is not active (feature flag disabled or terms not reviewed).',
  'youtube.modeBError.INVALID_VIDEO_ID': 'videoId is not plausible.',
  'youtube.modeBError.INVALID_CHANNEL_ID': 'channelId is not plausible.',
  'youtube.modeBError.INVALID_TITLE': 'title is not plausible.',
  'youtube.modeBError.INVALID_EVENT_TYPE': 'eventType is not recognized.',
  'youtube.modeBError.INVALID_EVENT_SHAPE': 'errorCode is required for PLAYBACK_ERROR and must be absent otherwise.',
  'youtube.modeBError.INVALID_DURATION': 'observedDurationMs must be a non-negative finite number when supplied.',

  // childrequests/ChildRequestService.ts CHILD_REQUEST_ERROR_MESSAGES
  'childRequest.INVALID_INPUT': 'Child request input is not plausible.',
  'childRequest.NOT_FOUND': 'Child request does not exist.',
  'childRequest.ILLEGAL_TRANSITION': 'This child request has already been decided or is not in a decidable state.',
  'childRequest.REQUEST_EXPIRED': 'This child request has expired.',
  'childRequest.NOT_AUTHORIZED_TO_DECIDE': 'The deciding device is not authorized to approve/deny this request type.',
  'childRequest.NOT_THE_REQUESTER': 'Only the requesting child device may perform this action.',
  'childRequest.BONUS_MINUTES_OUT_OF_BOUND': 'Requested/granted extra minutes is outside the permitted bound.',
  'childRequest.COUNTER_OFFER_NOT_SHORTER': 'A counter-offer must grant strictly fewer minutes than the child requested.',

  // model/ModelLifecycleService.ts MODEL_LIFECYCLE_ERROR_MESSAGES
  'model.NOT_FOUND': 'Model lifecycle record does not exist.',
  'model.ILLEGAL_TRANSITION': 'This lifecycle transition is not permitted from the current state.',
  'model.ROLLBACK_TARGET_NOT_FOUND': 'Rollback target model does not exist.',
  'model.ROLLBACK_TARGET_NOT_KNOWN_GOOD': 'Rollback target is not a previously verified/known-good package.',
  'model.ROLLBACK_TARGET_IS_SAME_MODEL': 'Rollback target cannot be the currently active model itself.',
  'model.KILL_SWITCH_NOT_APPLICABLE': 'Kill switch can only disable a currently ACTIVE model.',
  'model.DIRECTIVE_WRONG_ACTION': 'Emergency directive action does not match this operation.',
  'model.DIRECTIVE_WRONG_TARGET': "Emergency directive's modelId does not match the requested target.",
  'model.DIRECTIVE_MISSING_ROLLBACK_TARGET': 'A ROLLBACK directive must name rollbackToModelId.',
  'model.DIRECTIVE_SIGNATURE_INVALID': 'Emergency directive failed signature verification.',

  // schedule/engine.ts -- new presentation layer (source used interpolated template-literal
  // sentences per decision, not a code+string map; params carry the SAME dynamic values,
  // substituted here with typed placeholders rather than the source's raw interpolation).
  'schedule.ALLOWED': 'Allowed.',
  'schedule.ALLOWED_BONUS': 'Allowed with {bonusMinutes} active bonus minutes.',
  'schedule.ALLOWED_EXCEPTION': 'Allowed under an active parent exception.',
  'schedule.BLOCKED_BEDTIME': 'Blocked by an active bedtime window.',
  'schedule.BLOCKED_SCHOOL_MODE': 'Blocked: outside the allowed scope of {windowCount} of {totalWindowCount} active school-mode windows.',
  'schedule.BLOCKED_PERIOD': 'Blocked by an active block period.',
  'schedule.BLOCKED_OUTSIDE_ALLOW_PERIOD': 'Blocked: no allow period currently covers this app.',
  'schedule.BLOCKED_LIMIT_REACHED': 'Blocked: used {usedMinutes} of {limitMinutes} minutes today.',
  'schedule.ENFORCEMENT_UNAVAILABLE': 'This decision cannot be confirmed as enforced right now (capability: {enforcementCapability}).',
  'schedule.INVALID_CONFIG': 'One or more schedule windows failed validation.',

  // retention/engine.ts PurgePlanEntry.reason -- doc 20 FR-113 "deletion confirmations": no
  // English text existed for this before PCA-16A; authored fresh here.
  'retention.EXPIRED': 'Removed because it reached the end of your family’s retention period.',
  'retention.ROLLING_RETENTION_SUPERSEDED': 'Removed because a newer location point replaced it.',
  'retention.DELETE_NOW': 'Removed by a parent’s Delete Now request.',

  // export/types.ts ExportOutcomeKind -- doc 20 FR-113, same "no prior English text" situation.
  'export.COMPLETED': 'Your family data export completed successfully.',
  'export.CANCELLED': 'The export was cancelled before it completed.',
  'export.FAILED': 'The export could not be completed.',

  // retention/deletionStateMachine.ts DeletionState -- doc 20 FR-113, PCA-16A wiring.
  'retention.state.ACTIVE': 'This record is currently active.',
  'retention.state.EXPIRY_DUE': 'This record has reached the end of your family’s retention period and is due for deletion.',
  'retention.state.DELETE_REQUESTED': 'Deletion has been requested for this record.',
  'retention.state.DELETED_LOCAL': 'This record has been deleted on this device.',
  'retention.state.DELETION_CONFIRMED': 'Deletion has been confirmed across your family’s devices.',
  'retention.state.DELETE_PENDING_REMOTE_DEVICE': 'Deletion is complete on this device and pending confirmation from another device.',
  'retention.INVALID_TRANSITION': 'This deletion status update could not be applied.',

  // commercialnotifications/CommercialNotificationService.ts default localized bodies -- doc 20 FR-113, PCA-16A wiring.
  'commercial_notification.QUOTE_READY': 'A new quote is ready for your review.',
  'commercial_notification.PAYMENT_CONFIRMED': 'Your payment has been confirmed.',
  'commercial_notification.ENTITLEMENT_INCREASED': 'Your account entitlement has been increased.',
  'commercial_notification.PAYMENT_FAILED': 'Your payment could not be completed.',
  'commercial_notification.REQUEST_DENIED': 'Your request was not approved.',
  'commercial_notification.QUOTE_EXPIRED': 'Your quote has expired.',
  'commercial_notification.RENEWAL_UPCOMING': 'Your subscription is due to renew soon.',

  DOMAIN_BLOCKED_NOTICE: '{domain} was blocked under your family’s rule',
};
