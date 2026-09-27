# 13 — API Risk Register

Confirmed defects live in report 12; these are **risks** (not yet realized).
Machine-readable mirror: `api_risks.json`.

| ID | Area | Description | L | I | Rating | Evidence | Android | iOS | Mitigation | Blocks UAT | Blocks release |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-01 | Config | Production `PCA_TRUSTED_PROXY_CIDRS` value unverified; if unset, proxy trust = false and per-IP limits key on the platform hop (S8-class regression) | M | M | MEDIUM | `trustProxyConfig.ts:31-36,80-107`; prod env not readable in session | rate-limit bypass under load | same | Verify/confirm allowlist in App Service; add ops check | No | Yes (abuse) |
| R-02 | Crypto gate exit | When the PCA-DEC-020 review clears, three fixes must land *with* the verifier swap: P256 wiring, durable sessions, session revocation — otherwise UAT starts on a fragile session layer | M | H | HIGH | `main.ts:363`; report 05 §2; API-F02/F03 | session flakiness in UAT | same | Bundle as one gated implementation slice | Yes (if enabled early) | Yes |
| R-03 | Worktree | Concurrent lanes editing (`backend/src/http` 13 dirty files; dirty 162→175; unit suite 21→16 fails) — assessment/merge/CI instability; risk of fixing the wrong layer | H | M | HIGH | reports 01/10; TODO board | indirect | indirect | Freeze + green the tree before acceptance; attribute fixes per layer | No | Yes (CI) |
| R-04 | Policy relay | Ack loss/expiry: a queued envelope that expires is dropped from the inbox list; application is never confirmed (no read-back) — silent policy non-application | M | M | MEDIUM | `MySqlRelayRepository.ts:116-138`; `InboundReconnectService.ts:47`; API-F06 | policy may silently not apply | same | Add version/read-back + alerting on drops | No | Yes |
| R-05 | Scale-out | In-memory device sessions + per-process rate-limit state assume a single instance; App Service scale-out/restart breaks sessions and multiplies budgets | M | M | MEDIUM | `DeviceSessionRepository.ts:11-19`; `rateLimit.ts:25-36` | random 401s | random 401s | Durable store before scaling; document constraint | No | Yes (scale) |
| R-06 | Compatibility | No version negotiation on `/v1`; a future contract change can silently strand installed apps (store rollouts are slow-motion) | M | M | MEDIUM | API-F12; no version surface on live API | future breakage | future breakage | Add version header + min-supported gate in the same release that changes contracts | No | Yes (future) |
| R-07 | Edge headers | No HSTS / `X-Content-Type-Options` / `X-Frame-Options` observed on API responses; edge policy unverified | L | L | LOW | report 09 §2 | baseline | baseline | Confirm App Service edge header policy or add | No | No (advisory) |

Top three for the supervisor: **R-02** (gate-exit sequencing), **R-03**
(worktree stability), **R-01** (proxy config verification).
