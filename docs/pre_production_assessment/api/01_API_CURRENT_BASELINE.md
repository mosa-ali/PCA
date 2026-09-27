# 01 — API Current Baseline

## 1. Git truth (read-only, this session)

```text
BRANCH                = pca-dev
LOCAL_HEAD            = 6a2cc07377afed619f00834d018b7692ee23d2d6
                        ("feat(platform-admin): complete commercial pricing directories")
REMOTE_PCA_DEV_HEAD   = 9496fb19dc29217b4e515305fe68ab70a48981e1  (fetched, verified)
REMOTE_MAIN_HEAD      = d5d0d7d97f00a0a5f2b3c8b1c0e5a4a9ce0b3a44-equivalent ref
                        (refs/remotes/origin/main; fetched)
LOCAL_REMOTE_EQUAL    = False   (AHEAD = 1, BEHIND = 0 vs origin/pca-dev)
WORKTREE              = DIRTY — 162 entries at assessment start, 175 during
                        assessment (concurrent lane actively editing)
```

The worktree hosts **in-flight, uncommitted work** (Parent identity/authority
migration, platform pricing, route migrations — see
`.agent-local-artifacts/agent-channel/pca-web/PARENT_IDENTITY_AUTHORITY_MIGRATION_TODO.md`,
which records the same baseline and 151→175 dirty paths). This assessment
therefore covers *working-tree state as of 2026-09-26*, not HEAD alone;
where a fact depends on committed vs uncommitted state it is labelled.

## 2. Environment and tools

- Windows host; no interactive terminal tool in this session — all commands
  ran through the assessment notebook kernel (`.agent-local-artifacts/
  pca-api-pre-production/PCA_API_PRE_PRODUCTION_ASSESSMENT.ipynb`), whose
  outputs are the raw evidence (`raw/*.json`).
- Node/Python available; `backend/node_modules` present; MySQL not required
  (DB suites deliberately not rerun; mission §6/§25).
- Live probes: HTTPS GET/HEAD only against api.pcasafe.com (mission §8).

## 3. Source scale

- 470 backend source files; **195 server routes** scanned (registered across
  `backend/src/http/routes/**`); 33 routes identified as mobile-relevant.
- Contract matrix: 16 Android/iOS client calls → all matched (report 08).

## 4. Baseline conclusions

1. The **assessed revision** for all `path:line` citations is the current
   worktree (committed core + uncommitted in-flight changes). Mobile clients
   themselves are unchanged since ~2026-09-19.
2. Production `api.pcasafe.com` **cannot be revision-identified** from its
   responses (no version surface); the last recorded deployment identity in
   docs is the `sha256:f7897f9a…` (f62e409d-era) backend image
   (`docs/deployment/DOCKER_AZURE_SUPPORT_REVIEW.md:431`) — see report 09 §5.
3. The current worktree is **not a frozen artifact**: the unit suite alone
   changed failure counts between two runs 5 minutes apart (21 → 16; report 10
   §3). Findings were re-checked against a fresh build where attribution
   mattered (report 10 §4).
