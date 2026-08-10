# PCA security checks

`Invoke-SecurityChecks.ps1` rejects tracked IDE/build artifacts, secret-like values, private/recovery key literals, unapproved telemetry/replay SDK references, sensitive logging statements, and synthetic privacy sentinels outside `tooling/test-fixtures/`.

The checks are intentionally conservative and static. They complement—not replace—runtime outbound-payload, crash-report, and vendor configuration absence tests required by the architecture.
