# 19 — Notifications and Email

## 1. Notification classes

### Critical
- protection disabled/degraded;
- child device revoked/removed;
- recovery/security event.

### Important
- screen limit reached;
- blocked content threshold;
- location/last-seen concern when configured;
- child approval request.

### Informational
- prayer reminder;
- weekly family summary;
- successful retention cleanup.

## 2. Privacy-preserving push

Push payloads contain generic text or opaque message reference. Sensitive details are E2EE-fetched after app unlock.

Example safe push:
> “PCA protection alert for Ahmed's device. Open PCA for details.”

## 3. Email strategy

Because mail normally passes through external servers, detailed child activity must not be routed through PCA's infrastructure by default.

Supported options:
1. **Generic PCA email:** “A device needs attention; open PCA.”
2. **Parent-provider detailed email (optional):** generated from the parent's device through the parent's configured provider, after explicit consent.

## 4. Email addresses

Parent may configure one or more verified notification addresses. Central service stores only addresses needed for service/account communication and generic alert routing, with clear consent.

## 5. Quiet hours

Parents can configure quiet hours for non-critical notifications. Critical protection/security events can bypass PCA quiet-hour rules subject to OS notification settings.
