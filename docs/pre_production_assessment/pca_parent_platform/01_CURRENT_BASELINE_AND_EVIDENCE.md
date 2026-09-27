# 01 — Current Baseline and Evidence

## 1. Git truth (2026-09-26; `git fetch origin` executed, rc=0)

```text
BRANCH              = pca-dev
LOCAL_HEAD          = 6a2cc07377afed619f00834d018b7692ee23d2d6  ("feat(platform-admin): complete commercial pricing directories")
REMOTE_PCA_DEV_HEAD = 9496fb19dc29217b4e515305fe68ab70a48981e1  ("fix(platform-admin): restore family-scoped enrollment lookup")
REMOTE_MAIN_HEAD    = d5d0d7d982d2f1be722416a377f37e1a58e5514b
LOCAL_REMOTE_EQUAL  = False
AHEAD = 1   BEHIND = 0   (left-right: 0 / 1)
WORKTREE            = DIRTY — 194 status lines (parent-web 93, backend 86, platform-admin-web 11, docs 3, .vscode 1);
                      28 untracked entries incl. migrations 0051–0054 and new identity/MFA sources
```

Recent history (newest first): `6a2cc073` → `9496fb19` → `d3759d89` → `a66a9e73` → `350d7684` →
`aaf30456` → `2bb2c7bd` → `3e1e3009` → `7d9ec543` → **`f66e0e28` "Replace Parent Genesis with TOTP MFA"**
→ `a9689211` → … Genesis-programme commits (`4446dd6a`, `2d76c947`, `2a9ffd96`, `287968a6`, `7ae4853c`,
`2cb2f6f0`) → `af3b505f` → `f62e409d` → `5909d749`.

Reading of history: the Genesis ceremony programme landed, then was **replaced by TOTP MFA**
(f66e0e28) — matching the zero genesis references found in current parent-web source AND in the
live production bundle (report 07 §4).

## 2. Evidence methodology

- No terminal tool in this session: all commands ran through a local Python kernel
  (`.agent-local-artifacts/parent-platform-final-assessment/PCA_PARENT_PLATFORM_ASSESSMENT.ipynb`,
  workbook) executing `subprocess` for git/npm/vitest and `requests`/browser MCP for live checks.
- Raw evidence: `.agent-local-artifacts/parent-platform-final-assessment/raw/` (git_truth.json,
  inventory.json, build/test outputs, contract_matched_pairs.json, live_details.json,
  domain_topology_probes.json, etc.). Not committed.
- Strictly read-only: no source, config, database, Azure, DNS or git mutation. Builds wrote only to
  gitignored `dist/` + `test-results/`.
- Prior evidence consulted: closures under `docs/supervision/` (SESSION 2B 2026-09-14,
  PRE_SESSION_3 2026-09-15), `docs/product-completion/PCA_ROUND2_CLOSURE_REPORT.md`,
  decisions/addenda (`PCA_DEC_037`, `PCA_ADDENDUM_002/003`), `docs/public/reports/*`,
  the API assessment `docs/pre_production_assessment/api/**`, and repo session memory.
- NOTE: `docs/pre_production_assessment/pca_parent` and `.../pca_platform` (the historical
  folders) are **empty**; the previous parent/platform reviews live in the supervision/
  product-completion folders above. See report 11.

## 3. Commands executed (headline results; full outputs in raw/)

| Check | Command | Result |
|---|---|---|
| Parent typecheck | `npm run typecheck` | **rc 0** |
| Parent build | `npm run build` (`VITE_PCA_API_BASE_URL=https://parent.pcasafe.com`, demo off) | **rc 0** |
| Parent lint | `npm run lint` | **rc 0** (0 warnings — warnings are fatal in this repo) |
| Parent unit suite | `npm test -- --maxWorkers=2 --testTimeout=30000` | **1063/1064** (1 load-flake; see 08) |
| Platform typecheck | `npm run typecheck` | **rc 0** |
| Platform build | `npm run build` | **rc 0** |
| Platform lint | `npm run lint` | **rc 0** |
| Platform unit suite | `npm test -- --maxWorkers=2` | **226/226 (44 files)** |
| Parent real E2E (same-day) | `playwright.real.config.ts e2e-real/realBackend.spec.ts` (test-results 2026-09-26 17:04Z) | **1/1 passed, 0 flaky** — real cookie session, HttpOnly reload persistence, guard redirect |
| Live probes | HTTPS GET/HEAD on parent/platform/api/app domains | see report 07 |

## 4. Runtime environment note

The dirty worktree is a live construction site (parent identity + optional MFA + platform
commercial lanes mid-flight); all counts in this report set describe the worktree as seen on
2026-09-26 and are labelled `[READ]` (source) / `[LIVE]` (production) / `[RUN]` (commands) /
`[RECORDED]` (prior sessions) where the distinction matters (finding PP-F03).
