import Foundation

/// Seam over the App Attest evidence builder so the coordinator can be
/// tested without touching DeviceCheck.
public protocol FirstDeviceEvidenceBuilding {
    func buildEvidence(transcript: String, dskKeyId: String, dskPublicKeyBase64: String) async throws -> IosAppAttestEvidence
}

#if canImport(DeviceCheck)

extension IosAppAttestAdapter: FirstDeviceEvidenceBuilding {}

#endif

/// Explicit FIFO single-flight gate. `actor` alone is NOT enough: actor
/// methods re-enter at `await` boundaries, which would allow a second
/// ceremony operation to interleave with a submit mid-flight. This gate is
/// the iOS counterpart of Android's `Mutex` single-flight: waiters are
/// resumed strictly in arrival order, and the critical section never
/// suspends while holding the gate (callers await INSIDE, and the gate's
/// own lock/unlock paths contain no awaited work between their check and
/// their state transitions).
actor FirstDeviceSingleFlightGate {
    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func lock() async {
        if locked {
            await withCheckedContinuation { continuation in
                waiters.append(continuation)
            }
        } else {
            locked = true
        }
    }

    func unlock() {
        if waiters.isEmpty {
            locked = false
        } else {
            waiters.removeFirst().resume()
        }
    }

    func run<T>(_ operation: () async throws -> T) async throws -> T {
        await lock()
        do {
            // A queued operation may have been cancelled while another
            // ceremony held the gate. Release the gate without touching
            // persisted ceremony state or invoking its transport.
            try Task.checkCancellation()
            let value = try await operation()
            unlock()
            return value
        } catch {
            unlock()
            throw error
        }
    }
}

/// WAVE 6D: drives the iOS side of the certified first-device trust-root
/// ceremony end to end, against the EXISTING backend endpoints and
/// semantics (no second bootstrap protocol) -- the exact behavioral mirror
/// of Android's Wave-6C `FirstDeviceTrustRootCoordinator`:
///
///   challenge (PENDING) -> parent approval -> APPROVED -> evidence
///   (Secure Enclave DSK + App Attest) + proof + epoch-1 -> submit ->
///   COMMITTED/ACCEPTED
///
/// IRON RULES encoded here (each one is a behavioral mutation kill target):
///
///  - NO optimistic local states, EVER. `.rootCommitted` is written only
///    from (a) a submit response whose status is exactly ACCEPTED, or (b) a
///    status read reporting COMMITTED + outcome ACCEPTED. Everything else
///    resolves through `refreshStatus()`. This class has no dependency on
///    any device-lifecycle state; server-authoritative acceptance is
///    recorded here and the lifecycle remains entirely server-owned.
///  - NEVER re-challenge once submission has begun. After `.submitting` (or
///    any state whose record still carries a persisted submission -- e.g.
///    `.unknown` after an ambiguous send) the ONLY legal ambiguity resolver
///    is `refreshStatus()` against the persisted ceremonyId; a new
///    challenge could mint a parallel ceremony while the server already
///    holds the committed root under the original id.
///  - Byte-stable retries only: the submission payload is built once,
///    persisted, and flushed BEFORE the first network call; retries replay
///    the same bytes (ECDSA is randomized -- re-signing would change the
///    backend's commit identity).
///  - NEVER mint keys: this class only signs through the injected
///    `FirstDeviceDskKeyMaterial`; a missing Secure Enclave entry is a
///    typed failure, surfaced fail-closed in `.unknown` -- never a
///    regeneration.
///  - EXPIRED trims the persisted submission (the ceremony can never
///    commit after expiry), making the documented `beginCeremony` restart
///    legal again; `.rejected`/`.unknown` with a persisted submission are
///    `refreshStatus()`-only.
public final class FirstDeviceTrustRootCoordinator {
    private let rootStore: FirstDeviceRootStoring
    private let apiClient: FirstDeviceBootstrapApiClienting
    private let keyMaterial: FirstDeviceDskKeyMaterial
    private let evidenceBuilder: FirstDeviceEvidenceBuilding
    private let now: () -> Date
    private let gate = FirstDeviceSingleFlightGate()

    /// Latest persisted record (UI snapshot). Updated only inside the gate.
    public private(set) var record: FirstDeviceRootRecord?
    /// Observer for state publications (optional).
    public var onRecordChanged: ((FirstDeviceRootRecord?) -> Void)?

    public init(
        rootStore: FirstDeviceRootStoring,
        apiClient: FirstDeviceBootstrapApiClienting,
        keyMaterial: FirstDeviceDskKeyMaterial,
        evidenceBuilder: FirstDeviceEvidenceBuilding,
        now: @escaping () -> Date = { Date() }
    ) {
        self.rootStore = rootStore
        self.apiClient = apiClient
        self.keyMaterial = keyMaterial
        self.evidenceBuilder = evidenceBuilder
        self.now = now
        self.record = rootStore.current()
    }

    /// Starts (or, only BEFORE any submission round began, resumes) the
    /// ceremony. Never after SUBMITTING/ROOT_COMMITTED, and never in any
    /// state whose record still carries a persisted submission payload.
    public func beginCeremony() async {
        try? await gate.run { try await self.beginCeremonyLocked() }
    }

    /// Resolves the ceremony's authoritative state. The ONLY legal
    /// post-submission ambiguity resolver.
    public func refreshStatus() async {
        try? await gate.run { try await self.refreshStatusLocked() }
    }

    /// Signs + submits (payload built once and persisted first).
    /// Callable from `.approved` only.
    public func submit() async {
        try? await gate.run { try await self.submitLocked() }
    }

    /// Replays the EXACT persisted payload (never re-signs). For
    /// `.submitting`/`.unknown` after ambiguity.
    public func resubmitExact() async {
        try? await gate.run { try await self.resubmitExactLocked() }
    }

    // MARK: - Gate-held operations

    private func beginCeremonyLocked() async throws {
        guard let current = rootStore.current() else { return }
        switch current.state {
        case .submitting, .rootCommitted:
            return // the only ambiguity resolver now is refreshStatus(); never a new challenge
        case .awaitingApproval, .approved:
            await refreshStatusLocked() // reuse the EXISTING ceremony; never mint a parallel one
            return
        default:
            // Once a submission round has begun (a persisted payload
            // exists), the server may already hold the COMMITTED root under
            // the ORIGINAL ceremony id -- a new challenge would mint a NEW
            // success-shaped ceremony and orphan that commit.
            if current.submission != nil {
                await refreshStatusLocked()
                return
            }
        }

        let challenge: FirstDeviceChallengeResponse
        do {
            challenge = try await apiClient.challenge(
                attemptId: current.seed.attemptId,
                attemptRecoveryToken: current.seed.attemptRecoveryToken,
                dskKeyId: current.seed.signingKeyId,
                dskPublicKeyBase64: current.seed.dskPublicKeyBase64
            )
        } catch let error as FirstDeviceBootstrapError {
            switch error {
            case .invalidRequest:
                return // our own shape bug; state unchanged, never a success
            default:
                transition(current, state: .unknown)
                return
            }
        } catch {
            transition(current, state: .unknown)
            return
        }

        var next = current
        next.state = .awaitingApproval
        next.ceremonyId = challenge.ceremonyId
        next.challengeId = challenge.challengeId
        next.nonce = challenge.nonce
        next.expiresAt = challenge.expiresAt
        next.familyId = challenge.familyId
        next.submission = nil
        persistIfCurrent(expected: current, next)
    }

    private func submitLocked() async throws {
        guard let current = rootStore.current() else { return }
        guard current.state == .approved else { return }
        let payload: FirstDeviceSubmissionPayload
        if let persisted = current.submission {
            payload = persisted
        } else if let built = await buildPayload(current) {
            payload = built
        } else {
            transition(current, state: .unknown)
            return
        }
        // Persist BEFORE the first send: byte-identical replay after a lost
        // response is the only accepted retry shape.
        var submitting = current
        submitting.state = .submitting
        submitting.submission = payload
        guard persistIfCurrent(expected: current, submitting),
              let refreshed = rootStore.current(),
              refreshed == submitting,
              refreshed.state == .submitting,
              refreshed.submission == payload,
              rootStore.confirmDurable(refreshed),
              rootStore.current() == refreshed else { return }
        await sendPayload(refreshed, payload: payload)
    }

    private func resubmitExactLocked() async throws {
        guard let current = rootStore.current(), let payload = current.submission else { return }
        guard current.state == .submitting || current.state == .unknown else { return }
        guard rootStore.confirmDurable(current), rootStore.current() == current else { return }
        await sendPayload(current, payload: payload)
    }

    private func sendPayload(_ current: FirstDeviceRootRecord, payload: FirstDeviceSubmissionPayload) async {
        guard let ceremonyId = current.ceremonyId else { return }
        do {
            let response = try await apiClient.submit(
                attemptId: current.seed.attemptId,
                attemptRecoveryToken: current.seed.attemptRecoveryToken,
                ceremonyId: ceremonyId,
                proofBytes: payload.proofBytes,
                proofSignature: payload.proofSignature,
                epoch1Bytes: payload.epoch1Bytes,
                epoch1Signature: payload.epoch1Signature,
                attestationEvidence: payload.attestationEvidence
            )
            guard response.status == "ACCEPTED" else {
                transition(current, state: .unknown)
                return
            }
            finalizeCommitted(current)
        } catch let error as FirstDeviceBootstrapError {
            switch error {
            case .rejected:
                // STATUS FIRST: a 409 can mean "verification failed" (still
                // APPROVED) -- or, if any caller ever deviated from byte
                // stability, "the original bytes ARE committed".
                await sweepAfterRejection(current)
            case .unavailable:
                await refreshStatusLocked()
            default:
                transition(current, state: .unknown)
            }
        } catch {
            transition(current, state: .unknown)
        }
    }

    private func sweepAfterRejection(_ current: FirstDeviceRootRecord) async {
        await refreshStatusLocked()
        guard let after = rootStore.current() else { return }
        switch after.state {
        case .rootCommitted:
            return // the root WAS committed; nothing to reject
        case .approved:
            transition(after, state: .rejected)
        default:
            return // EXPIRED / UNKNOWN / anything else: already resolved honestly
        }
    }

    private func refreshStatusLocked() async {
        guard let current = rootStore.current() else { return }
        guard let ceremonyId = current.ceremonyId else { return }
        if current.state == .rootCommitted { return } // terminal; never downgraded
        let outcome: FirstDeviceStatusResponse
        do {
            outcome = try await apiClient.status(
                attemptId: current.seed.attemptId,
                attemptRecoveryToken: current.seed.attemptRecoveryToken,
                ceremonyId: ceremonyId
            )
        } catch let error as FirstDeviceBootstrapError {
            switch error {
            case .ambiguousOutcome, .unexpectedServerError:
                return // nothing new learned; retryable, state preserved honestly
            default:
                transition(current, state: .unknown)
                return
            }
        } catch {
            return
        }
        switch outcome.status {
        case "PENDING":
            transition(current, state: .awaitingApproval)
        case "APPROVED":
            transition(current, state: .approved)
        case "COMMITTED":
            if outcome.outcome == "ACCEPTED" {
                finalizeCommitted(current)
            } else {
                transition(current, state: .unknown)
            }
        case "EXPIRED":
            // An authoritatively EXPIRED ceremony can never commit (the
            // server's expiry gate precludes it), so the persisted
            // submission is retained past any byte-stable-retry need. Trim
            // it here so the documented restart path (beginCeremony, legal
            // when no submission remains) actually works.
            var expired = current
            expired.submission = nil
            persistIfCurrent(expected: current, withState(expired, .expired))
        default:
            transition(current, state: .unknown)
        }
    }

    /// Builds the ONE submission payload: evidence from the Secure Enclave
    /// DSK + App Attest, epoch-1 and proof signed by the SAME enrollment
    /// DSK, epoch-1 hash bound into the proof, evidence digest bound into
    /// both. Any missing server context or key material fails closed (nil
    /// -- never a fabricated success, never a regenerated key).
    private func buildPayload(_ current: FirstDeviceRootRecord) async -> FirstDeviceSubmissionPayload? {
        guard let ceremonyId = current.ceremonyId,
              let challengeId = current.challengeId,
              let nonce = current.nonce,
              let expiresAt = current.expiresAt,
              let familyId = current.familyId else { return nil }
        let seed = current.seed
        do {
            let transcript = FirstDeviceCanonical.encodeIosAttestationTranscript(
                familyId: familyId,
                deviceId: seed.deviceId,
                ceremonyId: ceremonyId,
                challengeId: challengeId,
                nonce: nonce,
                dskKeyId: seed.signingKeyId,
                dskPublicKeyBase64: seed.dskPublicKeyBase64
            )
            let evidence = try await evidenceBuilder.buildEvidence(
                transcript: transcript,
                dskKeyId: seed.signingKeyId,
                dskPublicKeyBase64: seed.dskPublicKeyBase64
            )
            let issuedAt = FirstDeviceCanonical.isoUtcMillis(now())
            let epoch1Bytes = FirstDeviceCanonical.encodeEpoch1(
                familyId: familyId,
                deviceId: seed.deviceId,
                dskKeyId: seed.signingKeyId,
                dskPublicKeyBase64: seed.dskPublicKeyBase64,
                dekKeyId: seed.encryptionKeyId,
                dekPublicKeyBase64: seed.dekPublicKeyBase64,
                issuedAt: issuedAt
            )
            let epoch1Signature = FirstDeviceCanonical.base64Url(
                try keyMaterial.signCanonical(alias: seed.dskAlias, message: Data(epoch1Bytes.utf8))
            )
            let proofBytes = FirstDeviceCanonical.encodeProof(
                familyId: familyId,
                deviceId: seed.deviceId,
                ceremonyId: ceremonyId,
                challengeId: challengeId,
                nonce: nonce,
                expiresAt: expiresAt, // verbatim from the server challenge
                dskKeyId: seed.signingKeyId,
                dskPublicKeyBase64: seed.dskPublicKeyBase64,
                epoch1Sha256Hex: FirstDeviceCanonical.sha256Hex(epoch1Bytes),
                attestationEvidenceDigest: FirstDeviceCanonical.sha256Hex(evidence.json)
            )
            let proofSignature = FirstDeviceCanonical.base64Url(
                try keyMaterial.signCanonical(alias: seed.dskAlias, message: Data(proofBytes.utf8))
            )
            return FirstDeviceSubmissionPayload(
                proofBytes: proofBytes,
                proofSignature: proofSignature,
                epoch1Bytes: epoch1Bytes,
                epoch1Signature: epoch1Signature,
                attestationEvidence: evidence.json
            )
        } catch {
            return nil // fail closed; UNKNOWN, never regenerate, never fabricate
        }
    }

    /// Server-authoritative success. Trims the record to its minimal audit
    /// form: submission bytes (which include the evidence packet), the
    /// recovery token and the one-time ceremony fields are CLEARED.
    private func finalizeCommitted(_ current: FirstDeviceRootRecord) {
        var committed = current
        committed.state = .rootCommitted
        guard let submission = current.submission else { return }
        committed.acceptedEpoch1 = FirstDeviceAcceptedEpochAnchor(canonicalBytes: submission.epoch1Bytes, signature: submission.epoch1Signature)
        committed.seed.attemptRecoveryToken = ""
        committed.submission = nil
        committed.nonce = nil
        committed.challengeId = nil
        committed.expiresAt = nil
        committed.committedAtMillis = Int64(now().timeIntervalSince1970 * 1000)
        persistIfCurrent(expected: current, committed)
    }

    private func transition(_ current: FirstDeviceRootRecord, state: FirstDeviceRootState) {
        persistIfCurrent(expected: current, withState(current, state))
    }

    private func withState(_ record: FirstDeviceRootRecord, _ state: FirstDeviceRootState) -> FirstDeviceRootRecord {
        var next = record
        next.state = state
        return next
    }

    @discardableResult private func persistIfCurrent(
        expected: FirstDeviceRootRecord,
        _ record: FirstDeviceRootRecord
    ) -> Bool {
        guard rootStore.writeIfCurrent(expected: expected, record: record) else { return false }
        self.record = record
        onRecordChanged?(record)
        return true
    }
}
