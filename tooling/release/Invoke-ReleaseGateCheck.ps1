<#
.SYNOPSIS
  PCA release gate (PCA-19). Fails closed. See docs/release_readiness/RELEASE_GATE.md.

.DESCRIPTION
  A release candidate is NOT releasable while PRODUCTION_CRYPTO_SUITE =
  PENDING_HUMAN_SECURITY_REVIEW or REAL_UAT = NOT_EXECUTED remain, for any
  targeted production capability that depends on them. This script derives
  both conditions honestly:

    - PRODUCTION_CRYPTO_SUITE is derived from source (backend/src/main.ts):
      if RejectingDeviceSignatureVerifier or RejectingEnvelopeSignatureVerifier
      is still wired there, the suite is PENDING_HUMAN_SECURITY_REVIEW. This
      cannot be overridden by a flag -- only replacing the wiring with a
      reviewed verifier changes this script's answer.
    - REAL_UAT is read from docs/release_readiness/uat_execution_log.json's
      "status" field, which only a human tester/owner may change away from
      NOT_EXECUTED, after real on-device execution.

  It also fails the gate if any external gate in
  docs/release_readiness/external_gate_matrix.json relevant to the release
  scope is not CLOSED.

  This script must never be edited to make it report READY without the
  underlying condition actually changing. Its job is to tell the truth.

.PARAMETER RepositoryRoot
  Repository root. Defaults to the repo containing this script.

.PARAMETER IgnoreExternalGates
  For informational/local use only (e.g. checking crypto+UAT state alone).
  Does NOT make a real release candidate releasable -- external gates are
  still required for any real production promotion. Never pass this flag
  in a CI/release-promotion context.
#>
[CmdletBinding()]
param(
  [string] $RepositoryRoot = (Join-Path $PSScriptRoot '..\\..'),
  [switch] $IgnoreExternalGates
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path $RepositoryRoot).Path
$Failures = [System.Collections.Generic.List[string]]::new()

# --- 1. PRODUCTION_CRYPTO_SUITE, derived from source -----------------------
$MainTsPath = Join-Path $RepositoryRoot 'backend\src\main.ts'
if (-not (Test-Path -LiteralPath $MainTsPath)) {
  throw "Cannot evaluate PRODUCTION_CRYPTO_SUITE: $MainTsPath not found."
}
$MainTsContent = Get-Content -LiteralPath $MainTsPath -Raw
$UsesRejectingDeviceVerifier = $MainTsContent -match 'new RejectingDeviceSignatureVerifier\(\)'
$UsesRejectingEnvelopeVerifier = $MainTsContent -match 'new RejectingEnvelopeSignatureVerifier\(\)'

if ($UsesRejectingDeviceVerifier -or $UsesRejectingEnvelopeVerifier) {
  $CryptoSuiteState = 'PENDING_HUMAN_SECURITY_REVIEW'
  $Failures.Add('PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW (Rejecting verifier(s) still wired in backend/src/main.ts; device-session issuance and/or inbound envelope acceptance are non-functional by design).')
} else {
  # The rejecting verifiers are gone from main.ts. This script does NOT
  # assume that means a reviewed verifier is in place -- it only means the
  # cheap, source-derivable signal this script checks no longer applies.
  # A real release decision still requires confirming an actual reviewed
  # implementation replaced them (see docs/security/production-crypto-review/).
  $CryptoSuiteState = 'NOT_DETECTED_AS_PENDING (verify actual reviewed-implementation evidence manually before trusting this)'
}

# --- 2. REAL_UAT, from the human-maintained execution log ------------------
$UatLogPath = Join-Path $RepositoryRoot 'docs\release_readiness\uat_execution_log.json'
if (-not (Test-Path -LiteralPath $UatLogPath)) {
  throw "Cannot evaluate REAL_UAT: $UatLogPath not found."
}
$UatLog = Get-Content -LiteralPath $UatLogPath -Raw | ConvertFrom-Json
$RealUatState = $UatLog.status
if ($RealUatState -ne 'COMPLETE') {
  $Failures.Add("REAL_UAT = $RealUatState (docs/release_readiness/uat_execution_log.json status must be COMPLETE with a recorded go/no-go decision; cases logged: $($UatLog.casesLogged) of $($UatLog.totalCasesInPlan)).")
}

# --- 3. External gate matrix ------------------------------------------------
$ExternalGateState = @()
if (-not $IgnoreExternalGates) {
  $GateMatrixPath = Join-Path $RepositoryRoot 'docs\release_readiness\external_gate_matrix.json'
  if (-not (Test-Path -LiteralPath $GateMatrixPath)) {
    throw "Cannot evaluate external gates: $GateMatrixPath not found."
  }
  $GateMatrix = Get-Content -LiteralPath $GateMatrixPath -Raw | ConvertFrom-Json
  foreach ($Gate in $GateMatrix.gates) {
    $ExternalGateState += [PSCustomObject]@{ id = $Gate.id; status = $Gate.status }
    if ($Gate.status -ne 'CLOSED') {
      $Failures.Add("External gate $($Gate.id) is $($Gate.status) (owner: $($Gate.owner)).")
    }
  }
} else {
  Write-Warning 'IgnoreExternalGates set: external gate matrix was NOT checked. This result is not a real release readiness verdict.'
}

# --- Verdict -----------------------------------------------------------------
Write-Host ''
Write-Host '=== PCA Release Gate ==='
Write-Host "PRODUCTION_CRYPTO_SUITE: $CryptoSuiteState"
Write-Host "REAL_UAT: $RealUatState ($($UatLog.casesLogged)/$($UatLog.totalCasesInPlan) cases logged)"
if (-not $IgnoreExternalGates) {
  foreach ($g in $ExternalGateState) { Write-Host "External gate $($g.id): $($g.status)" }
}
Write-Host ''

if ($Failures.Count -gt 0) {
  Write-Host 'VERDICT: NOT READY' -ForegroundColor Red
  foreach ($f in $Failures) { Write-Host "  - $f" -ForegroundColor Red }
  exit 1
}

Write-Host 'VERDICT: READY' -ForegroundColor Green
exit 0
