[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string] $Message) {
  Write-Error "PCA bootstrap check failed: $Message"
  exit 1
}

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\\..')).Path
if (-not (Test-Path (Join-Path $RepositoryRoot '.git'))) {
  Fail "expected a Git worktree at $RepositoryRoot"
}

try {
  $GitVersion = (& git --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($GitVersion)) { throw 'git command failed' }
} catch {
  Fail 'Git must be installed and available on PATH.'
}

$Branch = (& git -C $RepositoryRoot branch --show-current 2>&1 | Out-String).Trim()
if ([string]::IsNullOrWhiteSpace($Branch)) {
  Fail 'detached HEAD is not a supported developer setup; switch to a named branch.'
}

Write-Host "Repository: $RepositoryRoot"
Write-Host "Branch: $Branch"
Write-Host "Git: $GitVersion"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"

foreach ($OptionalCommand in @('java', 'docker')) {
  if (Get-Command $OptionalCommand -ErrorAction SilentlyContinue) {
    Write-Host "${OptionalCommand}: available"
  } else {
    Write-Host "${OptionalCommand}: not installed (not required until its owned workspace is added)"
  }
}

Write-Host 'PCA bootstrap environment check passed.'
