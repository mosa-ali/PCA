# PCA developer bootstrap

Run the environment check before starting PCA-0 work:

```powershell
pwsh -NoProfile -File tooling/bootstrap/Verify-Environment.ps1
```

The check requires a Git worktree and a named branch. Java, Docker, Android SDK,
and Xcode are intentionally not required until their respective platform workspaces
are introduced. Platform-specific writers must add and run their own deterministic
prerequisite checks.
