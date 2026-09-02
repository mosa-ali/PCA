[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Add-Failure([System.Collections.Generic.List[string]] $Failures, [string] $Message) {
  $Failures.Add($Message)
}

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\\..')).Path
if (-not (Test-Path (Join-Path $RepositoryRoot '.git'))) {
  throw "PCA repository check failed: expected a Git worktree at $RepositoryRoot"
}

$Failures = [System.Collections.Generic.List[string]]::new()
$TrackedFiles = @(& git -C $RepositoryRoot ls-files)
if ($LASTEXITCODE -ne 0) { throw 'PCA repository check failed: git ls-files failed.' }

$ForbiddenPathPatterns = @(
  '(^|/)\\.vs(/|$)', '(^|/)\\.idea(/|$)', '(^|/)build(/|$)',
  '(^|/)DerivedData(/|$)', '(^|/)xcuserdata(/|$)', '\\.suo$',
  '\\.user$', '\\.keystore$', '\\.jks$', '(^|/)local\\.properties$'
)
foreach ($Path in $TrackedFiles) {
  $NormalPath = $Path -replace '\\', '/'
  foreach ($Pattern in $ForbiddenPathPatterns) {
    if ($NormalPath -match $Pattern) {
      Add-Failure $Failures "tracked generated, IDE, or credential artifact: $Path"
      break
    }
  }
}

# '.agent-runtime' is required, not merely tolerated: tooling/release/ValidateExternalGateParity.mjs
# fails unless .agent-runtime/manifests/pca-r3-final/R3_EXTERNAL_GATE_REGISTER.csv is tracked, so
# omitting it here made the release gate and this check mutually unsatisfiable.
$AllowedTopLevel = @('.agent-runtime', '.editorconfig', '.gitattributes', '.github', '.gitignore', 'README.md', 'PCA_ARCHITECTURE_MASTER_v1.0.md', 'SHA256SUMS.txt', 'CURRENT_DIRTY_PATHS.txt', 'android', 'backend', 'contracts', 'docs', 'ios', 'parent-sdk', 'parent-web', 'platform-admin-web', 'tooling')
foreach ($Path in $TrackedFiles) {
  $TopLevel = ($Path -replace '\\', '/').Split('/')[0]
  if ($AllowedTopLevel -notcontains $TopLevel) {
    Add-Failure $Failures "unexpected top-level tracked path: $Path"
  }
}

foreach ($RequiredPath in @('.editorconfig', '.gitattributes', '.gitignore', 'README.md', 'docs/architecture', 'tooling/bootstrap', 'tooling/repo-checks')) {
  if (-not (Test-Path (Join-Path $RepositoryRoot $RequiredPath))) {
    Add-Failure $Failures "required repository layout path missing: $RequiredPath"
  }
}

$SecretPatterns = @(
  '(?i)-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
  '(?i)AKIA[0-9A-Z]{16}',
  '(?i)gh[pousr]_[A-Za-z0-9_]{20,}',
  '(?i)xox[baprs]-[A-Za-z0-9-]{20,}',
  '(?i)sk_(?:live|test)_[A-Za-z0-9]{16,}'
)
foreach ($Path in $TrackedFiles) {
  $FullPath = Join-Path $RepositoryRoot $Path
  if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) { continue }
  $Bytes = [System.IO.File]::ReadAllBytes($FullPath)
  if ($Bytes -contains 0) { continue }
  $Content = [System.Text.Encoding]::UTF8.GetString($Bytes)
  foreach ($Pattern in $SecretPatterns) {
    if ($Content -match $Pattern) {
      Add-Failure $Failures "secret-like value detected in tracked file: $Path"
      break
    }
  }
}

& git -C $RepositoryRoot diff --check
if ($LASTEXITCODE -ne 0) { Add-Failure $Failures 'git diff --check reported whitespace errors.' }

if ($Failures.Count -gt 0) {
  $Failures | ForEach-Object { Write-Error "PCA repository check failed: $_" }
  exit 1
}

Write-Host "PCA repository checks passed ($($TrackedFiles.Count) tracked files checked)."
