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

# Projects a source line down to its CODE, discarding the *content* of constant
# string literals while KEEPING template-literal ${...} interpolations.
#
# Why this exists: a sensitive word inside a fixed message string ("Usage: ...",
# "=== PRODUCTION_DEMO_MODE_GATE (parent-web) ===", "PARENT_CONSOLE_ERRORS=") is a
# constant. A constant cannot carry a runtime value, so it cannot leak one. Only a
# sensitive word in a *value* position -- an identifier, a property access, or a
# ${} interpolation -- is evidence of a logged value. Matching the raw line
# conflated the two and produced false failures on three files that log nothing
# sensitive at all, while adding nothing to real detection.
#
# Called only for lines that already matched the cheap whole-file pattern below,
# so its per-character cost is paid on a handful of lines, not on every tracked file.
function Get-CodeProjection([string] $Line) {
  $Builder = [System.Text.StringBuilder]::new()
  $Index = 0
  while ($Index -lt $Line.Length) {
    $Char = $Line[$Index]
    if ($Char -eq "'" -or $Char -eq '"') {
      $Quote = $Char
      [void]$Builder.Append($Quote)
      $Index++
      while ($Index -lt $Line.Length -and $Line[$Index] -ne $Quote) {
        if ($Line[$Index] -eq '\') { $Index++ }
        $Index++
      }
      [void]$Builder.Append($Quote)
      $Index++
      continue
    }
    if ($Char -eq '`') {
      [void]$Builder.Append('`')
      $Index++
      while ($Index -lt $Line.Length -and $Line[$Index] -ne '`') {
        if ($Line[$Index] -eq '\') { $Index += 2; continue }
        if ($Line[$Index] -eq '$' -and ($Index + 1) -lt $Line.Length -and $Line[$Index + 1] -eq '{') {
          $Depth = 0
          while ($Index -lt $Line.Length) {
            [void]$Builder.Append($Line[$Index])
            if ($Line[$Index] -eq '{') { $Depth++ }
            elseif ($Line[$Index] -eq '}') { $Depth--; if ($Depth -le 0) { $Index++; break } }
            $Index++
          }
          continue
        }
        $Index++
      }
      [void]$Builder.Append('`')
      $Index++
      continue
    }
    [void]$Builder.Append($Char)
    $Index++
  }
  return $Builder.ToString()
}

# TRUE only when a credential-shaped literal is provably NOT a credential.
# Two independent signals must BOTH hold, so this cannot be defeated by naming a
# real secret "test":
#   (1) the value self-declares as non-production material, AND
#   (2) it carries none of the entropy every real credential has -- no unbroken
#       12+ character alphanumeric run.
# 'unit-test-secret' and 'sandbox-only-test-signing-secret-do-not-use-in-production'
# satisfy both. A value like "TestSecret" glued directly to a 20-character opaque
# vendor token satisfies NEITHER -- "Test" is not delimited, and the token is one
# unbroken 20-character run -- so naming a real credential "test" does not hide it.
# (Deliberately described rather than shown: a literal example of such a token here
# would itself trip tooling/repo-checks/Invoke-RepositoryChecks.ps1, which scans this
# file for vendor-token shapes and, correctly, grants it no exemption.)
function Test-IsDeclaredNonSecret([string] $Value) {
  $SelfDeclared =
    ($Value -match '(?i)(?:^|[-_.])(?:test|tests|testing|sandbox|dummy|fake|sample|example|placeholder|changeme|synthetic|marker|unused)(?:$|[-_.])') -or
    ($Value -match '(?i)(?:do[-_]?not[-_]?use|not[-_]?a[-_]?secret|for[-_]?testing)')
  if (-not $SelfDeclared) { return $false }
  return -not ($Value -match '[A-Za-z0-9]{12,}')
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
# Fixed vendor-token shapes. These are unambiguous on their own -- no refinement.
$SecretPatterns = @(
  '(?i)-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
  '(?i)AKIA[0-9A-Z]{16}',
  '(?i)gh[pousr]_[A-Za-z0-9_]{20,}',
  '(?i)xox[baprs]-[A-Za-z0-9-]{20,}',
  '(?i)sk_(?:live|test)_[A-Za-z0-9]{16,}'
)
# Assignment-shaped credential literals are handled separately from the fixed shapes
# above because this is the only one that must tell a real credential from a
# self-declared placeholder (Test-IsDeclaredNonSecret). Group 2 captures the value.
# The backreference also makes the quoting strict; the previous ["'']...["''] form
# accepted a mismatched opening/closing quote.
$AssignedCredentialPattern = '(?i)(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*(["''])([A-Za-z0-9_./+=-]{16,})\1'
$RecoveryPatterns = @(
  '(?i)recovery[_ -]?(?:secret|code|key)\s*[:=]\s*["''][^"'']{8,}["'']',
  '(?i)(?:private|recovery)[_-]?(?:key|material)\s*[:=]\s*["''][^"'']{8,}["'']'
)
$TelemetryPatterns = @(
  '(?i)com\.google\.firebase', '(?i)firebase-(analytics|crashlytics|performance)',
  '(?i)(sentry|mixpanel|amplitude|posthog|datadog|newrelic|appcenter|fullstory|hotjar|logrocket)',
  # Segment.io: matched on its actual package-reference shapes (scoped npm package, or the
  # "segment-analytics"/"analytics-node" package names its docs use), not the bare word --
  # unlike the other SDK names above, "segment" is also an ordinary English word (e.g. "a
  # parent-directory segment") that legitimately appears in unrelated code/comments, so a
  # substring match on it alone is not a reliable telemetry signal.
  '(?i)(@segment/|segment-analytics|analytics-node\b)'
)
# What this check is actually for: an unapproved SDK being DEPENDED ON. A dependency
# shows up either in a dependency manifest, or in an import/require/gradle-coordinate
# /script-src reference. A bare SDK name in ordinary source is not a dependency -- the
# clearest case being backend/test/security/sdkDisclosure.test.mjs, whose whole purpose
# is asserting these SDKs are ABSENT and which therefore has to name them. Requiring a
# reference context removes that class of false failure and removes nothing real: every
# way an SDK can actually enter the build is still matched.
$DependencyManifestPathPattern = '(?i)(?:^|/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|libs\.versions\.toml|podfile(?:\.lock)?|package\.resolved|[^/]+\.podspec)$'
$TelemetryReferenceContextPattern = '(?i)(?:\b(?:import|require|from|classpath|implementation|api|compileOnly|runtimeOnly|annotationProcessor|kapt|ksp|plugin|plugins|pod|dependency|dependencies|packages)\b|\b(?:src|href)\s*=|\burl\s*\()'
# (?<![A-Za-z]) is a required word-boundary guard: without it, this pattern
# matches "print" as a mere substring of an unrelated identifier (e.g.
# "fingerprint" in a test file path list), producing false positives against
# files that contain no logging call at all.
#
# 'console\.' is listed explicitly. "console.log(" already matched incidentally via
# the Log alternative (the lookbehind permits a preceding '.'), but console.error /
# .warn / .info / .debug / .trace did not match at all -- and console.* is the only
# logging mechanism the backend and both web apps use, so those four were entirely
# uncovered.
$SensitiveLoggingCallPattern = '(?i)(?<![A-Za-z])(?:console\.|Log|logger|print|NSLog|os_log)\s*[.(]'
$SensitiveTermPattern = '(?i)(?:url|domain|search|location|youtube|usage|family|child|parent|token|secret|private.?key|recovery|fd[ek]|camera|face)'
# An aggregate COUNT of families/children is not family-sensitive data; a familyId is.
# Without this, a seed script's "{ familyCount, accountCount }" summary line reads as a
# privacy leak. The \b keeps it narrow: it suppresses "childCount", never "childCountry".
$AggregateSuffixPattern = '(?i)^(?:count|total|length|size|quantity)s?\b'
# Cheap whole-file prefilter. A file that fails this cannot contain a hit, so the
# per-line projection below never runs for it.
$SensitiveLoggingPattern = $SensitiveLoggingCallPattern + '.{0,160}' + $SensitiveTermPattern

function Get-SensitiveLoggingHit([string] $Line) {
  $Code = Get-CodeProjection $Line
  foreach ($Call in [regex]::Matches($Code, $SensitiveLoggingCallPattern)) {
    $Start = $Call.Index + $Call.Length
    if ($Start -ge $Code.Length) { continue }
    $Window = $Code.Substring($Start, [Math]::Min(160, $Code.Length - $Start))
    foreach ($Term in [regex]::Matches($Window, $SensitiveTermPattern)) {
      $Tail = $Window.Substring($Term.Index + $Term.Length)
      if ($Tail -match $AggregateSuffixPattern) { continue }
      return $Term.Value
    }
  }
  return $null
}
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

  # Tool implementations and architecture prose legitimately describe denied patterns, so these
  # paths are exempt from ALL four detectors below.
  #
  # .agent-runtime/manifests/ used to be in this list. That was wrong twice over: every one of the
  # 12 tracked files under .agent-runtime/ lives beneath manifests/, so "the rest of .agent-runtime/
  # is still scanned" (the comment that justified it) described nothing that exists -- the prefix
  # disabled secret-literal, private-key, recovery-material AND telemetry detection across 100% of
  # that tree, to silence exactly ONE file tripping exactly ONE detector. It is now scanned like any
  # other tracked path, with a single-file, single-detector exemption below instead.
  $IsPolicyOrFixture = $NormalPath -match '^(docs/|tooling/(security|quality|test-fixtures)/)'

  # Requirement-audit prose that quotes the behaviour it audits (e.g. "recorded in the family audit
  # log ... MUST trigger the parent"). Exempt from the sensitive-logging detector ONLY: this file is
  # still scanned for secret literals, private keys, recovery material and telemetry SDKs.
  $SensitiveLoggingExemptPaths = @('.agent-runtime/manifests/pca-r3-final/R3_REQUIREMENT_AUDIT.csv')

  if (-not $IsPolicyOrFixture) {
    $SecretHit = $null
    foreach ($Pattern in $SecretPatterns + $RecoveryPatterns) {
      if ($Content -match $Pattern) { $SecretHit = $Pattern; break }
    }
    if ($null -eq $SecretHit -and $Content -match $AssignedCredentialPattern) {
      # Refine per occurrence: a credential-shaped assignment whose value proves itself a
      # placeholder (see Test-IsDeclaredNonSecret) is not a finding.
      foreach ($Match in [regex]::Matches($Content, $AssignedCredentialPattern)) {
        if (-not (Test-IsDeclaredNonSecret $Match.Groups[2].Value)) { $SecretHit = $AssignedCredentialPattern; break }
      }
    }
    if ($null -ne $SecretHit) {
      Add-Failure $Failures "secret, private-key, or recovery material literal detected: $TrackedPath"
    }

    $IsDependencyManifest = $NormalPath -match $DependencyManifestPathPattern
    foreach ($Pattern in $TelemetryPatterns) {
      if ($Content -notmatch $Pattern) { continue }
      if ($IsDependencyManifest) {
        Add-Failure $Failures "unapproved telemetry, analytics, or replay SDK reference: $TrackedPath"
        break
      }
      $Referenced = $false
      foreach ($Line in ($Content -split "`r?`n")) {
        if ($Line -match $Pattern -and $Line -match $TelemetryReferenceContextPattern) { $Referenced = $true; break }
      }
      if ($Referenced) {
        Add-Failure $Failures "unapproved telemetry, analytics, or replay SDK reference: $TrackedPath"
        break
      }
    }

    if ($Content -match $SensitiveLoggingPattern -and $SensitiveLoggingExemptPaths -notcontains $NormalPath) {
      $LineNumber = 0
      foreach ($Line in ($Content -split "`r?`n")) {
        $LineNumber++
        if ($Line -notmatch $SensitiveLoggingPattern) { continue }
        $Hit = Get-SensitiveLoggingHit $Line
        if ($null -ne $Hit) {
          Add-Failure $Failures "potential prohibited sensitive logging statement (`"$Hit`" logged as a value): ${TrackedPath}:$LineNumber"
        }
      }
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
  # -ErrorAction Continue is load-bearing: this script sets $ErrorActionPreference = 'Stop', which
  # makes Write-Error terminating, so without the override only the FIRST collected failure is ever
  # emitted and the remainder are silently discarded. Every failure must be reported in one run.
  $Unique = @($Failures | Sort-Object -Unique)
  foreach ($Failure in $Unique) {
    Write-Error "PCA security check failed: $Failure" -ErrorAction Continue
  }
  Write-Host "PCA security checks FAILED: $($Unique.Count) distinct violation(s) reported above."
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
