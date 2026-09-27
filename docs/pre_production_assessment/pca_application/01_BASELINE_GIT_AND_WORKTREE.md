# 01 — Baseline: Git truth & worktree state

Evidence labels: `[READ]` source read this session; `[RECORDED]` from the
interrupted run's session record; `[BLOCKED]` needs a terminal (not available
in this session).

## 1. Repository identity

- Branch: `pca-dev` (`[READ]` `.git/HEAD` -> `ref: refs/heads/pca-dev`).
- Local HEAD: `9496fb19dc29217b4e515305fe68ab70a48981e1`
  (`[READ]` `.git/refs/heads/pca-dev`).
- `origin/pca-dev`: **same SHA** `9496fb19…` (`[READ]`
  `.git/refs/remotes/origin/pca-dev`) — local and remote refs are equal.
- HEAD subject: `fix(platform-admin): restore family-scoped enrollment lookup`,
  authored 2026-09-25 21:46 +0300 (`[READ]` `.git/logs/HEAD`, last entry).
- Reflog shows routine `reset: moving to origin/pca-dev` hygiene; the newest
  commits before HEAD are CI/hygiene commits (`a66a9e73`, `d3759d89`) and,
  shortly before, the parent-MFA programme (`a9689211` "Replace Parent Genesis
  with TOTP MFA", `f66e0e28`, `2ad25a28`) (`[READ]` `.git/logs/HEAD`).

## 2. Worktree state (at assessment time)

- `[RECORDED]` ~123 dirty entries, **all under `backend/`, `parent-web/`,
  `platform-admin-web/`** — another lane's active work. `android/` and `ios/`
  had **no** modifications, i.e. the mobile trees are clean.
- `[BLOCKED]` Re-verify with:
  `git status --short | Out-String` and
  `git diff --name-only -- android ios` (expect empty).

## 3. Mobile recency vs HEAD

- `[RECORDED]` Last commit touching `android/`: `2aec6fdc`, 2026-09-19
  22:40 +0300. Last commit touching `ios/`: same day range (Sept 18–19).
- Consequence: the mobile source trees are **~1 week frozen** while HEAD moved
  through the parent-MFA, platform-admin and CI programmes. Anything fixed in
  `backend/` since 2026-09-19 has **not** been exercised against mobile code
  except through CI (which is source-level only, see report 11).
- `[BLOCKED]` Re-verify with:
  `git log -1 --format='%H %ci %s' -- android/` and the same for `ios/`.

## 4. CI at HEAD

- `[RECORDED]` Quality-gates run `36193353496` at HEAD `9496fb19`:
  **SUCCESS, 27/27 jobs**, including
  `Android build, lint, and unit tests` and `iOS build and unit tests`.
- `[RECORDED]` The mobile-device UAT workflow last succeeded 2026-09-19 on
  `7f62afb9` (not HEAD); the physical-Android job has **never executed**.
- `[BLOCKED]` Re-verify with:
  `gh run view 36193353496 --json conclusion,jobs` and
  `gh run list --workflow=mobile-device-uat.yml --limit 10`.

## 5. Consequences for this assessment

1. Every `path:line` citation in this report set refers to `9496fb19` (mobile
   trees unchanged since 2026-09-19, so citations remain valid even if HEAD
   advances without touching mobile).
2. CI-green at HEAD does **not** mean "runnable product": the CI jobs build and
   unit-test unsigned artifacts on simulators/emulators only (report 11).
3. The dirty non-mobile worktree is out of scope and was not inspected.
