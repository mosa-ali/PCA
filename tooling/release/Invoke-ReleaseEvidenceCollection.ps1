<#
.SYNOPSIS
  Collects reproducible PCA release evidence (PCA-18/19). See
  docs/release_readiness/RELEASE_EVIDENCE.md.

.DESCRIPTION
  Captures, from the actual repository/environment state -- never invented
  numbers:
    - git SHA, branch, dirty state
    - dependency audits: backend, parent-web, each parent-sdk package
    - backend unit test count (npm test)
    - backend DB clean-room test count (npm run test:db), if -RunDbTests
      and PCA_DATABASE_URL is set / a local MySQL is reachable
    - Android JVM unit test count (gradlew testDebugUnitTest), if -RunAndroid
    - Parent Web test count (npm test)
    - PRODUCTION_CRYPTO_SUITE / REAL_UAT / external gate matrix state, via
      Invoke-ReleaseGateCheck.ps1

  Any step that is skipped or fails is recorded as such in the evidence
  pack -- it is never silently omitted or backfilled with a guess.

  Steps run sequentially with visible progress (not one silent blocking
  call) so interim state is always observable.

.PARAMETER RunDbTests
  Also run backend DB clean-room tests. Requires PCA_DATABASE_URL to point
  at a reachable MySQL 8.4 instance (see backend/compose.yaml). This is
  destructive to that database (it is reset).

.PARAMETER RunAndroid
  Also run Android JVM unit tests (gradlew testDebugUnitTest). Requires
  ANDROID_HOME/ANDROID_SDK_ROOT to be configured. This does NOT run
  instrumented/androidTest (needs an emulator/device) and is not real-device
  UAT.

.PARAMETER OutputDirectory
  Where to write the timestamped JSON evidence pack. Defaults to
  docs/release_readiness/evidence.
#>
[CmdletBinding()]
param(
  [string] $RepositoryRoot = (Join-Path $PSScriptRoot '..\\..'),
  [switch] $RunDbTests,
  [switch] $RunAndroid,
  [string] $OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path $RepositoryRoot).Path
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $RepositoryRoot 'docs\release_readiness\evidence'
}
if (-not (Test-Path -LiteralPath $OutputDirectory)) {
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
}

function Write-Step([string] $Message) {
  Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Invoke-CapturedNpm {
  param([string] $WorkingDirectory, [string[]] $NpmArgs, [string] $Label)
  Write-Step $Label
  Push-Location $WorkingDirectory
  try {
    $Output = & npm @NpmArgs 2>&1 | Out-String
    $ExitCode = $LASTEXITCODE
    Write-Host $Output
    return [PSCustomObject]@{ label = $Label; exitCode = $ExitCode; output = $Output }
  } finally {
    Pop-Location
  }
}

$Evidence = [ordered]@{
  generatedUtc     = (Get-Date).ToUniversalTime().ToString('o')
  repositoryRoot   = $RepositoryRoot
  git              = $null
  releaseGate      = $null
  dependencyAudits = [ordered]@{}
  testCounts       = [ordered]@{}
  notes            = [System.Collections.Generic.List[string]]::new()
}

# --- Git identity ------------------------------------------------------------
Write-Step 'Git identity'
Push-Location $RepositoryRoot
try {
  $Sha = (git rev-parse HEAD).Trim()
  $Branch = (git rev-parse --abbrev-ref HEAD).Trim()
  $Status = (git status --porcelain)
  $Dirty = [bool]$Status
  $Evidence.git = [ordered]@{
    sha    = $Sha
    branch = $Branch
    dirty  = $Dirty
    dirtyFileCount = ($Status | Measure-Object).Count
  }
  Write-Host "SHA: $Sha  Branch: $Branch  Dirty: $Dirty"
} finally {
  Pop-Location
}

# --- Release gate (crypto / UAT / external gates) ----------------------------
Write-Step 'Release gate check'
$GateScript = Join-Path $RepositoryRoot 'tooling\release\Invoke-ReleaseGateCheck.ps1'
$GateOutput = & pwsh -File $GateScript 2>&1 | Out-String
$GateExit = $LASTEXITCODE
Write-Host $GateOutput
$Evidence.releaseGate = [ordered]@{
  exitCode = $GateExit
  ready    = ($GateExit -eq 0)
  output   = $GateOutput
}

# --- Dependency audits ---------------------------------------------------------
$AuditTargets = @(
  @{ Name = 'backend'; Path = 'backend' },
  @{ Name = 'parent-web'; Path = 'parent-web' },
  @{ Name = 'parent-sdk/browser-runtime'; Path = 'parent-sdk\browser-runtime' },
  @{ Name = 'parent-sdk/runtime-sync'; Path = 'parent-sdk\runtime-sync' },
  @{ Name = 'parent-sdk/wellbeing-control'; Path = 'parent-sdk\wellbeing-control' }
)
foreach ($Target in $AuditTargets) {
  $FullPath = Join-Path $RepositoryRoot $Target.Path
  if (-not (Test-Path -LiteralPath (Join-Path $FullPath 'package.json'))) {
    $Evidence.notes.Add("No package.json at $($Target.Path); skipped audit.")
    continue
  }
  $Result = Invoke-CapturedNpm -WorkingDirectory $FullPath -NpmArgs @('audit', '--json') -Label "npm audit: $($Target.Name)"
  try {
    $Parsed = $Result.output | ConvertFrom-Json
    $VulnCounts = $Parsed.metadata.vulnerabilities
  } catch {
    $VulnCounts = $null
    $Evidence.notes.Add("Could not parse npm audit JSON for $($Target.Name); raw output retained.")
  }
  $Evidence.dependencyAudits[$Target.Name] = [ordered]@{
    exitCode        = $Result.exitCode
    vulnerabilities = $VulnCounts
  }
}

# --- Backend unit tests --------------------------------------------------------
function Get-SummedTapCounts([string] $Output) {
  # The backend "test" script chains several separate node invocations
  # (a couple of plain node:test scripts, then one big `node --test ...`
  # covering most files) -- EACH prints its own independent TAP summary
  # block ("# tests N / # pass N / # fail N"), not one cumulative total.
  # Taking only the first or last block silently undercounts, so every
  # block found in the combined output is summed here.
  $TestsTotal = 0; $PassTotal = 0; $FailTotal = 0; $BlockCount = 0
  $TestMatches = [regex]::Matches($Output, '# tests (\d+)')
  $PassMatches = [regex]::Matches($Output, '# pass (\d+)')
  $FailMatches = [regex]::Matches($Output, '# fail (\d+)')
  foreach ($m in $TestMatches) { $TestsTotal += [int]$m.Groups[1].Value; $BlockCount++ }
  foreach ($m in $PassMatches) { $PassTotal += [int]$m.Groups[1].Value }
  foreach ($m in $FailMatches) { $FailTotal += [int]$m.Groups[1].Value }
  return [ordered]@{ tests = $TestsTotal; pass = $PassTotal; fail = $FailTotal; tapBlocks = $BlockCount }
}

$BackendPath = Join-Path $RepositoryRoot 'backend'
$BackendTest = Invoke-CapturedNpm -WorkingDirectory $BackendPath -NpmArgs @('run', 'test') -Label 'Backend unit tests (npm test)'
$BackendCounts = Get-SummedTapCounts -Output $BackendTest.output
if ($BackendCounts.tapBlocks -gt 0) {
  $BackendCounts.exitCode = $BackendTest.exitCode
  $Evidence.testCounts.backendUnit = $BackendCounts
} else {
  $Evidence.testCounts.backendUnit = [ordered]@{ parsed = $false; exitCode = $BackendTest.exitCode }
  $Evidence.notes.Add('Could not parse backend unit test counts from output; see evidence pack raw output separately if needed.')
}

# --- Backend DB clean-room tests -----------------------------------------------
if ($RunDbTests) {
  if (-not $env:PCA_DATABASE_URL) {
    $Evidence.testCounts.backendDb = [ordered]@{ skipped = $true; reason = 'PCA_DATABASE_URL not set' }
    $Evidence.notes.Add('DB clean-room tests requested but PCA_DATABASE_URL was not set; skipped.')
  } else {
    Write-Step 'Backend DB clean-room: reset test database'
    Push-Location $BackendPath
    try {
      # Reset ONLY -- do not also run db:migrate here. `npm run test:db`
      # invokes scripts/verify-mysql.mjs, which applies every migration
      # itself as part of the clean-room gate; pre-migrating first makes
      # that script's own migration pass fail with "schema_migrations
      # already exists" (found and fixed while validating this script).
      & npm run db:reset:test 2>&1 | Out-String | Write-Host
    } finally {
      Pop-Location
    }
    $DbTest = Invoke-CapturedNpm -WorkingDirectory $BackendPath -NpmArgs @('run', 'test:db') -Label 'Backend DB clean-room tests (npm run test:db)'
    $DbCounts = Get-SummedTapCounts -Output $DbTest.output
    if ($DbCounts.tapBlocks -gt 0) {
      $DbCounts.exitCode = $DbTest.exitCode
      $Evidence.testCounts.backendDb = $DbCounts
    } else {
      $Evidence.testCounts.backendDb = [ordered]@{ parsed = $false; exitCode = $DbTest.exitCode }
      $Evidence.notes.Add('Could not parse backend DB test counts from output.')
    }
  }
} else {
  $Evidence.testCounts.backendDb = [ordered]@{ skipped = $true; reason = '-RunDbTests not passed' }
}

# --- Parent Web tests ------------------------------------------------------------
$ParentWebPath = Join-Path $RepositoryRoot 'parent-web'
$ParentWebTest = Invoke-CapturedNpm -WorkingDirectory $ParentWebPath -NpmArgs @('run', 'test') -Label 'Parent Web tests (npm test)'
if ($ParentWebTest.output -match 'Test Files\s+(?:(\d+) failed \| )?(\d+) passed.*?\n\s*Tests\s+(?:(\d+) failed \| )?(\d+) passed') {
  $Evidence.testCounts.parentWeb = [ordered]@{
    testFilesFailed = if ($Matches[1]) { [int]$Matches[1] } else { 0 }
    testFilesPassed = [int]$Matches[2]
    testsFailed     = if ($Matches[3]) { [int]$Matches[3] } else { 0 }
    testsPassed     = [int]$Matches[4]
    exitCode        = $ParentWebTest.exitCode
  }
} else {
  $Evidence.testCounts.parentWeb = [ordered]@{ parsed = $false; exitCode = $ParentWebTest.exitCode }
  $Evidence.notes.Add('Could not parse parent-web test counts from output. NOTE: parent-web depends on parent-sdk workspace packages being built first (npm run build in each parent-sdk/* package) or module resolution fails.')
}

# --- Android JVM unit tests --------------------------------------------------
if ($RunAndroid) {
  $AndroidPath = Join-Path $RepositoryRoot 'android'
  if (-not (Test-Path -LiteralPath (Join-Path $AndroidPath 'gradlew.bat'))) {
    $Evidence.testCounts.android = [ordered]@{ skipped = $true; reason = 'gradlew.bat not found' }
  } else {
    Write-Step 'Android JVM unit tests (gradlew testDebugUnitTest)'
    Push-Location $AndroidPath
    try {
      & .\gradlew.bat testDebugUnitTest --console=plain 2>&1 | Out-String | Write-Host
      $GradleExit = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    $ResultsDir = Join-Path $AndroidPath 'app\build\test-results\testDebugUnitTest'
    if (Test-Path -LiteralPath $ResultsDir) {
      $XmlFiles = Get-ChildItem -LiteralPath $ResultsDir -Filter '*.xml'
      $Tests = 0; $Failures = 0; $Errors = 0; $Skipped = 0
      foreach ($XmlFile in $XmlFiles) {
        [xml]$Xml = Get-Content -LiteralPath $XmlFile.FullName
        $Tests += [int]$Xml.testsuite.tests
        $Failures += [int]$Xml.testsuite.failures
        $Errors += [int]$Xml.testsuite.errors
        $Skipped += [int]$Xml.testsuite.skipped
      }
      $Evidence.testCounts.android = [ordered]@{
        suiteFiles = $XmlFiles.Count
        tests      = $Tests
        failures   = $Failures
        errors     = $Errors
        skipped    = $Skipped
        gradleExitCode = $GradleExit
        scope      = 'JVM unit tests only (testDebugUnitTest) -- NOT instrumented/androidTest, NOT real-device UAT'
      }
    } else {
      $Evidence.testCounts.android = [ordered]@{ parsed = $false; gradleExitCode = $GradleExit }
      $Evidence.notes.Add('Android test-results directory not found after gradlew run.')
    }
  }
} else {
  $Evidence.testCounts.android = [ordered]@{ skipped = $true; reason = '-RunAndroid not passed' }
}

$Evidence.notes.Add('Android instrumented tests (androidTest/) and real-device UAT (docs/release_readiness/UAT_TEST_PLAN.md) are NOT covered by this script and require physical/emulated hardware and, for UAT, a human tester.')
$Evidence.notes.Add('iOS has no automated evidence path in this environment (no macOS/Xcode) -- see EXTERNAL_GATE_MATRIX.md IOS_MAC_XCODE.')

# --- Write evidence pack ------------------------------------------------------
$Timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$OutFile = Join-Path $OutputDirectory "evidence-$Timestamp.json"
$Evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutFile -Encoding utf8
Write-Host "`nEvidence pack written: $OutFile" -ForegroundColor Green

$LatestFile = Join-Path $OutputDirectory 'latest.json'
Copy-Item -LiteralPath $OutFile -Destination $LatestFile -Force
Write-Host "Latest pointer updated: $LatestFile" -ForegroundColor Green
