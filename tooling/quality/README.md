# PCA deterministic quality checks

Run `pwsh -File tooling/quality/Invoke-QualityChecks.ps1` from the repository root. It verifies the synthetic-fixture boundary, runs the cross-repository security checks, and rejects whitespace errors. The checks inspect tracked files only, so they are deterministic and do not upload project data.

Run `pwsh -File tooling/security/Invoke-SecurityChecks.ps1 -EmitDependencyInventory` to print a tracked-manifest hash inventory suitable for an SBOM/dependency-review input. It does not resolve, download, or transmit dependencies.

Run `pwsh -File tooling/quality/Invoke-QualityToolingTests.ps1` to execute six isolated, temporary-Git-repository negative tests. The test creates and removes its own system temporary directories; it never adds fixture secrets to this repository.
