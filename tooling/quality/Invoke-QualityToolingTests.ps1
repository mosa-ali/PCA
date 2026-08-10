[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\\..')).Path
$SecurityCheck = Join-Path $RepositoryRoot 'tooling/security/Invoke-SecurityChecks.ps1'
$PowerShell = (Get-Command pwsh -ErrorAction Stop).Source

function Assert-Rejected([string] $Name, [string] $RelativePath, [string] $Content) {
  $TemporaryRepository = Join-Path ([System.IO.Path]::GetTempPath()) ("pca-security-test-" + [guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Path $TemporaryRepository | Out-Null
    & git -C $TemporaryRepository init --quiet
    if ($LASTEXITCODE -ne 0) { throw "Unable to initialise test repository for $Name." }
    $Target = Join-Path $TemporaryRepository $RelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $Target -Parent) | Out-Null
    [System.IO.File]::WriteAllText($Target, $Content, [System.Text.UTF8Encoding]::new($false))
    & git -C $TemporaryRepository add -- $RelativePath
    if ($LASTEXITCODE -ne 0) { throw "Unable to stage test input for $Name." }
    & $PowerShell -NoProfile -File $SecurityCheck -RepositoryRoot $TemporaryRepository *> $null
    if ($LASTEXITCODE -eq 0) { throw "Negative security test was accepted: $Name" }
  }
  finally {
    if (Test-Path -LiteralPath $TemporaryRepository) {
      Remove-Item -LiteralPath $TemporaryRepository -Recurse -Force
    }
  }
}

Assert-Rejected 'secret-like value' 'src/config.txt' 'api_key = "AbcdefghijklmnopQRSTUV"'
Assert-Rejected 'private recovery secret' 'src/config.txt' 'recovery_secret = "not-a-real-recovery-secret"'
Assert-Rejected 'telemetry SDK' 'android/app/build.gradle.kts' 'implementation("io.sentry:sentry:8.0.0")'
Assert-Rejected 'generated IDE artifact' '.idea/workspace.xml' '<workspace />'
Assert-Rejected 'sensitive logging' 'android/App.kt' 'Log.d("PCA", "url=https://PCA-SYNTHETIC.invalid")'
Assert-Rejected 'escaped privacy sentinel' 'contracts/example.json' '{"value":"PCA_SYNTHETIC_RECOVERY_SECRET"}'
Assert-Rejected 'escaped Android privacy sentinel' 'android/src/main/kotlin/App.kt' 'val marker = "PCA_SYNTHETIC_APP_USAGE_EVENT"'
Assert-Rejected 'escaped iOS privacy sentinel' 'ios/App.swift' 'let marker = "PCA_SYNTHETIC_YOUTUBE_VIDEO_ID"'

Write-Host 'PCA quality/security negative tests passed (8 rejection controls verified).'
