# 12 — Screen-Time and Break Engine

## 1. Core rule

Baseline: after **60 minutes of continuous interactive viewing**, initiate a **30-minute break** where strong platform enforcement is available.

Both values are parent-configurable within product-approved ranges.

## 2. Continuous-use state machine

`IDLE → ACTIVE → WARNING → BREAK_REQUIRED → BREAK_ACTIVE → ELIGIBLE → ACTIVE`

### ACTIVE
Screen is interactive and qualifying use continues.

### Pause/reset principles
Short screen-offs may pause the counter. A meaningful break resets continuous-use accumulation according to parent policy. The engine must avoid easy reset by opening/closing apps or changing wall-clock time.

## 3. Time sources

- Use monotonic elapsed time for active-duration accounting where platform permits.
- Use wall-clock/time zone only for display, schedules and reports.
- Persist signed/checkpointed session state so reboot cannot silently grant a fresh hour.

## 4. Warnings

Proposed default warnings:
- 10 minutes remaining;
- 5 minutes;
- 1 minute;
- break starts.

Parent may enable/disable non-critical warnings.

## 5. Break UI

Break screen contains:
- remaining break time;
- simple reason;
- optional Arabic/English Dhikr/reflection cards;
- optional touch counter;
- emergency button;
- request-parent-override action if policy permits;
- accessibility controls.

The Dhikr counter is motivational only unless the parent explicitly chooses a counter condition. Timer completion remains the default unlock rule.

## 6. Emergency exceptions

Emergency calling, OS-required safety functions and parent-defined critical apps are not intentionally blocked.

## 7. Platform truth

- Android Standard Mode may not guarantee a non-bypassable full-device break.
- Android Protected Mode can provide stronger enforcement through supported DPC authority.
- iOS uses Managed Settings shields and Device Activity thresholds for selected apps/categories/domains.
