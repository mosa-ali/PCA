<#
.SYNOPSIS
  PCA release gate (PCA-19). Fails closed. See docs/release_readiness/RELEASE_GATE.md.

.DESCRIPTION
  A release candidate is NOT releasable while any gate RELEVANT TO THE
  SELECTED -ReleaseTarget remains open. This script is release-scoped across
  ALL FOUR layers it evaluates (FABLE-A001/A026/A061):

    1. PRODUCTION_CRYPTO_SUITE, derived from source (backend/src/main.ts):
       if RejectingDeviceSignatureVerifier or RejectingEnvelopeSignatureVerifier
       is still wired there, the suite is PENDING_HUMAN_SECURITY_REVIEW. This
       cannot be overridden by a flag -- only replacing the wiring with a
       reviewed verifier changes this script's answer. This signal is only
       consulted for release targets it actually gates (see
       docs/supervision/PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv).
    2. REAL_UAT is read from docs/release_readiness/uat_execution_log.json's
       "cases" array, which only a human tester/owner may populate, after
       real on-device/on-dashboard execution. This script narrows the raw
       50-case plan (docs/release_readiness/UAT_TEST_PLAN.md) down to the
       subset of cases actually relevant to the selected -ReleaseTarget (a
       Public Release A UAT pass does not require an Android device UAT) --
       see the $UatCaseTargetMap table below. A target with zero relevant
       cases is vacuously satisfied; a target with relevant cases and zero of
       them logged remains genuinely blocked. This script NEVER writes to
       uat_execution_log.json -- its "status"/"cases" fields stay entirely
       human-owned; only how the SCRIPT interprets that human-owned data per
       target changes here.
    3. tooling/release/ValidateExternalGateParity.mjs and the R3 evidence/
       trust-boundary/safe-zone validators (unconditional, not release-target
       scoped -- these are structural repository-health checks).
    4. Every external gate in docs/release_readiness/external_gate_matrix.json
       relevant to -ReleaseTarget (per that gate's own "releaseScope" array)
       must be CLOSED. A gate whose releaseScope does not include the
       selected target is not evaluated at all for that target. A gate whose
       releaseScope contains a token outside the canonical release-target set
       is a corrupt/undeclared reference and fails the WHOLE script closed
       immediately (see $ValidReleaseTargets below), rather than silently
       being ignored or silently blocking everything.

  This script must never be edited to make it report READY without the
  underlying condition actually changing. Its job is to tell the truth.

.PARAMETER RepositoryRoot
  Repository root. Defaults to the repo containing this script.

.PARAMETER ReleaseTarget
  REQUIRED. Which release this evaluation is for. Must be exactly one of:
  PUBLIC_A, AUTH_B, PARENT_C, ANDROID_D, IOS_FUTURE, BILLING_FUTURE (see
  docs/supervision/PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv for what each
  target means and why each gate does or does not apply to it). Missing or
  unrecognized values FAIL CLOSED immediately, non-interactively, before any
  repository file is even read -- there is no default and no prompt.

.PARAMETER IgnoreExternalGates
  For informational/local use only (e.g. checking crypto+UAT state alone).
  Does NOT make a real release candidate releasable -- external gates are
  still required for any real production promotion. Never pass this flag
  in a CI/release-promotion context. This flag's effect is unchanged by the
  -ReleaseTarget feature: it still only skips step 4 (the external gate
  matrix loop) and always prints a warning that the result is not a real
  verdict.

.PARAMETER JsonOutPath
  Optional. When given, an additional machine-readable JSON summary of this
  run (release target, verdict, technical-vs-owner gate breakdown, full
  failures list, per-gate scoped state) is written to this path, for tooling
  and tests that would rather parse structured data than the Write-Host
  transcript. Purely additive -- omitting it changes nothing about the
  console output or the exit code.
#>
[CmdletBinding()]
param(
  [string] $RepositoryRoot = (Join-Path $PSScriptRoot '..\\..'),
  [switch] $IgnoreExternalGates,
  [string] $ReleaseTarget,
  [string] $JsonOutPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- 0. -ReleaseTarget validation, BEFORE touching any repository file ------
# Deliberately NOT a [Parameter(Mandatory)]/[ValidateSet] binding: mandatory
# parameters can prompt on some hosts if unset, and a release gate must never
# hang waiting on interactive input. A missing or unrecognized value is
# checked by hand, first, and fails closed immediately with exit 1.
$ValidReleaseTargets = @('PUBLIC_A', 'AUTH_B', 'PARENT_C', 'ANDROID_D', 'IOS_FUTURE', 'BILLING_FUTURE')
if ([string]::IsNullOrWhiteSpace($ReleaseTarget) -or ($ValidReleaseTargets -notcontains $ReleaseTarget)) {
  Write-Host ''
  Write-Host '=== PCA Release Gate ===' -ForegroundColor Red
  Write-Host 'VERDICT: NOT READY (FAIL CLOSED)' -ForegroundColor Red
  $gotValue = if ([string]::IsNullOrWhiteSpace($ReleaseTarget)) { '(not supplied)' } else { "'$ReleaseTarget'" }
  Write-Host "  - -ReleaseTarget is required and must be exactly one of: $($ValidReleaseTargets -join ', '). Got: $gotValue." -ForegroundColor Red
  Write-Host '  - This is a fail-closed validation error, not a release readiness evaluation -- no repository file was read.' -ForegroundColor Red
  if ($JsonOutPath) {
    [ordered]@{
      releaseTarget    = $ReleaseTarget
      verdict          = 'NOT_READY'
      failClosedReason = 'INVALID_OR_MISSING_RELEASE_TARGET'
      validReleaseTargets = $ValidReleaseTargets
      failures         = @("-ReleaseTarget is required and must be exactly one of: $($ValidReleaseTargets -join ', '). Got: $gotValue.")
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $JsonOutPath -Encoding utf8
  }
  exit 1
}

$RepositoryRoot = (Resolve-Path $RepositoryRoot).Path
$Failures = [System.Collections.Generic.List[string]]::new()
# Failures split into a truthful TECHNICAL_GATES_PASS vs OWNER_GATES_PENDING
# distinction (mission item 4): technical = signals this repository/CI can
# itself prove (source-derived crypto signal, scoped REAL_UAT, the parity +
# R3 evidence/trust/safe-zone validators). Owner/external = every entry in
# external_gate_matrix.json in scope for this target -- that file's own
# $schemaNote already defines every one of its gates as "BLOCKED or EXTERNAL
# by definition until an owner outside this repository-editing lane closes
# it", so the matrix itself is the natural owner/external bucket. This never
# changes the overall pass/fail exit code -- it only makes the verdict
# legible about WHICH kind of work remains, so PUBLIC_A can never misreport
# a blanket READY while owner-only gates (OWNER_VISUAL_UAT,
# PUBLIC_REPLY_IDENTITY) are still open.
$TechnicalFailures = [System.Collections.Generic.List[string]]::new()
$OwnerGatesPending = [System.Collections.Generic.List[psobject]]::new()

# --- 1. PRODUCTION_CRYPTO_SUITE, derived from source, release-scoped -------
$CryptoSuiteBlockingTargets = @('PARENT_C', 'ANDROID_D', 'IOS_FUTURE')
$MainTsPath = Join-Path $RepositoryRoot 'backend\src\main.ts'
if (-not (Test-Path -LiteralPath $MainTsPath)) {
  throw "Cannot evaluate PRODUCTION_CRYPTO_SUITE: $MainTsPath not found."
}
$MainTsContent = Get-Content -LiteralPath $MainTsPath -Raw
$UsesRejectingDeviceVerifier = $MainTsContent -match 'new RejectingDeviceSignatureVerifier\(\)'
$UsesRejectingEnvelopeVerifier = $MainTsContent -match 'new RejectingEnvelopeSignatureVerifier\(\)'

if ($UsesRejectingDeviceVerifier -or $UsesRejectingEnvelopeVerifier) {
  $CryptoSuiteState = 'PENDING_HUMAN_SECURITY_REVIEW'
  if ($CryptoSuiteBlockingTargets -contains $ReleaseTarget) {
    $msg = "PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW (Rejecting verifier(s) still wired in backend/src/main.ts; device-session issuance and/or inbound envelope acceptance are non-functional by design). Blocks $ReleaseTarget."
    $Failures.Add($msg)
    $TechnicalFailures.Add($msg)
  }
} else {
  # The rejecting verifiers are gone from main.ts. This script does NOT
  # assume that means a reviewed verifier is in place -- it only means the
  # cheap, source-derivable signal this script checks no longer applies.
  # A real release decision still requires confirming an actual reviewed
  # implementation replaced them (see docs/security/production-crypto-review/).
  $CryptoSuiteState = 'NOT_DETECTED_AS_PENDING (verify actual reviewed-implementation evidence manually before trusting this)'
}
$CryptoSuiteInScope = $CryptoSuiteBlockingTargets -contains $ReleaseTarget

# --- 2. REAL_UAT, from the human-maintained execution log, release-scoped --
# UAT_TEST_PLAN.md (read-only reference, §4) defines exactly 50 planned
# cases, organized entirely under device/dashboard categories -- confirmed
# by reading the full plan, not just headers: enrollment, process-death/
# reboot, screen-time, break shield, schedules, app usage controls,
# location, safe browser, eye protection, offline/reconnect, parent
# dashboard, delete/export/retention, recovery, tamper detection, Arabic/
# RTL. Zero cases concern the static public website or bare account
# creation/login (that narrow slice is exercised by automated tests
# elsewhere, not real-device UAT) -- so PUBLIC_A and AUTH_B are vacuously
# satisfied here, while ANDROID_D/PARENT_C, which the majority of these
# cases actually cover, remain genuinely blocked until real cases are
# logged. This map is maintained by hand alongside UAT_TEST_PLAN.md's own
# §4 case catalogue; if that plan's case list ever changes, this map must
# be updated to match (a case-count drift check below fails closed if not).
$UatCaseTargetMap = [ordered]@{
  'UAT-ENR-01'  = @('PARENT_C', 'ANDROID_D')
  'UAT-ENR-02'  = @('PARENT_C', 'ANDROID_D')
  'UAT-ENR-03'  = @('PARENT_C', 'ANDROID_D')
  'UAT-ENR-04'  = @('PARENT_C', 'ANDROID_D')
  'UAT-LIFE-01' = @('ANDROID_D')
  'UAT-LIFE-02' = @('ANDROID_D')
  'UAT-LIFE-03' = @('ANDROID_D')
  'UAT-LIFE-04' = @('ANDROID_D')
  'UAT-LIFE-05' = @('ANDROID_D')
  'UAT-ST-01'   = @('ANDROID_D')
  'UAT-ST-02'   = @('ANDROID_D')
  'UAT-ST-03'   = @('ANDROID_D')
  'UAT-ST-04'   = @('ANDROID_D')
  'UAT-ST-05'   = @('ANDROID_D', 'PARENT_C')
  'UAT-BRK-01'  = @('ANDROID_D')
  'UAT-BRK-02'  = @('ANDROID_D')
  'UAT-BRK-03'  = @('ANDROID_D')
  'UAT-SCH-01'  = @('ANDROID_D')
  'UAT-SCH-02'  = @('ANDROID_D')
  'UAT-SCH-03'  = @('ANDROID_D', 'PARENT_C')
  'UAT-APP-01'  = @('ANDROID_D')
  'UAT-APP-02'  = @('ANDROID_D', 'PARENT_C')
  'UAT-APP-03'  = @('ANDROID_D')
  'UAT-LOC-01'  = @('ANDROID_D', 'PARENT_C')
  'UAT-LOC-02'  = @('ANDROID_D')
  'UAT-LOC-03'  = @('ANDROID_D', 'PARENT_C')
  'UAT-WEB-01'  = @('ANDROID_D')
  'UAT-WEB-02'  = @('ANDROID_D', 'PARENT_C')
  'UAT-WEB-03'  = @('ANDROID_D', 'PARENT_C')
  'UAT-WEB-04'  = @('ANDROID_D')
  'UAT-EYE-01'  = @('ANDROID_D')
  'UAT-PRAY-01' = @('ANDROID_D')
  'UAT-WELL-01' = @('ANDROID_D')
  'UAT-NET-01'  = @('ANDROID_D')
  'UAT-NET-02'  = @('ANDROID_D')
  'UAT-NET-03'  = @('ANDROID_D', 'PARENT_C')
  'UAT-NET-04'  = @('ANDROID_D')
  'UAT-PDASH-01' = @('PARENT_C')
  'UAT-PDASH-02' = @('PARENT_C')
  'UAT-PDASH-03' = @('PARENT_C')
  'UAT-DEL-01'  = @('PARENT_C')
  'UAT-DEL-02'  = @('PARENT_C')
  'UAT-DEL-03'  = @('PARENT_C')
  'UAT-REC-01'  = @('PARENT_C', 'ANDROID_D')
  'UAT-REC-02'  = @('PARENT_C', 'ANDROID_D')
  'UAT-TMP-01'  = @('ANDROID_D')
  'UAT-TMP-02'  = @('ANDROID_D', 'PARENT_C')
  'UAT-I18N-01' = @('ANDROID_D')
  'UAT-I18N-02' = @('PARENT_C')
  'UAT-I18N-03' = @('ANDROID_D')
}

$UatLogPath = Join-Path $RepositoryRoot 'docs\release_readiness\uat_execution_log.json'
if (-not (Test-Path -LiteralPath $UatLogPath)) {
  throw "Cannot evaluate REAL_UAT: $UatLogPath not found."
}
$UatLog = Get-Content -LiteralPath $UatLogPath -Raw | ConvertFrom-Json
$RawUatStatus = $UatLog.status

if ($UatCaseTargetMap.Keys.Count -ne $UatLog.totalCasesInPlan) {
  throw "REAL_UAT case-to-target map drift: this script's `$UatCaseTargetMap has $($UatCaseTargetMap.Keys.Count) cases but uat_execution_log.json declares totalCasesInPlan=$($UatLog.totalCasesInPlan). Update `$UatCaseTargetMap in this script to match docs/release_readiness/UAT_TEST_PLAN.md section 4 before trusting REAL_UAT scoping again."
}

$RelevantCaseIds = @($UatCaseTargetMap.Keys | Where-Object { $UatCaseTargetMap[$_] -contains $ReleaseTarget })

$LoggedCasesById = @{}
foreach ($case in @($UatLog.cases)) {
  if ($null -eq $case) { continue }
  $caseId = $null
  foreach ($idProp in @('caseId', 'id')) {
    if ($case.PSObject.Properties.Name -contains $idProp -and $case.$idProp) { $caseId = $case.$idProp; break }
  }
  if ($caseId) { $LoggedCasesById[$caseId] = $case }
}

function Test-PcaUatCasePassed {
  param($LoggedCase)
  if ($null -eq $LoggedCase) { return $false }
  foreach ($resultProp in @('result', 'status', 'outcome')) {
    if ($LoggedCase.PSObject.Properties.Name -contains $resultProp) {
      $value = [string]$LoggedCase.$resultProp
      if ($value -match '^(?i)(PASS|PASSED)$') { return $true }
      return $false
    }
  }
  return $false
}

if ($RelevantCaseIds.Count -eq 0) {
  $RealUatState = 'NOT_APPLICABLE_TO_TARGET'
  $RealUatRelevantCount = 0
  $RealUatPassedCount = 0
} else {
  $MissingOrFailed = [System.Collections.Generic.List[string]]::new()
  $passedCount = 0
  foreach ($id in $RelevantCaseIds) {
    if (Test-PcaUatCasePassed -LoggedCase $LoggedCasesById[$id]) { $passedCount += 1 } else { $MissingOrFailed.Add($id) }
  }
  $RealUatRelevantCount = $RelevantCaseIds.Count
  $RealUatPassedCount = $passedCount
  if ($MissingOrFailed.Count -gt 0) {
    $RealUatState = 'NOT_SATISFIED_FOR_TARGET'
    $msg = "REAL_UAT (scoped to $ReleaseTarget) = NOT_SATISFIED ($passedCount of $($RelevantCaseIds.Count) relevant planned cases logged as passed; raw aggregate log status is '$RawUatStatus' with $($UatLog.casesLogged)/$($UatLog.totalCasesInPlan) cases logged overall; missing/unlogged relevant cases: $($MissingOrFailed -join ', '))."
    $Failures.Add($msg)
    $TechnicalFailures.Add($msg)
  } else {
    $RealUatState = 'SATISFIED_FOR_TARGET'
  }
}

# --- 3. External gate register/matrix parity (unconditional, not scoped) ---
$ParityScriptPath = Join-Path $RepositoryRoot 'tooling\release\ValidateExternalGateParity.mjs'
if (-not (Test-Path -LiteralPath $ParityScriptPath)) {
  throw "Cannot evaluate external gate parity: $ParityScriptPath not found."
}
$ParityOutput = & node $ParityScriptPath 2>&1
$ParityExitCode = $LASTEXITCODE
$ParityState = if ($ParityExitCode -eq 0) { 'PASS' } else { 'FAIL' }
if ($ParityExitCode -ne 0) {
  $msg = "EXTERNAL_GATE_PARITY = FAIL ($($ParityOutput -join ' '))."
  $Failures.Add($msg)
  $TechnicalFailures.Add($msg)
}

# --- 3b. R3 source/evidence discipline and canonical trust boundary --------
# (unconditional, not release-target scoped -- structural repository checks)
foreach ($Validator in @('ValidateR3EvidenceDiscipline.mjs', 'ValidateCanonicalTrustBoundary.mjs', 'ValidateSafeZoneMutationBoundary.mjs')) {
  $ValidatorPath = Join-Path $RepositoryRoot "tooling\release\$Validator"
  if (-not (Test-Path -LiteralPath $ValidatorPath)) {
    throw "Cannot evaluate release evidence discipline: $ValidatorPath not found."
  }
  $ValidatorOutput = & node $ValidatorPath 2>&1
  $ValidatorExitCode = $LASTEXITCODE
  if ($ValidatorExitCode -ne 0) {
    $msg = "$Validator = FAIL ($($ValidatorOutput -join ' '))."
    $Failures.Add($msg)
    $TechnicalFailures.Add($msg)
  }
}

# --- 4. External gate matrix, release-scoped per gate's releaseScope -------
$ExternalGateState = @()
if (-not $IgnoreExternalGates) {
  $GateMatrixPath = Join-Path $RepositoryRoot 'docs\release_readiness\external_gate_matrix.json'
  if (-not (Test-Path -LiteralPath $GateMatrixPath)) {
    throw "Cannot evaluate external gates: $GateMatrixPath not found."
  }
  $GateMatrix = Get-Content -LiteralPath $GateMatrixPath -Raw | ConvertFrom-Json
  foreach ($Gate in $GateMatrix.gates) {
    $Scope = @()
    if ($Gate.PSObject.Properties.Name -contains 'releaseScope' -and $null -ne $Gate.releaseScope) {
      $Scope = @($Gate.releaseScope)
    }
    # Fail the WHOLE script closed on a corrupt/undeclared scope token --
    # never silently ignore it and never silently let it block everything.
    $InvalidTokens = @($Scope | Where-Object { $ValidReleaseTargets -notcontains $_ })
    if ($InvalidTokens.Count -gt 0) {
      throw "External gate matrix entry '$($Gate.id)' has invalid/undeclared releaseScope token(s): $($InvalidTokens -join ', '). Valid release targets are: $($ValidReleaseTargets -join ', '). Fix docs/release_readiness/external_gate_matrix.json before this gate can be evaluated for any release."
    }
    $InScope = $Scope -contains $ReleaseTarget
    $ExternalGateState += [PSCustomObject]@{ id = $Gate.id; status = $Gate.status; owner = $Gate.owner; releaseScope = $Scope; inScope = $InScope }
    if ($InScope -and ($Gate.status -ne 'CLOSED')) {
      $msg = "External gate $($Gate.id) is $($Gate.status) (owner: $($Gate.owner)) and is in scope for release target $ReleaseTarget."
      $Failures.Add($msg)
      $OwnerGatesPending.Add([PSCustomObject]@{ id = $Gate.id; status = $Gate.status; owner = $Gate.owner })
    }
  }
} else {
  Write-Warning 'IgnoreExternalGates set: external gate matrix was NOT checked. This result is not a real release readiness verdict.'
}

# --- Technical vs owner/external verdict split (mission item 4) ------------
$TechnicalGatesPass = ($TechnicalFailures.Count -eq 0)
$OwnerGatesPendingCount = $OwnerGatesPending.Count

# --- Verdict -----------------------------------------------------------------
Write-Host ''
Write-Host '=== PCA Release Gate ==='
Write-Host "RELEASE_TARGET: $ReleaseTarget"
Write-Host "PRODUCTION_CRYPTO_SUITE: $CryptoSuiteState (in scope for ${ReleaseTarget}: $CryptoSuiteInScope)"
Write-Host "REAL_UAT (scoped): $RealUatState ($RealUatPassedCount of $RealUatRelevantCount relevant planned cases passed for $ReleaseTarget)"
Write-Host "REAL_UAT (raw aggregate log, informational only): $RawUatStatus ($($UatLog.casesLogged)/$($UatLog.totalCasesInPlan) cases logged overall)"
Write-Host "EXTERNAL_GATE_PARITY: $ParityState"
if (-not $IgnoreExternalGates) {
  foreach ($g in $ExternalGateState) {
    $marker = if ($g.inScope) { '[IN SCOPE]' } else { '[out of scope]' }
    Write-Host "External gate $($g.id): $($g.status) $marker"
  }
}
Write-Host ''
Write-Host "TECHNICAL_GATES_PASS: $TechnicalGatesPass  (source-derived crypto signal + scoped REAL_UAT + parity + R3 evidence/trust/safe-zone validators)"
if ($OwnerGatesPendingCount -eq 0) {
  Write-Host 'OWNER_GATES_PENDING: NONE'
} else {
  Write-Host "OWNER_GATES_PENDING: $OwnerGatesPendingCount gate(s) open for ${ReleaseTarget}:"
  foreach ($og in $OwnerGatesPending) { Write-Host "  - $($og.id) [$($og.status)] (owner: $($og.owner))" }
}
Write-Host ''

$Verdict = if ($Failures.Count -gt 0) { 'NOT_READY' } else { 'READY' }

if ($JsonOutPath) {
  [ordered]@{
    releaseTarget         = $ReleaseTarget
    verdict               = $Verdict
    technicalGatesPass    = $TechnicalGatesPass
    ownerGatesPendingCount = $OwnerGatesPendingCount
    ownerGatesPending     = $OwnerGatesPending
    cryptoSuiteState      = $CryptoSuiteState
    cryptoSuiteInScope    = $CryptoSuiteInScope
    realUatState          = $RealUatState
    realUatRelevantCount  = $RealUatRelevantCount
    realUatPassedCount    = $RealUatPassedCount
    rawUatStatus          = $RawUatStatus
    externalGateParityState = $ParityState
    ignoreExternalGates   = [bool]$IgnoreExternalGates
    externalGateState     = $ExternalGateState
    failures              = @($Failures)
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $JsonOutPath -Encoding utf8
}

if ($Failures.Count -gt 0) {
  Write-Host 'VERDICT: NOT READY' -ForegroundColor Red
  foreach ($f in $Failures) { Write-Host "  - $f" -ForegroundColor Red }
  exit 1
}

Write-Host 'VERDICT: READY' -ForegroundColor Green
exit 0
