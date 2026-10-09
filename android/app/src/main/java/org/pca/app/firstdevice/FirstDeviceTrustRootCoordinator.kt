package org.pca.app.firstdevice

import java.util.Date
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.pca.app.security.DskSignatureEngine
import org.pca.app.security.DeviceKeyAttestationEvidenceSource
import org.pca.app.security.KeyMaterialMissingException

/**
 * WAVE 6C: drives the Android side of the certified first-device trust-root
 * ceremony end to end, against the EXISTING backend endpoints and semantics
 * (no second bootstrap protocol):
 *
 *   challenge (PENDING) -> parent approval -> APPROVED -> evidence + proof +
 *   epoch-1, all bound to the enrollment DSK -> submit -> COMMITTED/ACCEPTED
 *
 * IRON RULES encoded here (each one is a behavioral mutation kill target):
 *
 *  - NO optimistic local states, EVER. [FirstDeviceRootState.ROOT_COMMITTED]
 *    is written only from (a) a submit response whose status is exactly
 *    ACCEPTED, or (b) a status read reporting COMMITTED + outcome ACCEPTED.
 *    Everything else resolves through [refreshStatus]. This class has no
 *    dependency on any device-lifecycle state at all: server-authoritative
 *    acceptance is recorded here and the lifecycle itself remains entirely
 *    server-owned.
 *  - NEVER re-challenge once submission has begun. A post-commit challenge
 *    call would mint a BRAND-NEW ceremony id (the server's live ceremony
 *    filter excludes COMMITTED rows) -- success-shaped, and silently
 *    orphaning the commit this device already owns. After [SUBMITTING] the
 *    ONLY legal ambiguity resolver is [refreshStatus] against the persisted
 *    ceremonyId.
 *  - Byte-stable retries only. The submission payload is built once,
 *    persisted, and flushed BEFORE the first network call; retries replay
 *    the same bytes (ECDSA is randomized -- any re-signing would change the
 *    backend's commit identity and 409 against an already-committed root).
 *    [resubmitExact] never signs.
 *  - NEVER mint keys. This class performs zero key generation by
 *    construction (it only holds a [DskSignatureEngine] and an evidence
 *    source); a missing keystore entry is [KeyMaterialMissingException],
 *    surfaced fail-closed -- especially after a committed root, where a
 *    replacement key is the forbidden second-root path.
 *  - A rejected/expired ceremony is terminal for itself. An authoritative
 *    EXPIRED outcome trims the persisted submission, after which an explicit
 *    [beginCeremony] restart is legal again; while a persisted submission
 *    remains (REJECTED/UNKNOWN), recovery is [refreshStatus]-only (the
 *    server may already hold the committed root) and a restart follows
 *    re-enrollment instead.
 */
class FirstDeviceTrustRootCoordinator(
    private val rootStore: FirstDeviceRootStore,
    private val apiClient: FirstDeviceBootstrapApiClient,
    private val signatureEngine: DskSignatureEngine,
    private val evidenceSource: DeviceKeyAttestationEvidenceSource,
    private val now: () -> Date = { Date() },
) {
    private val singleFlight = Mutex()
    private val _record = MutableStateFlow(rootStore.current())
    val record: StateFlow<FirstDeviceRootRecord?> = _record.asStateFlow()

    /**
     * Starts (or, only BEFORE any submission round began, resumes) the
     * ceremony. Never after SUBMITTING/ROOT_COMMITTED -- and, since the
     * Stage-B fix, never in ANY state whose record still carries a persisted
     * submission payload (reachable as UNKNOWN after an ambiguous send):
     * those states resolve via [refreshStatus] ONLY, because a new challenge
     * could mint a parallel ceremony while the server already holds the
     * committed root under the ORIGINAL ceremony id.
     */
    suspend fun beginCeremony(): Unit = singleFlight.withLock {
        val current = rootStore.current() ?: return
        when (current.state) {
            FirstDeviceRootState.SUBMITTING,
            FirstDeviceRootState.ROOT_COMMITTED,
            -> return // the only ambiguity resolver now is refreshStatus(); never a new challenge
            FirstDeviceRootState.AWAITING_APPROVAL,
            FirstDeviceRootState.APPROVED,
            -> {
                refreshStatusLocked() // reuse the EXISTING ceremony; never mint a parallel one
                return
            }
            else -> {
                // Stage-B fix (Agents 5/7): once a submission round has begun
                // (a persisted payload exists), the server may already hold
                // the COMMITTED root under the ORIGINAL ceremony id -- a new
                // challenge would mint a NEW success-shaped ceremony and
                // orphan that commit. Resolve via status() only. A challenge
                // remains legal only BEFORE any submission began
                // (submission == null): NOT_STARTED, or a challenge-failure
                // path that never persisted a payload.
                if (current.submission != null) {
                    refreshStatusLocked()
                    return
                }
                Unit
            }
        }
        val challenge = try {
            apiClient.challenge(
                attemptId = current.seed.attemptId,
                attemptRecoveryToken = current.seed.attemptRecoveryToken,
                dskKeyId = current.seed.signingKeyId,
                dskPublicKeyBase64 = current.seed.dskPublicKeyBase64,
            )
        } catch (e: FirstDeviceBootstrapError.Unavailable) {
            transition(current, FirstDeviceRootState.UNKNOWN)
            return
        } catch (e: FirstDeviceBootstrapError.InvalidRequest) {
            return // our own shape bug; state unchanged, never a success
        } catch (e: FirstDeviceBootstrapError.AmbiguousOutcome) {
            transition(current, FirstDeviceRootState.UNKNOWN)
            return
        } catch (e: FirstDeviceBootstrapError.UnexpectedServerError) {
            transition(current, FirstDeviceRootState.UNKNOWN)
            return
        }
        persistIfCurrent(
            expected = current,
            record = current.copy(
                state = FirstDeviceRootState.AWAITING_APPROVAL,
                ceremonyId = challenge.ceremonyId,
                challengeId = challenge.challengeId,
                nonce = challenge.nonce,
                expiresAt = challenge.expiresAt,
                familyId = challenge.familyId,
                submission = null,
            ),
        )
    }

    /** Resolves the ceremony's authoritative state. The ONLY legal post-submission ambiguity resolver. */
    suspend fun refreshStatus(): Unit = singleFlight.withLock { refreshStatusLocked() }

    /** Signs + submits (payload built once and persisted first). Callable from APPROVED only. */
    suspend fun submit(): Unit = singleFlight.withLock {
        val current = rootStore.current() ?: return
        if (current.state != FirstDeviceRootState.APPROVED) return
        val payload = current.submission ?: buildPayload(current) ?: run {
            transition(current, FirstDeviceRootState.UNKNOWN)
            return
        }
        // Persist BEFORE the first send: byte-identical replay after a lost
        // response is the only accepted retry shape.
        val submitting = current.copy(state = FirstDeviceRootState.SUBMITTING, submission = payload)
        if (!persistIfCurrent(expected = current, record = submitting)) return
        if (!rootStore.confirmDurable(submitting) || rootStore.current() != submitting) return
        sendPayload(submitting, payload)
    }

    /** Replays the EXACT persisted payload (never re-signs). For SUBMITTING/UNKNOWN after ambiguity. */
    suspend fun resubmitExact(): Unit = singleFlight.withLock {
        val current = rootStore.current() ?: return
        val payload = current.submission ?: return
        if (current.state != FirstDeviceRootState.SUBMITTING && current.state != FirstDeviceRootState.UNKNOWN) return
        if (!rootStore.confirmDurable(current) || rootStore.current() != current) return
        sendPayload(current, payload)
    }

    private suspend fun sendPayload(current: FirstDeviceRootRecord, payload: FirstDeviceSubmissionPayload) {
        val ceremonyId = current.ceremonyId ?: return
        try {
            apiClient.submit(
                attemptId = current.seed.attemptId,
                attemptRecoveryToken = current.seed.attemptRecoveryToken,
                ceremonyId = ceremonyId,
                proofBytes = payload.proofBytes,
                proofSignature = payload.proofSignature,
                epoch1Bytes = payload.epoch1Bytes,
                epoch1Signature = payload.epoch1Signature,
                attestationEvidence = payload.attestationEvidence,
            )
            finalizeCommitted(current, payload)
        } catch (e: FirstDeviceBootstrapError.Rejected) {
            // STATUS FIRST: a 409 can mean "verification failed" (still
            // APPROVED) -- or, if any caller ever deviated from byte
            // stability, "the original bytes ARE committed" (DIGEST_CONFLICT).
            sweepAfterRejection(current)
        } catch (e: FirstDeviceBootstrapError.Unavailable) {
            refreshStatusLocked()
        } catch (e: FirstDeviceBootstrapError.AmbiguousOutcome) {
            transition(current, FirstDeviceRootState.UNKNOWN)
        } catch (e: FirstDeviceBootstrapError.UnexpectedServerError) {
            transition(current, FirstDeviceRootState.UNKNOWN)
        } catch (e: FirstDeviceBootstrapError.InvalidRequest) {
            transition(current, FirstDeviceRootState.UNKNOWN)
        }
    }

    private suspend fun sweepAfterRejection(current: FirstDeviceRootRecord) {
        refreshStatusLocked()
        val after = rootStore.current() ?: return
        when (after.state) {
            FirstDeviceRootState.ROOT_COMMITTED -> return // the root WAS committed; nothing to reject
            FirstDeviceRootState.APPROVED -> transition(after, FirstDeviceRootState.REJECTED)
            else -> return // EXPIRED / UNKNOWN / anything else: already resolved honestly
        }
    }

    private suspend fun refreshStatusLocked() {
        val current = rootStore.current() ?: return
        val ceremonyId = current.ceremonyId ?: return
        if (current.state == FirstDeviceRootState.ROOT_COMMITTED) return // terminal; never downgraded
        val outcome = try {
            apiClient.status(
                attemptId = current.seed.attemptId,
                attemptRecoveryToken = current.seed.attemptRecoveryToken,
                ceremonyId = ceremonyId,
            )
        } catch (e: FirstDeviceBootstrapError.Unavailable) {
            transition(current, FirstDeviceRootState.UNKNOWN)
            return
        } catch (e: FirstDeviceBootstrapError.AmbiguousOutcome) {
            return // nothing new learned; retryable, state preserved honestly
        } catch (e: FirstDeviceBootstrapError.UnexpectedServerError) {
            return // transient; retryable
        } catch (e: FirstDeviceBootstrapError.InvalidRequest) {
            transition(current, FirstDeviceRootState.UNKNOWN)
            return
        }
        when (outcome.status) {
            STATUS_PENDING -> transition(current, FirstDeviceRootState.AWAITING_APPROVAL)
            STATUS_APPROVED -> transition(current, FirstDeviceRootState.APPROVED)
            STATUS_COMMITTED -> {
                if (outcome.outcome == OUTCOME_ACCEPTED) {
                    finalizeCommitted(current, current.submission)
                } else {
                    transition(current, FirstDeviceRootState.UNKNOWN)
                }
            }
            STATUS_EXPIRED -> {
                // Stage-B fix (Agent 6 MINOR-1): an authoritatively EXPIRED
                // ceremony can never commit (the server's expiry gate
                // precludes it), so the persisted submission (proof bytes +
                // public evidence) is retained past any byte-stable-retry
                // need. Trim it here -- exactly like commit does -- so the
                // documented restart path ([beginCeremony], legal when no
                // submission remains) actually works.
                persistIfCurrent(
                    expected = current,
                    record = current.copy(submission = null, state = FirstDeviceRootState.EXPIRED),
                )
            }
            else -> transition(current, FirstDeviceRootState.UNKNOWN)
        }
    }

    /**
     * Builds the ONE submission payload: evidence from the hardware chain,
     * epoch-1 and proof signed by the SAME enrollment DSK, epoch-1 hash
     * bound into the proof, evidence digest bound into both. Any missing
     * server context or key material fails closed (null / typed exception
     * never turns into a fabricated success).
     */
    private fun buildPayload(current: FirstDeviceRootRecord): FirstDeviceSubmissionPayload? {
        val ceremonyId = current.ceremonyId ?: return null
        val challengeId = current.challengeId ?: return null
        val nonce = current.nonce ?: return null
        val expiresAt = current.expiresAt ?: return null
        val familyId = current.familyId ?: return null
        val seed = current.seed
        return try {
            val evidence = AndroidKeyAttestationEvidence.build(
                attemptId = seed.attemptId,
                chainDer = evidenceSource.certificateChainDer(seed.dskAlias),
            )
            val issuedAt = FirstDeviceCanonical.isoUtcMillis(now())
            val epoch1Bytes = FirstDeviceCanonical.encodeEpoch1(
                familyId = familyId,
                deviceId = seed.deviceId,
                dskKeyId = seed.signingKeyId,
                dskPublicKeyBase64 = seed.dskPublicKeyBase64,
                dekKeyId = seed.encryptionKeyId,
                dekPublicKeyBase64 = seed.dekPublicKeyBase64,
                issuedAtIso = issuedAt,
            )
            val epoch1Signature = FirstDeviceCanonical.base64Url(
                signatureEngine.signCanonicalDer(seed.dskAlias, epoch1Bytes.toByteArray(Charsets.UTF_8)),
            )
            val proofBytes = FirstDeviceCanonical.encodeProof(
                familyId = familyId,
                deviceId = seed.deviceId,
                ceremonyId = ceremonyId,
                challengeId = challengeId,
                nonce = nonce,
                expiresAt = expiresAt, // verbatim from the server challenge
                dskKeyId = seed.signingKeyId,
                dskPublicKeyBase64 = seed.dskPublicKeyBase64,
                epoch1Sha256Hex = FirstDeviceCanonical.sha256Hex(epoch1Bytes),
                attestationEvidenceDigest = FirstDeviceCanonical.sha256Hex(evidence),
            )
            val proofSignature = FirstDeviceCanonical.base64Url(
                signatureEngine.signCanonicalDer(seed.dskAlias, proofBytes.toByteArray(Charsets.UTF_8)),
            )
            FirstDeviceSubmissionPayload(
                proofBytes = proofBytes,
                proofSignature = proofSignature,
                epoch1Bytes = epoch1Bytes,
                epoch1Signature = epoch1Signature,
                attestationEvidence = evidence,
            )
        } catch (e: KeyMaterialMissingException) {
            null // fail closed; caller transitions to UNKNOWN, never regenerates
        } catch (e: IllegalArgumentException) {
            // Stage-B fix (Agent 2 MINOR-1): a locally-invalid evidence
            // precondition (attemptId domain / chain bounds enforced by the
            // evidence builder) must fail closed exactly like missing key
            // material -- never crash submit() and never reach the network.
            null
        } catch (e: IllegalStateException) {
            // Same posture for the serialized-packet 16 KiB budget check.
            null
        }
    }

    /**
     * Server-authoritative success. Trims the record to its minimal audit
     * form: submission bytes (which include the evidence packet), the
     * recovery token and the one-time ceremony fields are CLEARED -- the
     * root is committed, nothing here is needed again, and not keeping
     * evidence around is the privacy-preferred posture.
     */
    private fun finalizeCommitted(current: FirstDeviceRootRecord, payload: FirstDeviceSubmissionPayload?) {
        // A server status is not enough to reconstruct bootstrap authority. Keep
        // the exact signed statement B that this device durably submitted.
        val acceptedPayload = payload ?: current.submission ?: return
        val committed = current.copy(
            state = FirstDeviceRootState.ROOT_COMMITTED,
            seed = current.seed.copy(attemptRecoveryToken = ""),
            submission = null,
            nonce = null,
            challengeId = null,
            expiresAt = null,
            committedAtMillis = now().time,
            acceptedEpoch1 = FirstDeviceAcceptedEpochAnchor(
                canonicalBytes = acceptedPayload.epoch1Bytes,
                signatureBase64Url = acceptedPayload.epoch1Signature,
            ),
        )
        persistIfCurrent(expected = current, record = committed)
        // payload intentionally dropped; referenced only so the trimming
        // intent is explicit at the call site.
        @Suppress("UNUSED_EXPRESSION")
        payload
    }

    private fun transition(current: FirstDeviceRootRecord, state: FirstDeviceRootState) {
        persistIfCurrent(expected = current, record = current.copy(state = state))
    }

    private fun persistIfCurrent(expected: FirstDeviceRootRecord, record: FirstDeviceRootRecord): Boolean {
        if (!rootStore.writeIfCurrent(expected, record)) return false
        _record.value = record
        return true
    }

    private companion object {
        const val STATUS_PENDING = "PENDING"
        const val STATUS_APPROVED = "APPROVED"
        const val STATUS_COMMITTED = "COMMITTED"
        const val STATUS_EXPIRED = "EXPIRED"
        const val OUTCOME_ACCEPTED = "ACCEPTED"
    }
}
