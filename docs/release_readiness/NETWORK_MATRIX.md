# Network Condition Matrix (PCA-18/19)

Real-device UAT (see `UAT_TEST_PLAN.md`) must be exercised under each
network condition below, crossed against the affected flows. This document
defines the matrix; execution and results live in `uat_execution_log.json`.
No automated test satisfies this matrix — it requires a real device on a
real network (or a controlled network-shaping tool on real hardware), never
a mocked network layer.

## Conditions

| Code | Condition | How to induce on a real device |
|---|---|---|
| N1 | Online, stable Wi-Fi | Normal Wi-Fi connection |
| N2 | Online, stable mobile data | Wi-Fi off, cellular data on |
| N3 | Fully offline | Airplane mode |
| N4 | Slow network | OS network-conditioner / throttling tool, or a known-slow test AP |
| N5 | Intermittent connection | Toggle Wi-Fi/airplane mode repeatedly during an operation |
| N6 | Wi-Fi → mobile transition | Start operation on Wi-Fi, disable Wi-Fi mid-operation so device falls to cellular |
| N7 | Backend unavailable | Point test build at a backend instance that is stopped/unreachable (never point a real build at production for this) |
| N8 | Response lost (request sent, response never arrives) | Backend instance configured to accept and drop, or a proxy that black-holes responses after the request lands |
| N9 | Reconnect after extended offline | Airplane mode held for a duration exceeding the sync retry/backoff window, then restored |

## Flows to cross against every condition

- Enrollment (UAT-ENR-*)
- Screen-time sync / parent override (UAT-ST-*, UAT-PDASH-*)
- Ask Parent / web review request-response (UAT-WEB-02, UAT-WEB-03)
- Location updates (UAT-LOC-*)
- Schedule push from parent to child (UAT-SCH-03)
- Delete/export request (UAT-DEL-*)
- Recovery flow (UAT-REC-*)

## Required properties under every condition

1. The UI never shows a false "synced" / "up to date" state while data is
   actually stale or unsent.
2. No operation silently loses data — it either applies, is queued with a
   visible pending state, or is reported as failed.
3. No operation double-applies when connectivity flaps mid-retry.
3. Local protections (screen-time, Break Shield, web filtering) keep
   enforcing from last-known-good policy while offline; they do not fail
   open.
4. Reconnect (N9) reconciles queued state without resurrecting
   retention-deleted data or replaying an already-applied action.

## Status

**NOT EXECUTED.** This matrix, like `UAT_TEST_PLAN.md`, is a plan only.
