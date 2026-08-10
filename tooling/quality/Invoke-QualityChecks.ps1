[CmdletBinding()]
param([string] $RepositoryRoot = (Join-Path $PSScriptRoot '..\\..'))

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path $RepositoryRoot).Path
$SecurityCheck = Join-Path $RepositoryRoot 'tooling/security/Invoke-SecurityChecks.ps1'
$FixturePath = Join-Path $RepositoryRoot 'tooling/test-fixtures/privacy-sentinels.json'

if (-not (Test-Path -LiteralPath $SecurityCheck)) { throw 'Missing deterministic security entrypoint.' }
if (-not (Test-Path -LiteralPath $FixturePath)) { throw 'Missing synthetic privacy sentinel fixture.' }

$Fixture = Get-Content -LiteralPath $FixturePath -Raw | ConvertFrom-Json
if ($Fixture.fixtureClass -ne 'PCA_SYNTHETIC_PRIVACY_SENTINELS_V1') { throw 'Unexpected privacy fixture class.' }
$SentinelProperties = @($Fixture.sentinels.PSObject.Properties)
if ($SentinelProperties.Count -lt 10) { throw 'Privacy fixture is incomplete.' }
foreach ($Property in $SentinelProperties) {
  $Value = [string]$Property.Value
  if ($Value -notmatch '^(?:PCA_SYNTHETIC_|PCA-SYNTHETIC\.invalid|https://PCA-SYNTHETIC\.invalid/)') {
    throw "Privacy fixture contains a non-synthetic value: $($Property.Name)"
  }
}
& $SecurityCheck -RepositoryRoot $RepositoryRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& git -C $RepositoryRoot diff --check
if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed.' }

Write-Host "PCA deterministic quality checks passed ($($SentinelProperties.Count) synthetic privacy sentinels verified)."
