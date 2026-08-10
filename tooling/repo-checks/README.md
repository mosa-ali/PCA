# Repository checks

Run deterministic PCA-0 repository checks with:

```powershell
pwsh -NoProfile -File tooling/repo-checks/Invoke-RepositoryChecks.ps1
```

The check fails for tracked IDE/build artifacts, common credential artifacts,
recognisable secret formats, unexpected top-level paths, missing foundation
layout, or whitespace errors reported by Git. It scans tracked files only and
does not transmit repository content.
