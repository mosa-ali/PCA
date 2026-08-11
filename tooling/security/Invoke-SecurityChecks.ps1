[CmdletBinding()]
param(
  [string] $RepositoryRoot = (Join-Path $PSScriptRoot '..\\..'),
  [switch] $EmitDependencyInventory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Add-Failure([System.Collections.Generic.List[string]] $Failures, [string] $Message) {
  $Failures.Add($Message)
}

function Get-TextContent([string] $Path) {
  $Bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($Bytes -contains 0) { return $null }
  return [System.Text.Encoding]::UTF8.GetString($Bytes)
}

$RepositoryRoot = (Resolve-Path $RepositoryRoot).Path
if (-not (Test-Path (Join-Path $RepositoryRoot '.git'))) {
  throw "PCA security checks require a Git worktree: $RepositoryRoot"
}

$Failures = [System.Collections.Generic.List[string]]::new()
$TrackedFiles = @(& git -C $RepositoryRoot ls-files)
if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed.' }

$ForbiddenPathPatterns = @(
  '(^|/)\.vs(/|$)', '(^|/)\.idea(/|$)', '(^|/)build(/|$)',
  '(^|/)DerivedData(/|$)', '(^|/)xcuserdata(/|$)', '\.suo$',
  '\.user$', '\.keystore$', '\.jks$', '(^|/)local\.properties$'
)
$SecretPatterns = @(
  '(?i)-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
  '(?i)AKIA[0-9A-Z]{16}',
  '(?i)gh[pousr]_[A-Za-z0-9_]{20,}',
  '(?i)xox[baprs]-[A-Za-z0-9-]{20,}',
  '(?i)sk_(?:live|test)_[A-Za-z0-9]{16,}',
  '(?i)(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["''][A-Za-z0-9_./+=-]{16,}["'']'
)
$RecoveryPatterns = @(
  '(?i)recovery[_ -]?(?:secret|code|key)\s*[:=]\s*["''][^"'']{8,}["'']',
  '(?i)(?:private|recovery)[_-]?(?:key|material)\s*[:=]\s*["''][^"'']{8,}["'']'
)
$TelemetryPatterns = @(
  '(?i)com\.google\.firebase', '(?i)firebase-(analytics|crashlytics|performance)',
  '(?i)(sentry|mixpanel|amplitude|segment|posthog|datadog|newrelic|appcenter|fullstory|hotjar|logrocket)'
)
# (?<![A-Za-z]) is a required word-boundary guard: without it, this pattern
# matches "print" as a mere substring of an unrelated identifier (e.g.
# "fingerprint" in a test file path list), producing false positives against
# files that contain no logging call at all.
$SensitiveLoggingPattern = '(?i)(?<![A-Za-z])(?:Log|logger|print|NSLog|os_log)\s*[.(].{0,160}(?:url|domain|search|location|youtube|usage|family|child|parent|token|secret|private.?key|recovery|fd[ek]|camera|face)'
$SyntheticPrefix = 'PCA' + '_SYNTHETIC_'
$SyntheticSentinelPattern = [regex]::Escape($SyntheticPrefix) + '[A-Z0-9_]+'
$IntentionalSentinelLiteralPaths = @(
  'tooling/test-fixtures/privacy-sentinels.json',
  'tooling/quality/Invoke-QualityToolingTests.ps1'
)

$Inventory = [System.Collections.Generic.List[object]]::new()
foreach ($TrackedPath in $TrackedFiles) {
  $NormalPath = $TrackedPath -replace '\\', '/'
  foreach ($Pattern in $ForbiddenPathPatterns) {
    if ($NormalPath -match $Pattern) {
      Add-Failure $Failures "forbidden generated, IDE, or credential artifact: $TrackedPath"
      break
    }
  }

  $FullPath = Join-Path $RepositoryRoot $TrackedPath
  if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) { continue }
  $Content = Get-TextContent $FullPath
  if ($null -eq $Content) { continue }

  # Tool implementations and architecture prose legitimately describe denied patterns.
  $IsPolicyOrFixture = $NormalPath -match '^(docs/|tooling/(security|quality|test-fixtures)/)'
  if (-not $IsPolicyOrFixture) {
    foreach ($Pattern in $SecretPatterns + $RecoveryPatterns) {
      if ($Content -match $Pattern) {
        Add-Failure $Failures "secret, private-key, or recovery material literal detected: $TrackedPath"
        break
      }
    }
    foreach ($Pattern in $TelemetryPatterns) {
      if ($Content -match $Pattern) {
        Add-Failure $Failures "unapproved telemetry, analytics, or replay SDK reference: $TrackedPath"
        break
      }
    }
    if ($Content -match $SensitiveLoggingPattern) {
      Add-Failure $Failures "potential prohibited sensitive logging statement: $TrackedPath"
    }
  }

  if ($Content -match $SyntheticSentinelPattern -and $IntentionalSentinelLiteralPaths -notcontains $NormalPath) {
    Add-Failure $Failures "privacy sentinel escaped the explicit fixture/test-harness allowlist: $TrackedPath"
  }

  if ($NormalPath -match '(?i)(?:^|/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|build\.gradle(?:\.kts)?|libs\.versions\.toml|podfile|package\.resolved)$') {
    $Inventory.Add([PSCustomObject]@{ path = $NormalPath; sha256 = (Get-FileHash -LiteralPath $FullPath -Algorithm SHA256).Hash.ToLowerInvariant() })
  }
}

if ($Failures.Count -gt 0) {
  $Failures | Sort-Object -Unique | ForEach-Object { Write-Error "PCA security check failed: $_" }
  exit 1
}

if ($EmitDependencyInventory) {
  [PSCustomObject]@{
    inventoryVersion = 1
    generatedFrom = 'tracked dependency manifests only'
    manifests = @($Inventory | Sort-Object path)
  } | ConvertTo-Json -Depth 4
  exit 0
}

Write-Host "PCA security checks passed ($($TrackedFiles.Count) tracked files checked; $($Inventory.Count) dependency manifests inventoried)."
