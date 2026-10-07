import XCTest
#if canImport(CryptoKit)
import CryptoKit
#endif
@testable import PCA

final class ProductionIntegrationTests: XCTestCase {
    private func replayEnvelope(id: String = "message-1", nonce: String = "1", sender: String = "key-1",
                                trust: Int = 1, key: Int = 1) throws -> (PCAInboundEnvelope, PCAInboundScope) {
        let response = try inboundResponse()
        let original = try XCTUnwrap(response.applied.first)
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        json["messageId"] = id; json["sequenceOrNonce"] = nonce; json["senderKeyId"] = sender
        json["trustSetEpoch"] = trust; json["keyEpoch"] = key
        return (try JSONDecoder().decode(PCAInboundEnvelope.self, from: JSONSerialization.data(withJSONObject: json)), response.scope)
    }
    func testReplayDenialRequiresExplicitInitializationAndPreservesMissingStateFailure() throws {
        let keychain = InMemoryKeychainStore(), (envelope, scope) = try replayEnvelope()
        let ledger = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "denial", expectedDeviceId: scope.recipientDeviceId)
        XCTAssertThrowsError(try ledger.isEnvelopeDenied(envelope, scope: scope))
        try ledger.initializeFresh(assertAuthority: {})
        try ledger.install(PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]), minimumTrustSetEpoch: 2, minimumKeyEpoch: 0), assertAuthority: {})
        XCTAssertTrue(try ledger.isEnvelopeDenied(envelope, scope: scope))
        XCTAssertThrowsError(try ledger.initializeFresh(assertAuthority: {}))
        try keychain.delete(forAccount: "current.replay-denial", service: "denial.replay-denial")
        XCTAssertThrowsError(try ledger.isEnvelopeDenied(envelope, scope: scope))
        XCTAssertThrowsError(try ledger.initializeFresh(assertAuthority: {}))
    }
    func testTrustedNumericRetirementDeniesMessageAliasesAndSurvivesAuthorityBindingChange() throws {
        let keychain = InMemoryKeychainStore(), (envelope, scope) = try replayEnvelope()
        let ledger = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "numeric-denial", expectedDeviceId: scope.recipientDeviceId)
        try ledger.initializeFresh(assertAuthority: {})
        try ledger.install(PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]), minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 2)]), assertAuthority: {})
        XCTAssertTrue(try ledger.isEnvelopeDenied(envelope, scope: scope))
        XCTAssertTrue(try ledger.isEnvelopeDenied(replayEnvelope(id: "alias").0, scope: scope))
        XCTAssertTrue(try ledger.isEnvelopeDenied(replayEnvelope(nonce: "01").0, scope: scope))
        XCTAssertFalse(try ledger.isEnvelopeDenied(replayEnvelope(nonce: "3").0, scope: scope))
        try ledger.install(PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([2]), minimumTrustSetEpoch: 0, minimumKeyEpoch: 0), assertAuthority: {})
        let restored = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "numeric-denial", expectedDeviceId: scope.recipientDeviceId)
        XCTAssertTrue(try restored.isEnvelopeDenied(replayEnvelope(id: "restored-alias").0, scope: scope))
        XCTAssertFalse(try restored.isEnvelopeDenied(replayEnvelope(sender: "other-key").0, scope: scope))
    }
    func testReplayDenialNeverInfersNumericModeAndRejectsEpochRegressionAndOverflow() throws {
        let (envelope, scope) = try replayEnvelope()
        let ledger = PCAInboundReplayDenialLedger(keychain: InMemoryKeychainStore(), serviceNamespace: "opaque-denial", expectedDeviceId: scope.recipientDeviceId)
        try ledger.initializeFresh(assertAuthority: {})
        XCTAssertFalse(try ledger.isEnvelopeDenied(envelope, scope: scope))
        XCTAssertFalse(try ledger.isEnvelopeDenied(replayEnvelope(nonce: "01").0, scope: scope))
        try ledger.install(PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]), minimumTrustSetEpoch: 2, minimumKeyEpoch: 3), assertAuthority: {})
        XCTAssertTrue(try ledger.isEnvelopeDenied(envelope, scope: scope))
        XCTAssertFalse(try ledger.isEnvelopeDenied(replayEnvelope(trust: 2, key: 3).0, scope: scope))
        XCTAssertThrowsError(try ledger.install(PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([2]), minimumTrustSetEpoch: 1, minimumKeyEpoch: 3), assertAuthority: {}))
        XCTAssertThrowsError(try ledger.install(PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([2]), minimumTrustSetEpoch: Int(Int32.max) + 1, minimumKeyEpoch: 3), assertAuthority: {}))
    }
    func testEpochRejectionDoesNotCoverFreshEpochReplayAliasForReclamation() throws {
        let (original, scope) = try replayEnvelope(trust: 1, key: 1)
        let alias = try replayEnvelope(id: "alias", trust: 2, key: 2).0
        let ledger = PCAInboundReplayDenialLedger(keychain: InMemoryKeychainStore(), serviceNamespace: "epoch-coverage", expectedDeviceId: scope.recipientDeviceId)
        try ledger.initializeFresh(assertAuthority: {})
        try ledger.install(PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]), minimumTrustSetEpoch: 2, minimumKeyEpoch: 2), assertAuthority: {})
        XCTAssertTrue(try ledger.isEnvelopeDenied(original, scope: scope))
        XCTAssertFalse(try ledger.isEnvelopeDenied(alias, scope: scope))
        XCTAssertFalse(try ledger.coversReplayIdentityPermanently(original, scope: scope))
        XCTAssertFalse(try ledger.coversReplayIdentityPermanently(alias, scope: scope))
        try ledger.install(PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]), minimumTrustSetEpoch: 2, minimumKeyEpoch: 2,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 2)]), assertAuthority: {})
        XCTAssertTrue(try ledger.coversReplayIdentityPermanently(original, scope: scope))
        XCTAssertTrue(try ledger.coversReplayIdentityPermanently(alias, scope: scope))
    }
    @MainActor func testConsumerDenialSuppressesAliasesWithoutInventingApplicationReceipt() async throws {
        let keychain = InMemoryKeychainStore(), (envelope, scope) = try replayEnvelope()
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "denied-consumer")
        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "denied-consumer", expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        try denial.install(PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]), minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 1)]), assertAuthority: {})
        let handler = ConsumerHandler()
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: handler, replayDenial: denial)
        let aliases = [envelope, try replayEnvelope(id: "alias").0].map { PCAStoredInboundEnvelope(envelope: $0, relayAcknowledged: true, processingState: "PENDING_CRYPTO") }
        let count = try await consumer.consume(aliases, scope: scope, assertAuthority: {})
        XCTAssertEqual(count, 0); XCTAssertTrue(handler.applied.isEmpty); XCTAssertTrue(try journal.records().isEmpty)
        XCTAssertTrue(try consumer.pending(aliases, scope: scope).isEmpty)
    }
    @MainActor func testRetirementLatchBlocksNilAndBoundaryFreeLedgersAcrossRestart() async throws {
        let keychain = JournalKeychain(), response = try inboundResponse()
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "retirement-latch")
        let candidates = response.applied.map {
            PCAStoredInboundEnvelope(envelope: $0, relayAcknowledged: true, processingState: "PENDING_CRYPTO")
        }
        let handler = ConsumerHandler()
        let legacyConsumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: handler)
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "retirement-latch")
        try inbox.capture(response, sessionDeviceId: response.scope.recipientDeviceId)
        let initialDenial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "retirement-latch",
            expectedDeviceId: response.scope.recipientDeviceId)
        try initialDenial.initializeFresh(assertAuthority: {})
        let reclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: initialDenial,
            verifier: RetirementVerifier(boundary: PCAInboundReplayRetirementBoundary(scope: response.scope,
                authorityBinding: Data([1]), minimumTrustSetEpoch: 0, minimumKeyEpoch: 0)))
        keychain.failingAccount = "current.replay-denial"
        do {
            _ = try await reclaimer.reclaim(scope: response.scope, assertAuthority: {})
            XCTFail("Retirement boundary persistence must fail after installing the latch")
        } catch { }
        keychain.failingAccount = nil
        XCTAssertEqual(try inbox.pendingCrypto(scope: response.scope).count, candidates.count)
        XCTAssertTrue(try journal.records().isEmpty)
        XCTAssertThrowsError(try legacyConsumer.pending(candidates, scope: response.scope))

        let restoredJournal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "retirement-latch")
        let restoredLegacyConsumer = PCAInboundCommandConsumer(journal: restoredJournal, verifier: ConsumerVerifier(), handler: handler)
        XCTAssertThrowsError(try restoredLegacyConsumer.pending(candidates, scope: response.scope))

        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "retirement-latch",
            expectedDeviceId: response.scope.recipientDeviceId)
        let configuredConsumer = PCAInboundCommandConsumer(journal: restoredJournal, verifier: ConsumerVerifier(),
            handler: handler, replayDenial: denial)
        XCTAssertThrowsError(try configuredConsumer.pending(candidates, scope: response.scope),
            "An initialized but boundary-free ledger cannot clear a retirement latch")
        try denial.install(PCAInboundReplayRetirementBoundary(scope: response.scope, authorityBinding: Data([1]),
            minimumTrustSetEpoch: 0, minimumKeyEpoch: 0), assertAuthority: {})
        XCTAssertEqual(try configuredConsumer.pending(candidates, scope: response.scope).count, candidates.count)
    }
    @MainActor func testRetirementMarkerAloneBlocksLegacyConsumerAfterSnapshotWriteFailure() async throws {
        let keychain = JournalKeychain(), response = try inboundResponse()
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "retirement-partial")
        let candidates = response.applied.map {
            PCAStoredInboundEnvelope(envelope: $0, relayAcknowledged: true, processingState: "PENDING_CRYPTO")
        }
        let legacyConsumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: ConsumerHandler())
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "retirement-partial")
        try inbox.capture(response, sessionDeviceId: response.scope.recipientDeviceId)
        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "retirement-partial",
            expectedDeviceId: response.scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let reclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial,
            verifier: RetirementVerifier(boundary: PCAInboundReplayRetirementBoundary(scope: response.scope,
                authorityBinding: Data([1]), minimumTrustSetEpoch: 0, minimumKeyEpoch: 0)))
        keychain.failingAccount = "current.inbound-application-journal"
        do {
            _ = try await reclaimer.reclaim(scope: response.scope, assertAuthority: {})
            XCTFail("Journal snapshot persistence must fail after installing the marker")
        } catch { }
        keychain.failingAccount = nil
        XCTAssertEqual(try inbox.pendingCrypto(scope: response.scope).count, candidates.count)
        XCTAssertTrue(try journal.records().isEmpty)

        let restored = PCAInboundCommandConsumer(
            journal: PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "retirement-partial"),
            verifier: ConsumerVerifier(), handler: ConsumerHandler())
        XCTAssertThrowsError(try legacyConsumer.pending(candidates, scope: response.scope))
        XCTAssertThrowsError(try restored.pending(candidates, scope: response.scope))
    }
    @MainActor func testReplayReclaimerRemovesOnlyCoveredAcknowledgedTerminalRecords() async throws {
        let keychain = InMemoryKeychainStore(), response = try inboundResponse()
        let envelope = try XCTUnwrap(response.applied.first), scope = response.scope
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "reclaimer-preserve")
        try inbox.capture(response, sessionDeviceId: scope.recipientDeviceId)
        try inbox.capture(try inboundResponse(id: "unacknowledged"), sessionDeviceId: scope.recipientDeviceId)
        try inbox.capture(try inboundResponse(id: "prepared"), sessionDeviceId: scope.recipientDeviceId)
        try inbox.markAcknowledged(envelope, scope: scope)

        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "reclaimer-preserve")
        let acknowledged = try journalIntent()
        try journal.prepare(acknowledged)
        try journal.complete(acknowledged, outcome: .applied, at: acknowledged.preparedAt)
        let unacknowledged = try journalIntent(id: "unacknowledged")
        try journal.prepare(unacknowledged)
        try journal.complete(unacknowledged, outcome: .applied, at: unacknowledged.preparedAt)
        let prepared = try journalIntent(id: "prepared")
        try journal.prepare(prepared)

        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "reclaimer-preserve",
            expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let boundary = PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]),
            minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 1)])
        let reclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial,
            verifier: RetirementVerifier(boundary: boundary))
        let legacyConsumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: ConsumerHandler())
        let candidates = [acknowledged, unacknowledged, prepared].map {
            PCAStoredInboundEnvelope(envelope: $0.envelope, relayAcknowledged: true, processingState: "PENDING_CRYPTO")
        }

        let reclaimed = try await reclaimer.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(reclaimed, 1)
        XCTAssertThrowsError(try legacyConsumer.pending(candidates, scope: scope))
        XCTAssertEqual(Set(try inbox.pendingAcknowledgements(scope: scope).map { $0.envelope.messageId }),
            Set(["unacknowledged", "prepared"]))
        let remaining = try journal.records()
        XCTAssertEqual(Set(remaining.map { $0.intent.envelope.messageId }), Set(["unacknowledged", "prepared"]))
        XCTAssertNil(remaining.first(where: { $0.intent.envelope.messageId == "prepared" })?.outcome)
    }
    @MainActor func testReplayReclaimerClearsAcknowledgedInboxOnlyAliasesWithoutEvictingPendingACKs() async throws {
        let keychain = InMemoryKeychainStore(), scope = PCAInboundScope(familyId: "family-1", recipientDeviceId: "device-1")
        let first = try inboundResponse(id: "retired-original") { $0["sequenceOrNonce"] = "1" }
        let original = try XCTUnwrap(first.applied.first)
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "reclaimer-inbox-only")
        try inbox.capture(first, sessionDeviceId: scope.recipientDeviceId)
        try inbox.markAcknowledged(original, scope: scope)
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "reclaimer-inbox-only")
        let intent = PCAInboundApplicationIntent(operationId: UUID().uuidString.lowercased(), scope: scope,
            envelope: original, authorityBinding: Data("authority".utf8), acceptedCommandBinding: Data("command".utf8),
            preparedAt: Date(timeIntervalSince1970: 1_760_000_000))
        try journal.prepare(intent)
        try journal.complete(intent, outcome: .applied, at: intent.preparedAt)
        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "reclaimer-inbox-only",
            expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let boundary = PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]),
            minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 1)])
        let reclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial,
            verifier: RetirementVerifier(boundary: boundary))
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: ConsumerHandler(), replayDenial: denial)
        let initialReclaimed = try await reclaimer.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(initialReclaimed, 1)
        XCTAssertTrue(try journal.records().isEmpty)
        XCTAssertTrue(try inbox.pendingCrypto(scope: scope).isEmpty)

        for index in 0..<256 {
            let response = try inboundResponse(id: "retired-alias-\(index)") { $0["sequenceOrNonce"] = "1" }
            let alias = try XCTUnwrap(response.applied.first)
            try inbox.capture(response, sessionDeviceId: scope.recipientDeviceId)
            XCTAssertTrue(try consumer.pending(try inbox.pendingCrypto(scope: scope), scope: scope).isEmpty)
            try inbox.markAcknowledged(alias, scope: scope)
        }
        let overflow = try inboundResponse(id: "overflow-alias") { $0["sequenceOrNonce"] = "1" }
        XCTAssertThrowsError(try inbox.capture(overflow, sessionDeviceId: scope.recipientDeviceId))
        let aliasesReclaimed = try await reclaimer.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(aliasesReclaimed, 256)
        XCTAssertTrue(try inbox.pendingCrypto(scope: scope).isEmpty)
        XCTAssertTrue(try journal.records().isEmpty)
        let restoredInbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "reclaimer-inbox-only")
        let restoredJournal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "reclaimer-inbox-only")
        let restoredDenial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "reclaimer-inbox-only",
            expectedDeviceId: scope.recipientDeviceId)
        XCTAssertTrue(try restoredInbox.pendingCrypto(scope: scope).isEmpty)
        XCTAssertTrue(try restoredJournal.records().isEmpty)
        XCTAssertTrue(try restoredDenial.coversReplayIdentityPermanently(try XCTUnwrap(overflow.applied.first), scope: scope))

        let unacknowledged = try inboundResponse(id: "unacknowledged-alias") { $0["sequenceOrNonce"] = "1" }
        let pending = try XCTUnwrap(unacknowledged.applied.first)
        try inbox.capture(unacknowledged, sessionDeviceId: scope.recipientDeviceId)
        let pendingAckReclaimed = try await reclaimer.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(pendingAckReclaimed, 0)
        XCTAssertEqual(try inbox.pendingAcknowledgements(scope: scope).count, 1)
        try inbox.markAcknowledged(pending, scope: scope)
        let acknowledgedReclaimed = try await reclaimer.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(acknowledgedReclaimed, 1)
        XCTAssertTrue(try inbox.pendingCrypto(scope: scope).isEmpty)

        let legitimate = try inboundResponse(id: "after-retirement") { $0["sequenceOrNonce"] = "2" }
        try inbox.capture(legitimate, sessionDeviceId: scope.recipientDeviceId)
        XCTAssertEqual(try consumer.pending(try inbox.pendingCrypto(scope: scope), scope: scope).count, 1)
    }
    @MainActor func testReplayReclaimerResumesAfterCiphertextDeletionAndJournalWriteFailure() async throws {
        let keychain = JournalKeychain(), response = try inboundResponse()
        let envelope = try XCTUnwrap(response.applied.first), scope = response.scope
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "reclaimer-resume")
        try inbox.capture(response, sessionDeviceId: scope.recipientDeviceId)
        try inbox.markAcknowledged(envelope, scope: scope)
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "reclaimer-resume")
        let intent = try journalIntent()
        try journal.prepare(intent)
        try journal.complete(intent, outcome: .applied, at: intent.preparedAt)
        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "reclaimer-resume",
            expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let boundary = PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]),
            minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 1)])
        let verifier = RetirementVerifier(boundary: boundary)
        let reclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial, verifier: verifier)
        let authority: () throws -> Void = {
            if keychain.failingAccount == nil, (try? inbox.pendingCrypto(scope: scope).isEmpty) == true {
                keychain.failingAccount = "current.inbound-application-journal"
            }
        }
        do {
            _ = try await reclaimer.reclaim(scope: scope, assertAuthority: authority)
            XCTFail("Journal write must fail after acknowledged ciphertext deletion")
        } catch { }
        XCTAssertEqual(keychain.failingAccount, "current.inbound-application-journal")
        XCTAssertTrue(try inbox.pendingCrypto(scope: scope).isEmpty)
        XCTAssertEqual(try journal.records().count, 1)

        keychain.failingAccount = nil
        let restored = try PCAInboundReplayReclaimer(
            journal: PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "reclaimer-resume"),
            inbox: PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "reclaimer-resume"),
            denial: PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "reclaimer-resume",
                expectedDeviceId: scope.recipientDeviceId), verifier: verifier)
        let resumed = try await restored.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(resumed, 1)
        XCTAssertTrue(try journal.records().isEmpty)
        XCTAssertTrue(try denial.coversReplayIdentityPermanently(envelope, scope: scope))
    }
    @MainActor func testUnavailableRetirementVerifierPreservesAcknowledgedCiphertextAndJournal() async throws {
        let keychain = InMemoryKeychainStore(), response = try inboundResponse()
        let envelope = try XCTUnwrap(response.applied.first), scope = response.scope
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "reclaimer-unavailable")
        try inbox.capture(response, sessionDeviceId: scope.recipientDeviceId)
        try inbox.markAcknowledged(envelope, scope: scope)
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "reclaimer-unavailable")
        let intent = try journalIntent()
        try journal.prepare(intent)
        try journal.complete(intent, outcome: .applied, at: intent.preparedAt)
        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "reclaimer-unavailable",
            expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let verifier = RetirementVerifier(boundary: PCAInboundReplayRetirementBoundary(scope: scope,
            authorityBinding: Data([1]), minimumTrustSetEpoch: 0, minimumKeyEpoch: 0))
        verifier.available = false
        let reclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial, verifier: verifier)

        let reclaimed = try await reclaimer.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(reclaimed, 0)
        XCTAssertEqual(try inbox.pendingCrypto(scope: scope).count, 1)
        XCTAssertEqual(try journal.records().count, 1)
        let defaultReclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial)
        let defaultReclaimed = try await defaultReclaimer.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(defaultReclaimed, 0)
        XCTAssertEqual(try inbox.pendingCrypto(scope: scope).count, 1)
        XCTAssertEqual(try journal.records().count, 1)
        let nilReclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial, verifier: nil)
        let nilReclaimed = try await nilReclaimer.reclaim(scope: scope, assertAuthority: {})
        XCTAssertEqual(nilReclaimed, 0)
        XCTAssertEqual(try inbox.pendingCrypto(scope: scope).count, 1)
        XCTAssertEqual(try journal.records().count, 1)
        let legacy = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: ConsumerHandler())
        let unjournaled = try XCTUnwrap(inboundResponse(id: "still-pending").applied.first)
        XCTAssertEqual(try legacy.pending([PCAStoredInboundEnvelope(envelope: unjournaled, relayAcknowledged: true,
            processingState: "PENDING_CRYPTO")], scope: scope).count, 1)
    }
    @MainActor func testRetirementLedgerFailureAfterLatchPreservesRecordsAndBlocksLegacyConsumer() async throws {
        let keychain = JournalKeychain(), response = try inboundResponse()
        let envelope = try XCTUnwrap(response.applied.first), scope = response.scope
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "reclaimer-install-failure")
        try inbox.capture(response, sessionDeviceId: scope.recipientDeviceId)
        try inbox.markAcknowledged(envelope, scope: scope)
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "reclaimer-install-failure")
        let intent = try journalIntent()
        try journal.prepare(intent)
        try journal.complete(intent, outcome: .applied, at: intent.preparedAt)
        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "reclaimer-install-failure",
            expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let boundary = PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]),
            minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 1)])
        let reclaimer = try PCAInboundReplayReclaimer(journal: journal, inbox: inbox, denial: denial,
            verifier: RetirementVerifier(boundary: boundary))
        let legacy = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: ConsumerHandler())
        let authority: () throws -> Void = {
            if keychain.failingAccount == nil,
               (try? keychain.retrieve(forAccount: "required.inbound-application-retirement",
                    service: "reclaimer-install-failure.inbound-application")) != nil {
                keychain.failingAccount = "current.replay-denial"
            }
        }

        do {
            _ = try await reclaimer.reclaim(scope: scope, assertAuthority: authority)
            XCTFail("Denial persistence must fail after the retirement latch is installed")
        } catch { }
        keychain.failingAccount = nil
        XCTAssertEqual(try inbox.pendingCrypto(scope: scope).count, 1)
        XCTAssertEqual(try journal.records().count, 1)
        XCTAssertThrowsError(try legacy.pending([PCAStoredInboundEnvelope(envelope: envelope, relayAcknowledged: true,
            processingState: "PENDING_CRYPTO")], scope: scope))
    }
    @MainActor func testDuplicateConsumerCandidatesCannotInflateCompletionCount() async throws {
        let (envelope, scope) = try replayEnvelope()
        let journal = PCAInboundApplicationJournal(keychain: InMemoryKeychainStore(), serviceNamespace: "duplicate-candidates")
        let handler = ConsumerHandler()
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: handler)
        let candidate = PCAStoredInboundEnvelope(envelope: envelope, relayAcknowledged: true, processingState: "PENDING_CRYPTO")
        do {
            _ = try await consumer.consume([candidate, candidate], scope: scope, assertAuthority: {})
            XCTFail("Duplicate candidates must be rejected")
        } catch { }
        XCTAssertTrue(handler.applied.isEmpty); XCTAssertTrue(try journal.records().isEmpty)
    }
    @MainActor func testDeniedPreparedOperationReconcilesPriorEffectWithoutApplyingAgain() async throws {
        let keychain = InMemoryKeychainStore(), (envelope, scope) = try replayEnvelope()
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "denied-recovery")
        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "denied-recovery", expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let handler = ConsumerHandler(); handler.recovery = .unknown
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: handler, replayDenial: denial)
        let candidates = [PCAStoredInboundEnvelope(envelope: envelope, relayAcknowledged: true, processingState: "PENDING_CRYPTO")]
        let clock = { ISO8601DateFormatter().date(from: "2026-10-01T00:00:30Z")! }
        let pending = try await consumer.consume(candidates, scope: scope, now: clock, assertAuthority: {})
        XCTAssertEqual(pending, 0)
        let operation = try XCTUnwrap(journal.records().first?.intent.operationId)
        try denial.install(PCAInboundReplayRetirementBoundary(scope: scope, authorityBinding: Data([1]), minimumTrustSetEpoch: 0, minimumKeyEpoch: 0,
            closedNumericPrefixes: [PCAInboundReplayNumericPrefix(senderKeyId: "key-1", through: 1)]), assertAuthority: {})
        handler.recovery = .notApplied
        let denied = try await consumer.consume(candidates, scope: scope, now: clock, assertAuthority: {})
        XCTAssertEqual(denied, 0); XCTAssertTrue(handler.applied.isEmpty); XCTAssertNil(try journal.records().first?.outcome)
        handler.recovery = .completed(.applied)
        let recovered = try await consumer.consume(candidates, scope: scope, now: clock, assertAuthority: {})
        XCTAssertEqual(recovered, 1)
        XCTAssertEqual(try journal.records().first?.intent.operationId, operation)
        XCTAssertEqual(try journal.records().first?.outcome, .applied); XCTAssertTrue(handler.applied.isEmpty)
    }
    @MainActor func testDenialLossDuringSuspendedCompletedRecoveryPreventsReceiptPublication() async throws {
        let keychain = InMemoryKeychainStore(), (envelope, scope) = try replayEnvelope()
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "lost-denial")
        let denial = PCAInboundReplayDenialLedger(keychain: keychain, serviceNamespace: "lost-denial", expectedDeviceId: scope.recipientDeviceId)
        try denial.initializeFresh(assertAuthority: {})
        let handler = ConsumerHandler(); handler.recovery = .completed(.applied)
        let entered = expectation(description: "recovery suspended")
        var continuation: CheckedContinuation<Void, Never>?
        handler.suspendedReconcile = {
            await withCheckedContinuation { pending in continuation = pending; entered.fulfill() }
        }
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: handler, replayDenial: denial)
        let candidates = [PCAStoredInboundEnvelope(envelope: envelope, relayAcknowledged: true, processingState: "PENDING_CRYPTO")]
        let task = Task { try await consumer.consume(candidates, scope: scope,
            now: { ISO8601DateFormatter().date(from: "2026-10-01T00:00:30Z")! }, assertAuthority: {}) }
        await fulfillment(of: [entered], timeout: 2)
        try keychain.delete(forAccount: "current.replay-denial", service: "lost-denial.replay-denial")
        continuation?.resume()
        do { _ = try await task.value; XCTFail("Missing denial must prevent receipt") } catch { }
        XCTAssertTrue(handler.applied.isEmpty); XCTAssertNil(try journal.records().first?.outcome)
        XCTAssertEqual(try journal.records().count, 1)
    }
    @MainActor private final class ConsumerVerifier: PCAInboundCommandVerifying {
        var available: (PCAInboundEnvelope) -> Bool = { _ in true }
        var revalidate: () throws -> Void = {}
        func verify(_ envelope: PCAInboundEnvelope, scope: PCAInboundScope) async throws -> PCAInboundVerificationResult {
            guard available(envelope) else { return .unavailable }
            return .accepted(authorityBinding: Data("authority".utf8), commandBinding: Data("command".utf8), revalidateAuthority: revalidate)
        }
    }
    @MainActor private final class RetirementVerifier: PCAInboundRetirementVerifying {
        let boundary: PCAInboundReplayRetirementBoundary
        var available = true
        var revalidate: () throws -> Void = {}
        init(boundary: PCAInboundReplayRetirementBoundary) { self.boundary = boundary }
        func verify(scope: PCAInboundScope) async throws -> PCAInboundRetirementVerification {
            guard available else { return .unavailable }
            return .accepted(boundary: boundary, revalidateAuthority: revalidate)
        }
    }
    @MainActor private final class ConsumerHandler: PCAInboundCommandApplying {
        var applied: [String] = []
        var recovery: PCAInboundEffectRecovery = .notApplied
        var onReconcile: (() -> Void)?
        var suspendedReconcile: (() async -> Void)?
        var afterApply: (() -> Void)?
        func reconcile(_ intent: PCAInboundApplicationIntent) async throws -> PCAInboundEffectRecovery {
            onReconcile?(); await suspendedReconcile?(); return recovery
        }
        func apply(_ intent: PCAInboundApplicationIntent, assertAuthority: @escaping () throws -> Void) async throws -> PCAInboundApplicationOutcome {
            try assertAuthority(); applied.append(intent.operationId); afterApply?(); return .applied
        }
    }
    @MainActor func testUnavailableConsumerNeverPreparesOrAppliesCiphertext() async throws {
        let response = try inboundResponse()
        let journal = PCAInboundApplicationJournal(keychain: InMemoryKeychainStore(), serviceNamespace: "consumer")
        let handler = ConsumerHandler()
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: PCAUnavailableInboundCommandVerifier(), handler: handler)
        let count = try await consumer.consume(response.applied.map {
            PCAStoredInboundEnvelope(envelope: $0, relayAcknowledged: true, processingState: "PENDING_CRYPTO")
        }, scope: response.scope, assertAuthority: {})
        XCTAssertEqual(count, 0)
        XCTAssertTrue(try journal.records().isEmpty)
        XCTAssertTrue(handler.applied.isEmpty)
    }
    @MainActor func testConsumerReusesPreparedOperationAndDoesNotReplayTerminalEffect() async throws {
        let response = try inboundResponse(), handler = ConsumerHandler()
        let journal = PCAInboundApplicationJournal(keychain: InMemoryKeychainStore(), serviceNamespace: "consumer")
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: handler)
        let candidates = response.applied.map { PCAStoredInboundEnvelope(envelope: $0, relayAcknowledged: false, processingState: "PENDING_CRYPTO") }
        handler.recovery = .unknown
        let clock = { ISO8601DateFormatter().date(from: "2026-10-01T00:00:30Z")! }
        let pending = try await consumer.consume(candidates, scope: response.scope, now: clock, assertAuthority: {})
        XCTAssertEqual(pending, 0)
        let operation = try XCTUnwrap(journal.records().first?.intent.operationId)
        handler.recovery = .notApplied
        let applied = try await consumer.consume(candidates, scope: response.scope, now: clock, assertAuthority: {})
        XCTAssertEqual(applied, 1)
        XCTAssertEqual(handler.applied, [operation])
        let duplicate = try await consumer.consume(candidates, scope: response.scope, now: clock, assertAuthority: {})
        XCTAssertEqual(duplicate, 0)
        XCTAssertEqual(handler.applied, [operation])
    }
    @MainActor func testConsumerDoesNotApplyWhenAcceptanceExpiresDuringRecovery() async throws {
        let response = try inboundResponse(), handler = ConsumerHandler()
        let journal = PCAInboundApplicationJournal(keychain: InMemoryKeychainStore(), serviceNamespace: "consumer")
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: handler)
        let formatter = ISO8601DateFormatter()
        var clock = formatter.date(from: "2026-10-01T00:00:30Z")!
        handler.onReconcile = { clock = formatter.date(from: "2026-10-01T00:01:00Z")! }
        let count = try await consumer.consume(response.applied.map {
                PCAStoredInboundEnvelope(envelope: $0, relayAcknowledged: true, processingState: "PENDING_CRYPTO")
            }, scope: response.scope, now: { clock }, assertAuthority: {})
        XCTAssertEqual(count, 0)
        XCTAssertTrue(handler.applied.isEmpty)
        XCTAssertNil(try journal.records().first?.outcome)
    }
    @MainActor func testIndependentConsumersShareHostAdmissionCoordination() async throws {
        let response = try inboundResponse(), keychain = InMemoryKeychainStore(), handler = ConsumerHandler()
        let first = PCAInboundCommandConsumer(journal: PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "shared-admission"),
            verifier: ConsumerVerifier(), handler: handler)
        let second = PCAInboundCommandConsumer(journal: PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "shared-admission"),
            verifier: ConsumerVerifier(), handler: handler)
        let candidates = response.applied.map { PCAStoredInboundEnvelope(envelope: $0, relayAcknowledged: true, processingState: "PENDING_CRYPTO") }
        let clock = { ISO8601DateFormatter().date(from: "2026-10-01T00:00:30Z")! }
        let entered = expectation(description: "first consumer suspended")
        var continuation: CheckedContinuation<Void, Never>?
        handler.suspendedReconcile = {
            await withCheckedContinuation { pending in continuation = pending; entered.fulfill() }
        }
        let task = Task { try await first.consume(candidates, scope: response.scope, now: clock, assertAuthority: {}) }
        await fulfillment(of: [entered], timeout: 2)
        let overlapping = try await second.consume(candidates, scope: response.scope, now: clock, assertAuthority: {})
        XCTAssertEqual(overlapping, 0)
        XCTAssertTrue(handler.applied.isEmpty)
        continuation?.resume()
        let completed = try await task.value
        XCTAssertEqual(completed, 1)
        XCTAssertEqual(handler.applied.count, 1)
        let duplicate = try await second.consume(candidates, scope: response.scope, now: clock, assertAuthority: {})
        XCTAssertEqual(duplicate, 0)
        XCTAssertEqual(handler.applied.count, 1)
    }
    @MainActor func testConsumerSkipsTerminalPrefixAndProcessesLaterCandidates() async throws {
        let journal = PCAInboundApplicationJournal(keychain: InMemoryKeychainStore(), serviceNamespace: "consumer")
        let handler = ConsumerHandler()
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: handler)
        let candidates = try (0..<33).map { index in
            try PCAStoredInboundEnvelope(envelope: XCTUnwrap(inboundResponse(id: "message-\(index)").applied.first),
                relayAcknowledged: true, processingState: "PENDING_CRYPTO")
        }
        let scope = try inboundResponse().scope
        let clock = { ISO8601DateFormatter().date(from: "2026-10-01T00:00:30Z")! }
        let first = try await consumer.consume(candidates, scope: scope, now: clock, assertAuthority: {})
        let next = try await consumer.consume(candidates, scope: scope, now: clock, assertAuthority: {})
        XCTAssertEqual(first, 32)
        XCTAssertEqual(next, 1)
        XCTAssertEqual(handler.applied.count, 33)
    }
    @MainActor func testConsumerFairCursorSurvivesRestartAcrossUnavailablePrefix() async throws {
        let keychain = InMemoryKeychainStore(), verifier = ConsumerVerifier(), handler = ConsumerHandler()
        verifier.available = { $0.messageId == "message-32" }
        let candidates = try (0..<33).map { index in
            try PCAStoredInboundEnvelope(envelope: XCTUnwrap(inboundResponse(id: "message-\(index)").applied.first),
                relayAcknowledged: true, processingState: "PENDING_CRYPTO")
        }
        let scope = try inboundResponse().scope
        let clock = { ISO8601DateFormatter().date(from: "2026-10-01T00:00:30Z")! }
        let first = PCAInboundCommandConsumer(journal: PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "fair"),
            verifier: verifier, handler: handler)
        let count = try await first.consume(candidates, scope: scope, now: clock, assertAuthority: {})
        XCTAssertEqual(count, 0)
        let restored = PCAInboundCommandConsumer(journal: PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "fair"),
            verifier: verifier, handler: handler)
        let next = try await restored.consume(candidates, scope: scope, now: clock, assertAuthority: {})
        XCTAssertEqual(next, 1)
        XCTAssertEqual(handler.applied.count, 1)
    }
    @MainActor func testConsumerRechecksVerifierAuthorityAfterRecoverySuspension() async throws {
        let response = try inboundResponse(), verifier = ConsumerVerifier(), handler = ConsumerHandler()
        let journal = PCAInboundApplicationJournal(keychain: InMemoryKeychainStore(), serviceNamespace: "authority")
        var valid = true
        verifier.revalidate = { if !valid { throw PCAInboundInboxError.unavailable } }
        let began = expectation(description: "recovery suspended")
        var resume: CheckedContinuation<Void, Never>?
        handler.suspendedReconcile = {
            await withCheckedContinuation { continuation in resume = continuation; began.fulfill() }
        }
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: verifier, handler: handler)
        let attempt = Task { @MainActor in
            try await consumer.consume(response.applied.map {
                PCAStoredInboundEnvelope(envelope: $0, relayAcknowledged: false, processingState: "PENDING_CRYPTO")
            }, scope: response.scope, now: { ISO8601DateFormatter().date(from: "2026-10-01T00:00:30Z")! }, assertAuthority: {})
        }
        await fulfillment(of: [began], timeout: 5)
        valid = false
        resume?.resume()
        do {
            _ = try await attempt.value
            XCTFail("Changed signer/epoch authority must stop processing")
        } catch {}
        XCTAssertTrue(handler.applied.isEmpty)
        XCTAssertNil(try journal.records().first?.outcome)
    }
    @MainActor func testConsumerRecoversEffectAfterFailedTerminalWriteWithoutReapplying() async throws {
        let response = try inboundResponse(), verifier = ConsumerVerifier(), handler = ConsumerHandler()
        let keychain = JournalKeychain()
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "recovery")
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: verifier, handler: handler)
        let candidates = response.applied.map { PCAStoredInboundEnvelope(envelope: $0, relayAcknowledged: true, processingState: "PENDING_CRYPTO") }
        let clock = { ISO8601DateFormatter().date(from: "2026-10-01T00:00:30Z")! }
        handler.afterApply = { keychain.ignoreWrites = true }
        do {
            _ = try await consumer.consume(candidates, scope: response.scope, now: clock, assertAuthority: {})
            XCTFail("Completion readback must fail")
        } catch {}
        let operation = try XCTUnwrap(journal.records().first?.intent.operationId)
        XCTAssertEqual(handler.applied, [operation])
        XCTAssertNil(try journal.records().first?.outcome)
        keychain.ignoreWrites = false
        handler.recovery = .completed(.applied)
        let restored = PCAInboundCommandConsumer(journal: PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "recovery"),
            verifier: verifier, handler: handler)
        let recovered = try await restored.consume(candidates, scope: response.scope, now: clock, assertAuthority: {})
        XCTAssertEqual(recovered, 1)
        XCTAssertEqual(handler.applied, [operation])
        XCTAssertEqual(try journal.records().first?.outcome, .applied)
    }
    @MainActor func testHostRecoversRetainedIntentBeforeFailedNetworkAcknowledgement() async throws {
        let response = try inboundResponse(), state = InMemoryPCADeviceStateStore()
        try state.saveSession(PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(600)))
        let inbox = PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "host-recovery")
        try inbox.capture(response, sessionDeviceId: "device-1")
        let journal = PCAInboundApplicationJournal(keychain: InMemoryKeychainStore(), serviceNamespace: "host-recovery")
        let intent = PCAInboundApplicationIntent(operationId: UUID().uuidString.lowercased(), scope: response.scope,
            envelope: try XCTUnwrap(response.applied.first), authorityBinding: Data("authority".utf8),
            acceptedCommandBinding: Data("command".utf8), preparedAt: Date().addingTimeInterval(-60))
        try journal.prepare(intent)
        let handler = ConsumerHandler(); handler.recovery = .completed(.applied)
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: handler)
        var networkCalls = 0
        let transport = InMemoryPCAHTTPTransport { _ in networkCalls += 1; throw PCAHTTPTransportError.network }
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: state,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
            inboundInbox: inbox, inboundConsumer: consumer)
        _ = try await model.synchronizeRuntimeCampaign()
        XCTAssertEqual(try journal.records().first?.outcome, .applied)
        XCTAssertTrue(handler.applied.isEmpty)
        XCTAssertEqual(networkCalls, 1)
        XCTAssertEqual(try inbox.pendingAcknowledgements(scope: response.scope).count, 1)
        XCTAssertNotEqual(model.dependencies.protectionRuntime.status, .active)
    }
    @MainActor func testHostSessionReplacementDuringInboundRecoveryPreservesPendingIntentAndCustody() async throws {
        let state = InMemoryPCADeviceStateStore()
        let session = PCADeviceSession(deviceId: "device-1", sessionToken: "old-session", expiresAt: Date().addingTimeInterval(600))
        let replacement = PCADeviceSession(deviceId: "device-1", sessionToken: "new-session", expiresAt: Date().addingTimeInterval(600))
        try state.saveSession(session)
        let response = try inboundResponse()
        let keychain = InMemoryKeychainStore()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "host-recovery-authority")
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "host-recovery-authority")
        let envelope = try XCTUnwrap(response.applied.first)
        let intent = PCAInboundApplicationIntent(operationId: UUID().uuidString.lowercased(), scope: response.scope,
            envelope: envelope, authorityBinding: Data("authority".utf8),
            acceptedCommandBinding: Data("command".utf8), preparedAt: Date())
        try journal.prepare(intent)

        let handler = ConsumerHandler()
        handler.recovery = .completed(.applied)
        let recoveryBegan = expectation(description: "host recovery suspended")
        var resumeRecovery: CheckedContinuation<Void, Never>?
        handler.suspendedReconcile = {
            await withCheckedContinuation { continuation in
                resumeRecovery = continuation
                recoveryBegan.fulfill()
            }
        }
        let consumer = PCAInboundCommandConsumer(journal: journal, verifier: ConsumerVerifier(), handler: handler)
        let responseData = try JSONSerialization.data(withJSONObject: [
            "scope": ["familyId": response.scope.familyId, "recipientDeviceId": response.scope.recipientDeviceId],
            "applied": [try JSONSerialization.jsonObject(with: JSONEncoder().encode(envelope))],
            "unparseableMessageIds": [], "droppedForListBound": []
        ])
        var pulls = 0
        var acknowledgements = 0
        let transport = InMemoryPCAHTTPTransport { request in
            if request.httpMethod == "GET" {
                pulls += 1
                return PCAHTTPResponse(statusCode: 200, data: responseData)
            }
            if request.url?.path.hasSuffix("/ack") == true { acknowledgements += 1 }
            return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
        }
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: state,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
            inboundInbox: inbox, inboundConsumer: consumer)

        let synchronization = Task { @MainActor in try await model.synchronizeRuntimeCampaign() }
        await fulfillment(of: [recoveryBegan], timeout: 5)
        try state.saveSession(replacement)
        resumeRecovery?.resume()

        let outcome = try await synchronization.value
        XCTAssertEqual(outcome, .retryableFailure)
        XCTAssertEqual(try state.loadSession(), replacement)
        XCTAssertEqual(pulls, 1)
        XCTAssertEqual(acknowledgements, 0)
        XCTAssertTrue(handler.applied.isEmpty)
        let retainedIntent = try XCTUnwrap(journal.records().first)
        XCTAssertEqual(retainedIntent.intent, intent)
        XCTAssertNil(retainedIntent.outcome)
        XCTAssertEqual(try inbox.pendingCrypto(scope: response.scope).map(\.envelope), [envelope])
        XCTAssertEqual(try inbox.pendingAcknowledgements(scope: response.scope).map(\.envelope), [envelope])
        XCTAssertNotEqual(model.dependencies.protectionRuntime.status, .active)
    }
    private func journalIntent(id: String = "message-1", operationId: String = UUID().uuidString.lowercased()) throws -> PCAInboundApplicationIntent {
        let response = try inboundResponse(id: id)
        return PCAInboundApplicationIntent(operationId: operationId, scope: response.scope,
            envelope: try XCTUnwrap(response.applied.first), authorityBinding: Data("accepted-context".utf8),
            acceptedCommandBinding: Data("accepted-command".utf8), preparedAt: Date(timeIntervalSince1970: 1_760_000_000))
    }
    func testApplicationJournalRestoresPreparedIntentWithoutClaimingApplied() throws {
        let keychain = InMemoryKeychainStore()
        let intent = try journalIntent()
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "journal")
        try journal.prepare(intent)
        try journal.prepare(intent)
        let restored = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "journal")
        let record = try XCTUnwrap(restored.records().first)
        XCTAssertEqual(record.intent, intent)
        XCTAssertNil(record.outcome)
        XCTAssertNil(record.completedAt)
        XCTAssertEqual(try restored.records().count, 1)
    }
    func testApplicationJournalRequiresPreparedIdentityAndImmutableTerminalOutcome() throws {
        let journal = PCAInboundApplicationJournal(keychain: InMemoryKeychainStore(), serviceNamespace: "journal")
        let intent = try journalIntent()
        XCTAssertThrowsError(try journal.complete(intent, outcome: .applied, at: intent.preparedAt))
        try journal.prepare(intent)
        XCTAssertThrowsError(try journal.prepare(journalIntent())) // Conflicting operation for identical message.
        XCTAssertThrowsError(try journal.complete(intent, outcome: .applied, at: intent.preparedAt.addingTimeInterval(-1)))
        try journal.complete(intent, outcome: .applied, at: intent.preparedAt.addingTimeInterval(1))
        try journal.complete(intent, outcome: .applied, at: intent.preparedAt.addingTimeInterval(2))
        XCTAssertThrowsError(try journal.complete(intent, outcome: .rejected, at: intent.preparedAt.addingTimeInterval(2)))
        XCTAssertEqual(try journal.records().first?.completedAt, intent.preparedAt.addingTimeInterval(1))
    }
    func testApplicationJournalRetainsDistinctOpaqueUnicodeMessageIdentities() throws {
        let journal = PCAInboundApplicationJournal(keychain: InMemoryKeychainStore(), serviceNamespace: "journal")
        try journal.prepare(journalIntent(id: "é"))
        try journal.prepare(journalIntent(id: "e\u{301}"))
        XCTAssertEqual(try journal.records().count, 2)
    }
    func testFullApplicationJournalPreservesEveryTerminalReplayReceipt() throws {
        let keychain = InMemoryKeychainStore()
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "capacity")
        for index in 0..<64 {
            let intent = try journalIntent(id: "completed-\(index)")
            try journal.prepare(intent)
            try journal.complete(intent, outcome: .applied, at: intent.preparedAt)
        }
        let original = try journal.records()
        XCTAssertEqual(original.count, 64)
        XCTAssertThrowsError(try journal.prepare(journalIntent(id: "next-command")))
        let restored = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "capacity")
        XCTAssertEqual(try restored.records(), original)
        XCTAssertTrue(try restored.records().allSatisfy { $0.outcome == .applied })
    }
    private final class JournalKeychain: KeychainStoreProtocol {
        let underlying = InMemoryKeychainStore()
        var ignoreWrites = false
        var failingAccount: String?
        func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
            if account == failingAccount { throw KeychainStoreError.unexpectedStatus(-1) }
            if !ignoreWrites { try underlying.store(data, forAccount: account, service: service, accessibility: accessibility) }
        }
        func retrieve(forAccount account: String, service: String) throws -> Data {
            try underlying.retrieve(forAccount: account, service: service)
        }
        func delete(forAccount account: String, service: String) throws { try underlying.delete(forAccount: account, service: service) }
    }
    func testFailedJournalCompletionRestoresSamePreparedOperationForRecovery() throws {
        let keychain = JournalKeychain(), intent = try journalIntent()
        let journal = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "journal")
        keychain.ignoreWrites = true
        XCTAssertThrowsError(try journal.prepare(intent))
        XCTAssertTrue(try journal.records().isEmpty)
        keychain.ignoreWrites = false
        try journal.prepare(intent)
        keychain.ignoreWrites = true
        XCTAssertThrowsError(try journal.complete(intent, outcome: .applied, at: intent.preparedAt))
        let restored = PCAInboundApplicationJournal(keychain: keychain, serviceNamespace: "journal")
        XCTAssertEqual(try restored.records().first?.intent.operationId, intent.operationId)
        XCTAssertNil(try restored.records().first?.outcome)
        keychain.ignoreWrites = false
        try restored.complete(intent, outcome: .applied, at: intent.preparedAt)
        XCTAssertEqual(try journal.records().first?.outcome, .applied)
    }
    func testJournalRejectsChangedAuthorityAndNoncanonicalOperationId() throws {
        let journal = PCAInboundApplicationJournal(keychain: InMemoryKeychainStore(), serviceNamespace: "journal")
        let intent = try journalIntent()
        try journal.prepare(intent)
        let changed = PCAInboundApplicationIntent(operationId: intent.operationId, scope: intent.scope,
            envelope: intent.envelope, authorityBinding: Data("other-context".utf8),
            acceptedCommandBinding: intent.acceptedCommandBinding, preparedAt: intent.preparedAt)
        XCTAssertThrowsError(try journal.prepare(changed))
        XCTAssertThrowsError(try journal.prepare(journalIntent(id: "other", operationId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")))
        XCTAssertEqual(try journal.records().count, 1)
    }
    private final class UsageRuntime: PCAProtectionPolicyRuntime {
        var status: DeviceActivityUsageMonitorStatus = .expired
        var renewals = 0
        var fails = false
        var result: PCAProtectionPolicyApplicationResult = .degraded
        func applyVerifiedPolicy(scheduleData: Data, applicationTokenData: Data,
            protectedApplicationTokenData: Data?, now: Date) throws -> PCAProtectionPolicyApplicationResult { .degraded }
        func clearPolicy(activityId: String) {}
        func callbackHealth(now: Date) -> DeviceActivityCallbackHealth { .unknown }
        func usageMonitorStatus(now: Date) -> DeviceActivityUsageMonitorStatus { status }
        func renewInstalledUsageMonitor(now: Date) throws -> PCAProtectionPolicyApplicationResult {
            renewals += 1
            if fails { throw PCAProtectionPolicyApplicationError.schedulingFailed }
            status = .planned(.wholePolicyDayPlanned)
            return result
        }
    }
    @MainActor func testHostLaunchAndForegroundRenewOnlyExpiredOrChangedUsagePlans() throws {
        let runtime = UsageRuntime()
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(), policyRuntime: runtime)
        model.start()
        XCTAssertEqual(runtime.renewals, 1)
        model.start()
        XCTAssertEqual(runtime.renewals, 1)
        model.sceneBecameActive()
        XCTAssertEqual(runtime.renewals, 1)
        runtime.status = .deviceTimeZoneChanged
        model.sceneBecameActive()
        XCTAssertEqual(runtime.renewals, 2)
        runtime.status = .unavailable
        model.sceneBecameActive()
        XCTAssertEqual(runtime.renewals, 2)
    }
    @MainActor func testFailedHostRenewalRemainsRetryableOnNextForeground() throws {
        let runtime = UsageRuntime()
        runtime.fails = true
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(), policyRuntime: runtime)
        model.start()
        XCTAssertEqual(runtime.renewals, 1)
        runtime.fails = false
        XCTAssertEqual(model.dependencies.protectionRuntime.status, .degraded)
        model.sceneBecameActive()
        XCTAssertEqual(runtime.renewals, 2)
    }
    @MainActor func testDeniedAuthorizationDoesNotRenewUsageMonitor() throws {
        let runtime = UsageRuntime()
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(), policyRuntime: runtime, authorizationStatus: .denied)
        model.start()
        model.sceneBecameActive()
        XCTAssertEqual(runtime.renewals, 0)
        XCTAssertEqual(model.dependencies.protectionRuntime.status, .degraded)
    }
    @MainActor func testRenewalDoesNotPromoteProtectionAndNonAppliedResultsDegrade() throws {
        for result in [PCAProtectionPolicyApplicationResult.applied, .scheduledOnly, .degraded] {
            let runtime = UsageRuntime()
            runtime.result = result
            let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(),
                attemptStore: InMemoryPCADeviceStateStore(), policyRuntime: runtime)
            model.start()
            XCTAssertEqual(runtime.renewals, 1)
            XCTAssertNotEqual(model.dependencies.protectionRuntime.status, .active)
            if result != .applied { XCTAssertEqual(model.dependencies.protectionRuntime.status, .degraded) }
        }
    }
    func testFirstDeviceTrustRootRequiresExplicitApprovalAndDoesNotPromoteLifecycle() async throws {
        let rootStore = InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(seed: trustRootSeed()))
        let api = TrustRootFlowApi()
        api.challengeResponse = FirstDeviceChallengeResponse(
            ceremonyId: "33333333-3333-4333-8333-333333333333",
            challengeId: "44444444-4444-4444-8444-444444444444",
            nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            expiresAt: "2026-10-02T00:00:00.000Z",
            familyId: "11111111-1111-4111-8111-111111111111",
            deviceId: "device-1"
        )
        api.statusResponse = FirstDeviceStatusResponse(status: "APPROVED", outcome: nil)
        api.submitResponse = FirstDeviceSubmitResponse(status: "ACCEPTED")
        let keyMaterial = TrustRootFlowKeyMaterial()
        let evidence = TrustRootFlowEvidenceBuilder()
        let coordinator = try XCTUnwrap(PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: rootStore,
            apiClient: api,
            keyMaterial: keyMaterial,
            evidenceBuilder: evidence,
            appAttestIsSupported: true
        ))
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(),
            firstDeviceRootStore: rootStore,
            firstDeviceTrustRootCoordinator: coordinator
        )

        model.start()
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(api.challengeCalls, 0, "launch must not request parent approval")
        XCTAssertEqual(api.statusCalls, 0, "launch must not poll for approval")
        XCTAssertTrue(api.submissions.isEmpty)

        await model.submitApprovedFirstDeviceRoot()
        XCTAssertTrue(api.submissions.isEmpty, "submit is forbidden until the durable record is APPROVED")

        await model.requestFirstDeviceParentApproval()
        XCTAssertEqual(api.challengeCalls, 1)
        XCTAssertEqual(rootStore.current()?.state, .awaitingApproval)
        XCTAssertEqual(api.statusCalls, 0)

        await model.checkFirstDeviceParentApproval()
        XCTAssertEqual(api.statusCalls, 1)
        XCTAssertEqual(rootStore.current()?.state, .approved)
        XCTAssertTrue(api.submissions.isEmpty, "observing APPROVED must not auto-submit")

        await model.submitApprovedFirstDeviceRoot()
        XCTAssertEqual(api.submissions.count, 1)
        XCTAssertEqual(rootStore.current()?.state, .rootCommitted)
        XCTAssertEqual(model.firstDeviceRootRecord?.state, .rootCommitted)
        XCTAssertEqual(model.dependencies.protectionRuntime.status, .notReady, "root acceptance does not activate device lifecycle or protection")
        XCTAssertEqual(keyMaterial.signCount, 2)
        XCTAssertEqual(evidence.callCount, 1)
    }

    func testFirstDeviceTrustRootRetryReplaysPersistedSubmissionExactly() async throws {
        let payload = FirstDeviceSubmissionPayload(
            proofBytes: "saved-proof", proofSignature: "saved-proof-signature",
            epoch1Bytes: "saved-epoch", epoch1Signature: "saved-epoch-signature",
            attestationEvidence: "saved-evidence"
        )
        let rootStore = InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(
            seed: trustRootSeed(), state: .unknown,
            ceremonyId: "33333333-3333-4333-8333-333333333333",
            submission: payload
        ))
        let api = TrustRootFlowApi()
        api.submitResponse = FirstDeviceSubmitResponse(status: "ACCEPTED")
        let keyMaterial = TrustRootFlowKeyMaterial()
        let evidence = TrustRootFlowEvidenceBuilder()
        let coordinator = try XCTUnwrap(PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: rootStore,
            apiClient: api,
            keyMaterial: keyMaterial,
            evidenceBuilder: evidence,
            appAttestIsSupported: true
        ))
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(),
            firstDeviceRootStore: rootStore,
            firstDeviceTrustRootCoordinator: coordinator
        )

        await model.retrySavedFirstDeviceRootSubmission()

        XCTAssertEqual(api.submissions, [payload])
        XCTAssertEqual(keyMaterial.signCount, 0, "replay must not sign replacement bytes")
        XCTAssertEqual(evidence.callCount, 0, "replay must not rebuild App Attest evidence")
        XCTAssertEqual(rootStore.current()?.state, .rootCommitted)
    }

    func testExplicitParentApprovalRetryRecoversUnknownWithoutCeremonyId() async throws {
        let rootStore = InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(seed: trustRootSeed()))
        let api = TrustRootFlowApi()
        api.challengeError = .ambiguousOutcome
        let coordinator = try XCTUnwrap(PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: rootStore,
            apiClient: api,
            keyMaterial: TrustRootFlowKeyMaterial(),
            evidenceBuilder: TrustRootFlowEvidenceBuilder(),
            appAttestIsSupported: true
        ))
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(),
            firstDeviceRootStore: rootStore,
            firstDeviceTrustRootCoordinator: coordinator
        )

        await model.requestFirstDeviceParentApproval()
        XCTAssertEqual(rootStore.current()?.state, .unknown)
        XCTAssertNil(rootStore.current()?.ceremonyId)
        XCTAssertNil(rootStore.current()?.submission)
        XCTAssertEqual(api.challengeCalls, 1)

        api.challengeError = nil
        await model.requestFirstDeviceParentApproval()
        XCTAssertEqual(api.challengeCalls, 2, "only another explicit user action retries this ambiguous pre-challenge state")
        XCTAssertEqual(rootStore.current()?.state, .awaitingApproval)
        XCTAssertEqual(api.statusCalls, 0)
        XCTAssertTrue(api.submissions.isEmpty)
    }

    func testUnknownCeremonyWithIdRemainsStatusOnly() async throws {
        let rootStore = InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(
            seed: trustRootSeed(), state: .unknown, ceremonyId: "existing-ceremony"
        ))
        let api = TrustRootFlowApi()
        api.statusResponse = FirstDeviceStatusResponse(status: "APPROVED", outcome: nil)
        let coordinator = try XCTUnwrap(PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: rootStore,
            apiClient: api,
            keyMaterial: TrustRootFlowKeyMaterial(),
            evidenceBuilder: TrustRootFlowEvidenceBuilder(),
            appAttestIsSupported: true
        ))
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(),
            firstDeviceRootStore: rootStore,
            firstDeviceTrustRootCoordinator: coordinator
        )

        await model.requestFirstDeviceParentApproval()
        XCTAssertEqual(api.challengeCalls, 0, "an existing ceremony id must never be replaced by a new challenge")
        XCTAssertEqual(api.statusCalls, 0)

        await model.checkFirstDeviceParentApproval()
        XCTAssertEqual(api.challengeCalls, 0)
        XCTAssertEqual(api.statusCalls, 1)
        XCTAssertEqual(rootStore.current()?.state, .approved)
    }

    func testUnsupportedAppAttestCompositionFailsClosed() throws {
        let result = PCAFirstDeviceTrustRootComposition.makeCoordinator(
            rootStore: InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(seed: trustRootSeed())),
            apiClient: TrustRootFlowApi(),
            keyMaterial: TrustRootFlowKeyMaterial(),
            evidenceBuilder: TrustRootFlowEvidenceBuilder(),
            appAttestIsSupported: false
        )
        XCTAssertNil(result)
    }

    func testNullCoordinatorSnapshotRereadsDurableStateAndCannotEraseKnownState() async throws {
        let rootStore = SwitchableFirstDeviceRootStore()
        let coordinator = ManualTrustRootCoordinator()
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(),
            attemptStore: InMemoryPCADeviceStateStore(),
            firstDeviceRootStore: rootStore,
            firstDeviceTrustRootCoordinator: coordinator
        )
        let record = FirstDeviceRootRecord(seed: trustRootSeed(), state: .awaitingApproval, ceremonyId: "ceremony")

        XCTAssertNil(model.firstDeviceRootRecord)
        XCTAssertTrue(rootStore.save(record))
        coordinator.onRecordChanged?(nil)
        for _ in 0..<100 where model.firstDeviceRootRecord == nil {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(model.firstDeviceRootRecord, record, "nil coordinator snapshots must trigger a durable-store read")

        rootStore.failCurrent = true
        coordinator.onRecordChanged?(nil)
        try? await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(model.firstDeviceRootRecord, record, "a failed durable read must not erase a previously verified state")
        XCTAssertTrue(model.firstDeviceRootReadUnavailable, "a stale cached record must not be presented as current")
    }

    func testBootstrapBuildsExistingBackendContractWithoutLoggingSecrets() async throws {
        let response = #"{"deviceId":"device-1","signingKeyId":"key-1","encryptionKeyId":"key-2","status":"PAIRING_PENDING","childProfileId":"child-1","ageUxTier":"TEEN","initialPolicyProfile":"BALANCED"}"#.data(using: .utf8)!
        let transport = InMemoryPCAHTTPTransport { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/v1/enrollment/bootstrap")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertFalse(try XCTUnwrap(request.httpBody).isEmpty)
            return PCAHTTPResponse(statusCode: 201, data: response)
        }
        let client = try PCAEnrollmentBootstrapClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
        let result = try await client.bootstrap(PCAEnrollmentBootstrapRequest(
            rawInvitationToken: String(repeating: "a", count: 43),
            signingPublicKey: "dsk-public",
            encryptionPublicKey: "dek-public",
            bootstrapAttemptId: String(repeating: "b", count: 16),
            attemptRecoveryToken: String(repeating: "c", count: 32)
        ))
        XCTAssertEqual(result.deviceId, "device-1")
        XCTAssertEqual(result.signingKeyId, "key-1")
        XCTAssertEqual(result.encryptionKeyId, "key-2")
        XCTAssertEqual(result.status, "PAIRING_PENDING")
        XCTAssertEqual(result.ageUxTier, .teen)
    }

    func testBootstrapMapsUnauthorizedWithoutExposingResponseBody() async throws {
        let secretLookingBody = Data(#"{"error":"session-token-should-never-be-presented"}"#.utf8)
        let transport = InMemoryPCAHTTPTransport { _ in PCAHTTPResponse(statusCode: 401, data: secretLookingBody) }
        let client = try PCAEnrollmentBootstrapClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
        do {
            _ = try await client.bootstrap(PCAEnrollmentBootstrapRequest(rawInvitationToken: "token", signingPublicKey: "dsk", encryptionPublicKey: "dek", bootstrapAttemptId: "attempt", attemptRecoveryToken: "recovery"))
            XCTFail("expected unauthorized")
        } catch let error as PCAAPIError {
            XCTAssertEqual(error, .unauthorized)
            XCTAssertFalse(String(describing: error).contains("session-token"))
        }
    }

    func testBootstrapAndRecoveryRejectLaterLifecycleStatuses() async throws {
        for status in ["PAIRED", "ACTIVE", "REVOKED"] {
            let response = Data("{\"deviceId\":\"device-1\",\"status\":\"\(status)\",\"childProfileId\":\"child-1\",\"ageUxTier\":\"TEEN\",\"initialPolicyProfile\":\"BALANCED\"}".utf8)
            let transport = InMemoryPCAHTTPTransport { _ in PCAHTTPResponse(statusCode: 200, data: response) }
            let client = try PCAEnrollmentBootstrapClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)

            do {
                _ = try await client.bootstrap(PCAEnrollmentBootstrapRequest(rawInvitationToken: "token", signingPublicKey: "dsk", encryptionPublicKey: "dek", bootstrapAttemptId: "attempt", attemptRecoveryToken: "recovery"))
                XCTFail("bootstrap accepted \(status)")
            } catch let error as PCAAPIError {
                XCTAssertEqual(error, .malformedResponse)
            }

            do {
                _ = try await client.recover(attemptId: "attempt", attemptRecoveryToken: "recovery")
                XCTFail("recovery accepted \(status)")
            } catch let error as PCAAPIError {
                XCTAssertEqual(error, .malformedResponse)
            }
        }
    }

    func testLaterLifecycleBootstrapDoesNotPersistDeviceIdentity() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let model = try makeEnrollmentModel(identityStore: identityStore, attemptStore: InMemoryPCADeviceStateStore())
        model.start()

        let token = String(repeating: "A", count: 43)
        XCTAssertTrue(model.receiveEnrollmentLink(URL(string: "https://enroll.pca.app/\(token)")!))
        await waitForRejectedEnrollment(model)

        XCTAssertNil(identityStore.loadDeviceId())
        XCTAssertTrue(identityStore.savedDeviceIds.isEmpty)
    }

    func testLaterLifecycleRecoveryDoesNotPersistDeviceIdentity() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let attemptStore = InMemoryPCADeviceStateStore()
        try attemptStore.saveAttempt(PCAEnrollmentAttempt(attemptId: "attempt", attemptRecoveryToken: "recovery"))
        let model = try makeEnrollmentModel(identityStore: identityStore, attemptStore: attemptStore)
        model.start()
        await waitForRejectedEnrollment(model)

        XCTAssertNil(identityStore.loadDeviceId())
        XCTAssertTrue(identityStore.savedDeviceIds.isEmpty)
    }

    func testSeedPersistenceFailureKeepsEnrollmentAttemptRecoverableAndDoesNotPublishDeviceIdentity() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let attemptStore = InMemoryPCADeviceStateStore()
        let failedRootStore = SwitchableFirstDeviceRootStore()
        let model = try makeEnrollmentModel(
            identityStore: identityStore,
            attemptStore: attemptStore,
            firstDeviceRootStore: failedRootStore,
            bootstrapStatus: "PAIRING_PENDING"
        )
        model.start()

        let token = String(repeating: "A", count: 43)
        XCTAssertTrue(model.receiveEnrollmentLink(URL(string: "https://enroll.pca.app/\(token)")!))
        await waitForRecoverableEnrollment(model)

        XCTAssertTrue(identityStore.savedDeviceIds.isEmpty, "identity must not be committed before the ceremony seed is durable")
        XCTAssertNotNil(try attemptStore.loadAttempt(), "the recovery credential pair must remain available for a retry")
        XCTAssertNil(failedRootStore.current())
    }

    func testMissingDskOrDekPublicMaterialKeepsEnrollmentAttemptBehindSecurityGate() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let attemptStore = InMemoryPCADeviceStateStore()
        let rootStore = InMemoryFirstDeviceRootStore()
        let model = try makeEnrollmentModel(
            identityStore: identityStore,
            attemptStore: attemptStore,
            firstDeviceRootStore: rootStore,
            proofProvider: EmptyEnrollmentProofProvider(),
            bootstrapStatus: "PAIRING_PENDING"
        )
        model.start()
        XCTAssertTrue(model.receiveEnrollmentLink(URL(string: "https://enroll.pca.app/\(String(repeating: "A", count: 43))")!))
        await waitForEnrollmentSecurityGate(model)

        XCTAssertNil(rootStore.current())
        XCTAssertTrue(identityStore.savedDeviceIds.isEmpty)
        XCTAssertNotNil(try attemptStore.loadAttempt())
    }

    func testSeedPersistenceFailureCanRecoverInTheSameProcessAfterStorageRecovers() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let attemptStore = InMemoryPCADeviceStateStore()
        let rootStore = SwitchableFirstDeviceRootStore()
        let model = try makeEnrollmentModel(
            identityStore: identityStore,
            attemptStore: attemptStore,
            firstDeviceRootStore: rootStore,
            bootstrapStatus: "PAIRING_PENDING"
        )
        model.start()

        let token = String(repeating: "A", count: 43)
        XCTAssertTrue(model.receiveEnrollmentLink(URL(string: "https://enroll.pca.app/\(token)")!))
        await waitForRecoverableEnrollment(model)
        XCTAssertTrue(identityStore.savedDeviceIds.isEmpty)
        XCTAssertNotNil(try attemptStore.loadAttempt())

        rootStore.failCapture = false
        model.sceneBecameActive()
        await waitForEnrollmentInProgress(model)

        XCTAssertEqual(rootStore.current()?.seed.deviceId, "device-1")
        XCTAssertEqual(identityStore.savedDeviceIds, ["device-1"])
        XCTAssertNotNil(try attemptStore.loadAttempt(), "profile confirmation remains the owner of pending-attempt cleanup")
    }

    func testSameAttemptRecoveryPreservesTheCompleteProgressedRootRecord() async throws {
        let identityStore = RecordingDeviceIdentityStore()
        let attemptStore = InMemoryPCADeviceStateStore()
        let attempt = PCAEnrollmentAttempt(attemptId: "attempt", attemptRecoveryToken: "recovery")
        try attemptStore.saveAttempt(attempt)
        let seed = FirstDeviceCeremonySeed(
            attemptId: attempt.attemptId,
            attemptRecoveryToken: attempt.attemptRecoveryToken,
            serverBaseUrl: "https://api.example.test",
            deviceId: "device-1",
            signingKeyId: "key-1",
            encryptionKeyId: "key-2",
            dskPublicKeyBase64: "dsk",
            dekPublicKeyBase64: "dek",
            dskAlias: "pca.dsk.attempt",
            dekAlias: "pca.dek.attempt"
        )
        let progressed = FirstDeviceRootRecord(
            seed: seed,
            state: .submitting,
            ceremonyId: "ceremony-1",
            challengeId: "challenge-1",
            nonce: "nonce-1",
            expiresAt: "2026-10-02T01:00:00.000Z",
            familyId: "family-1",
            submission: FirstDeviceSubmissionPayload(
                proofBytes: "proof", proofSignature: "proof-signature",
                epoch1Bytes: "epoch", epoch1Signature: "epoch-signature",
                attestationEvidence: "evidence"
            )
        )
        let rootStore = InMemoryFirstDeviceRootStore(record: progressed)
        let model = try makeEnrollmentModel(
            identityStore: identityStore,
            attemptStore: attemptStore,
            firstDeviceRootStore: rootStore,
            bootstrapStatus: "PAIRING_PENDING"
        )

        model.start()
        await waitForEnrollmentInProgress(model)

        XCTAssertEqual(rootStore.current(), progressed)
        XCTAssertEqual(identityStore.savedDeviceIds, ["device-1"])
    }

    func testCompetingEnrollmentPreservesActiveOrCommittedRoot() async throws {
        for state in [FirstDeviceRootState.awaitingApproval, .approved, .submitting, .unknown, .rootCommitted] {
            let identityStore = RecordingDeviceIdentityStore()
            let attemptStore = InMemoryPCADeviceStateStore()
            try attemptStore.saveAttempt(PCAEnrollmentAttempt(attemptId: "new-attempt", attemptRecoveryToken: "new-recovery"))
            let submission: FirstDeviceSubmissionPayload? = (state == .submitting || state == .unknown)
                ? FirstDeviceSubmissionPayload(
                    proofBytes: "saved-proof", proofSignature: "saved-signature",
                    epoch1Bytes: "saved-epoch", epoch1Signature: "saved-epoch-signature",
                    attestationEvidence: "saved-evidence"
                )
                : nil
            let existing = FirstDeviceRootRecord(
                seed: FirstDeviceCeremonySeed(
                    attemptId: "root-owner",
                    attemptRecoveryToken: state == .rootCommitted ? "" : "owner-recovery",
                    serverBaseUrl: "https://api.example.test",
                    deviceId: "root-device",
                    signingKeyId: "root-dsk",
                    encryptionKeyId: "root-dek",
                    dskPublicKeyBase64: "root-public-dsk",
                    dekPublicKeyBase64: "root-public-dek",
                    dskAlias: "pca.dsk.root-owner",
                    dekAlias: "pca.dek.root-owner"
                ),
                state: state,
                ceremonyId: "root-ceremony",
                submission: submission
            )
            let rootStore = InMemoryFirstDeviceRootStore(record: existing)
            let keyDeletion = RecordingKeyDeletion()
            let model = try makeEnrollmentModel(
                identityStore: identityStore,
                attemptStore: attemptStore,
                firstDeviceRootStore: rootStore,
                keyDeletion: keyDeletion,
                bootstrapStatus: "PAIRING_PENDING"
            )

            model.start()
            await waitForEnrollmentInProgress(model)

            XCTAssertEqual(rootStore.current(), existing)
            XCTAssertEqual(keyDeletion.keepSets, [Set(["new-attempt", "root-owner"])])
        }
    }

    func testUnavailableAtomicCleanupKeepsKeysAndEnrollmentCanContinue() async throws {
        let rootStore = SwitchableFirstDeviceRootStore()
        rootStore.failCapture = false
        let retained = FirstDeviceRootRecord(seed: trustRootSeed(), state: .rootCommitted)
        XCTAssertTrue(rootStore.save(retained))
        rootStore.failCurrent = true
        let attempts = InMemoryPCADeviceStateStore()
        try attempts.saveAttempt(PCAEnrollmentAttempt(attemptId: "new-attempt", attemptRecoveryToken: "new-recovery"))
        let deletion = RecordingKeyDeletion()
        let model = try makeEnrollmentModel(
            identityStore: RecordingDeviceIdentityStore(), attemptStore: attempts,
            firstDeviceRootStore: rootStore, keyDeletion: deletion, bootstrapStatus: "PAIRING_PENDING"
        )
        model.start()
        await waitForEnrollmentInProgress(model)
        XCTAssertTrue(deletion.keepSets.isEmpty, "uncertain retained root must never authorize orphan deletion")
        rootStore.failCurrent = false
        XCTAssertEqual(rootStore.current(), retained)
    }

    func testNewEnrollmentReplacesOnlyExpiredOrRejectedRoot() async throws {
        for state in [FirstDeviceRootState.expired, .rejected] {
            let identityStore = RecordingDeviceIdentityStore()
            let attemptStore = InMemoryPCADeviceStateStore()
            try attemptStore.saveAttempt(PCAEnrollmentAttempt(attemptId: "new-attempt", attemptRecoveryToken: "new-recovery"))
            let existing = FirstDeviceRootRecord(
                seed: FirstDeviceCeremonySeed(
                    attemptId: "terminal-owner",
                    attemptRecoveryToken: "old-recovery",
                    serverBaseUrl: "https://api.example.test",
                    deviceId: "old-device",
                    signingKeyId: "old-dsk",
                    encryptionKeyId: "old-dek",
                    dskPublicKeyBase64: "old-public-dsk",
                    dekPublicKeyBase64: "old-public-dek",
                    dskAlias: "pca.dsk.terminal-owner",
                    dekAlias: "pca.dek.terminal-owner"
                ),
                state: state,
                ceremonyId: "old-ceremony"
            )
            let rootStore = InMemoryFirstDeviceRootStore(record: existing)
            let model = try makeEnrollmentModel(
                identityStore: identityStore,
                attemptStore: attemptStore,
                firstDeviceRootStore: rootStore,
                bootstrapStatus: "PAIRING_PENDING"
            )

            model.start()
            await waitForEnrollmentInProgress(model)

            XCTAssertEqual(rootStore.current()?.seed.attemptId, "new-attempt")
            XCTAssertEqual(rootStore.current()?.state, .notStarted)
            XCTAssertNil(rootStore.current()?.ceremonyId)
            XCTAssertNotEqual(rootStore.current(), existing)
        }
    }

    private func inboundResponse(id: String = "message-1", mutation: ((inout [String: Any]) -> Void)? = nil) throws -> PCAInboundRuntimeSyncResponse {
        var envelope: [String: Any] = ["protocolMajor": 1, "protocolMinor": 0, "messageId": id,
            "familyId": "family-1", "senderDeviceId": "sender-1", "recipientDeviceId": "device-1",
            "senderKeyId": "key-1", "messageType": "STATUS_SNAPSHOT", "trustSetEpoch": 1, "keyEpoch": 1,
            "sequenceOrNonce": "nonce-1", "issuedAt": "2026-10-01T00:00:00.000Z",
            "expiresAt": "2026-10-01T00:01:00.000Z", "semanticVersion": "1.0.0",
            "payload": "AQID", "signature": "signature-1"]
        mutation?(&envelope)
        let data = try JSONSerialization.data(withJSONObject: ["scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
            "applied": [envelope], "unparseableMessageIds": [], "droppedForListBound": []])
        return try JSONDecoder().decode(PCAInboundRuntimeSyncResponse.self, from: data)
    }

    func testBackgroundCompletionIsExactlyOnceAndExpirationWins() {
        var expiredResults: [Bool] = []
        let expired = PCARefreshCompletion(complete: { expiredResults.append($0) })
        expired.expire()
        expired.finish(success: true)
        expired.expire()
        XCTAssertEqual(expiredResults, [false])
        var completedResults: [Bool] = []
        let completed = PCARefreshCompletion(complete: { completedResults.append($0) })
        completed.finish(success: true)
        completed.expire()
        completed.finish(success: false)
        XCTAssertEqual(completedResults, [true])
    }

    @MainActor func testBackgroundExpirationBeforeAttachmentCancelsOnlyOwnedTask() async {
        var results: [Bool] = []
        var observedCancellation = false
        let completion = PCARefreshCompletion(complete: { results.append($0) })
        completion.expire()
        let owned = Task { @MainActor in
            do { try Task.checkCancellation() }
            catch { observedCancellation = true }
            completion.finish(success: true)
        }
        completion.attach(owned)
        await owned.value
        XCTAssertTrue(observedCancellation)
        XCTAssertEqual(results, [false])
        XCTAssertFalse(Task.isCancelled)
    }

    @MainActor func testRuntimeCampaignResumesModernCursorAfterFourPages() async throws {
        let state = InMemoryPCADeviceStateStore()
        let session = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(600))
        try state.saveSession(session)
        var cursors: [String?] = []
        let transport = InMemoryPCAHTTPTransport { request in
            if request.httpMethod != "GET" { return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8)) }
            cursors.append(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value)
            let more = cursors.count < 5
            let incarnation = String(repeating: "0", count: 64)
            // The host must derive the exact session hash; this test supplies the independently computed wire value.
            #if canImport(CryptoKit)
            let fingerprint = SHA256.hash(data: Data(session.sessionToken.utf8)).map { String(format: "%02x", $0) }.joined()
            #else
            let fingerprint = incarnation
            #endif
            let body: [String: Any] = ["scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
                "applied": [], "unparseableMessageIds": [], "droppedForListBound": [], "receipts": [],
                "hasMore": more, "nextCursor": more ? "cursor\(cursors.count)" as Any : NSNull(),
                "hasUnresolved": false, "sessionIncarnation": fingerprint]
            return PCAHTTPResponse(statusCode: 200, data: try JSONSerialization.data(withJSONObject: body))
        }
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: state,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
            inboundInbox: PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "bounded-host"))
        let firstOutcome = try await model.synchronizeRuntimeCampaign()
        XCTAssertEqual(firstOutcome, .morePending)
        XCTAssertEqual(cursors, [nil, "cursor1", "cursor2", "cursor3"])
        let secondOutcome = try await model.synchronizeRuntimeCampaign()
        XCTAssertEqual(secondOutcome, .complete)
        XCTAssertEqual(cursors.last!, "cursor4")
    }

    @MainActor func testRuntimeSessionReplacementDuringAckPreservesPendingMarker() async throws {
        let state = InMemoryPCADeviceStateStore()
        let session = PCADeviceSession(deviceId: "device-1", sessionToken: "old-session", expiresAt: Date().addingTimeInterval(600))
        let replacement = PCADeviceSession(deviceId: "device-1", sessionToken: "new-session", expiresAt: Date().addingTimeInterval(600))
        try state.saveSession(session)
        let response = try inboundResponse()
        let body: [String: Any] = ["scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
            "applied": [try JSONSerialization.jsonObject(with: JSONEncoder().encode(response.applied[0]))],
            "unparseableMessageIds": [], "droppedForListBound": []]
        let data = try JSONSerialization.data(withJSONObject: body)
        let transport = InMemoryPCAHTTPTransport { request in
            if request.httpMethod == "GET" { return PCAHTTPResponse(statusCode: 200, data: data) }
            if request.url?.path.hasSuffix("/ack") == true { try state.saveSession(replacement) }
            return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
        }
        let inbox = PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "ack-race")
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: state,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport), inboundInbox: inbox)
        let outcome = try await model.synchronizeRuntimeCampaign()
        XCTAssertEqual(outcome, .retryableFailure)
        XCTAssertEqual(try state.loadSession(), replacement)
        XCTAssertEqual(try inbox.pendingAcknowledgements(scope: response.scope).count, 1)
    }

    @MainActor func testBusyRuntimeCampaignDefersWithoutStartingAnotherPull() async throws {
        let state = InMemoryPCADeviceStateStore()
        try state.saveSession(PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(600)))
        var suspended: CheckedContinuation<PCAHTTPResponse, Never>?
        let began = expectation(description: "pull began")
        var pulls = 0
        let transport = InMemoryPCAHTTPTransport { request in
            guard request.httpMethod == "GET" else { return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8)) }
            pulls += 1
            return await withCheckedContinuation { continuation in suspended = continuation; began.fulfill() }
        }
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: state,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
            inboundInbox: PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "busy-host"))
        let foreground = Task { @MainActor in try await model.synchronizeRuntimeCampaign() }
        await fulfillment(of: [began], timeout: 5)
        let background = try await model.synchronizeRuntimeCampaign()
        XCTAssertEqual(background, .retryableFailure)
        XCTAssertEqual(pulls, 1)
        suspended?.resume(returning: PCAHTTPResponse(statusCode: 200, data: Data(#"{"scope":{"familyId":"family-1","recipientDeviceId":"device-1"},"applied":[],"unparseableMessageIds":[],"droppedForListBound":[]}"#.utf8)))
        let outcome = try await foreground.value
        XCTAssertEqual(outcome, .complete)
    }

    @MainActor func testExpiredRuntimeTaskDuringPullCannotCaptureOrAck() async throws {
        let state = InMemoryPCADeviceStateStore()
        let retained = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(600))
        try state.saveSession(retained)
        let response = try inboundResponse()
        let body: [String: Any] = ["scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
            "applied": [try JSONSerialization.jsonObject(with: JSONEncoder().encode(response.applied[0]))],
            "unparseableMessageIds": [], "droppedForListBound": []]
        let data = try JSONSerialization.data(withJSONObject: body)
        var suspended: CheckedContinuation<PCAHTTPResponse, Never>?
        let began = expectation(description: "pull began")
        var acks = 0
        let transport = InMemoryPCAHTTPTransport { request in
            if request.httpMethod == "GET" {
                return await withCheckedContinuation { continuation in suspended = continuation; began.fulfill() }
            }
            if request.url?.path.hasSuffix("/ack") == true { acks += 1 }
            return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
        }
        let inbox = PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "expiration-host")
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: state,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport), inboundInbox: inbox)
        let owned = Task { @MainActor in try await model.synchronizeRuntimeCampaign() }
        await fulfillment(of: [began], timeout: 5)
        owned.cancel()
        suspended?.resume(returning: PCAHTTPResponse(statusCode: 200, data: data))
        do { _ = try await owned.value; XCTFail("Expected owned-task cancellation") }
        catch is CancellationError { }
        XCTAssertEqual(acks, 0)
        XCTAssertNil(try inbox.retainedScope())
        XCTAssertEqual(try state.loadSession(), retained)
    }

    @MainActor func testLockedSessionStorageBlocksWithoutDeletingSecretsOrSendingRequests() async throws {
        let state = LockedRuntimeDeviceStateStore()
        var requests = 0
        let transport = InMemoryPCAHTTPTransport { _ in
            requests += 1
            return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
        }
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: state,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
            inboundInbox: PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "locked-host"))
        let outcome = try await model.synchronizeRuntimeCampaign()
        XCTAssertEqual(outcome, .blocked)
        XCTAssertEqual(requests, 0)
        XCTAssertEqual(state.clearCalls, 0)
        XCTAssertNotEqual(model.syncConnectionState, .live)
    }

    @MainActor func testRuntimeWrongFamilyResponseCannotAdvanceCustodyOrAcknowledge() async throws {
        let state = InMemoryPCADeviceStateStore()
        try state.saveSession(PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(600)))
        var requests = 0
        let transport = InMemoryPCAHTTPTransport { request in
            requests += 1
            XCTAssertEqual(request.httpMethod, "GET")
            return PCAHTTPResponse(statusCode: 200, data: Data(#"{"scope":{"familyId":"wrong-family","recipientDeviceId":"device-1"},"applied":[],"unparseableMessageIds":[],"droppedForListBound":[]}"#.utf8))
        }
        let inbox = PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "wrong-family")
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: state,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport), inboundInbox: inbox)
        let outcome = try await model.synchronizeRuntimeCampaign()
        XCTAssertEqual(outcome, .blocked)
        XCTAssertEqual(requests, 1)
        XCTAssertNil(try inbox.retainedScope())
    }

    @MainActor func testEstablishmentRootOrSessionReplacementNeverPublishesOldCompletion() async throws {
        for mode in ["challenge-root", "exchange-root", "exchange-session", "exchange-cancel"] {
            let state = InMemoryPCADeviceStateStore()
            let identity = RecordingDeviceIdentityStore()
            identity.saveDeviceId("device-1")
            let root = FirstDeviceRootRecord(seed: trustRootSeed(), state: .rootCommitted, familyId: "family-1")
            let roots = InMemoryFirstDeviceRootStore(record: root)
            let replacement = PCADeviceSession(deviceId: "device-1", sessionToken: "replacement", expiresAt: Date().addingTimeInterval(600))
            var exchanges = 0
            let transport = InMemoryPCAHTTPTransport { request in
                if request.url?.path.hasSuffix("/challenge") == true {
                    if mode == "challenge-root" { var changed = root; changed.familyId = "family-2"; _ = roots.save(changed) }
                    return PCAHTTPResponse(statusCode: 200, data: Data(#"{"challengeId":"challenge-1","nonce":"nonce-1","expiresAt":"2099-01-01T00:00:00Z"}"#.utf8))
                }
                exchanges += 1
                if mode == "exchange-root" { var changed = root; changed.familyId = "family-2"; _ = roots.save(changed) }
                if mode == "exchange-session" { try state.saveSession(replacement) }
                if mode == "exchange-cancel" { throw CancellationError() }
                return PCAHTTPResponse(statusCode: 200, data: Data(#"{"sessionToken":"old-completion","expiresAt":"2099-01-01T00:00:00Z"}"#.utf8))
            }
            let client = try PCADeviceSessionClient(baseURL: URL(string: "https://api.example.test")!, transport: transport, proof: TestEnrollmentProofProvider())
            let model = try makeEnrollmentModel(identityStore: identity, attemptStore: state, firstDeviceRootStore: roots, sessionClient: client)
            await model.establishSessionIfNeeded()
            XCTAssertEqual(exchanges, mode == "challenge-root" ? 0 : 1)
            XCTAssertEqual(try state.loadSession(), mode == "exchange-session" ? replacement : nil)
        }
    }

    @MainActor func testOverlappingEstablishmentUsesOneChallengeAndOnePublication() async throws {
        let state = InMemoryPCADeviceStateStore()
        let identity = RecordingDeviceIdentityStore()
        identity.saveDeviceId("device-1")
        let roots = InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(seed: trustRootSeed(), state: .rootCommitted, familyId: "family-1"))
        let began = expectation(description: "challenge began")
        var suspended: CheckedContinuation<PCAHTTPResponse, Never>?
        var challenges = 0
        var exchanges = 0
        let transport = InMemoryPCAHTTPTransport { request in
            if request.url?.path.hasSuffix("/challenge") == true {
                challenges += 1
                return await withCheckedContinuation { continuation in suspended = continuation; began.fulfill() }
            }
            exchanges += 1
            return PCAHTTPResponse(statusCode: 200, data: Data(#"{"sessionToken":"single-session","expiresAt":"2099-01-01T00:00:00Z"}"#.utf8))
        }
        let client = try PCADeviceSessionClient(baseURL: URL(string: "https://api.example.test")!, transport: transport, proof: TestEnrollmentProofProvider())
        let model = try makeEnrollmentModel(identityStore: identity, attemptStore: state, firstDeviceRootStore: roots, sessionClient: client)
        let first = Task { @MainActor in await model.establishSessionIfNeeded() }
        await fulfillment(of: [began], timeout: 5)
        await model.establishSessionIfNeeded()
        XCTAssertEqual(challenges, 1)
        suspended?.resume(returning: PCAHTTPResponse(statusCode: 200, data: Data(#"{"challengeId":"challenge-1","nonce":"nonce-1","expiresAt":"2099-01-01T00:00:00Z"}"#.utf8)))
        await first.value
        XCTAssertEqual(exchanges, 1)
        XCTAssertEqual(try state.loadSession()?.sessionToken, "single-session")
    }

    func testInboundInboxRetainsFullSignedWrapperAcrossRestartAndAck() throws {
        let keychain = InMemoryKeychainStore()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "inbox-test")
        let response = try inboundResponse()
        try inbox.capture(response, sessionDeviceId: "device-1")
        let restored = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "inbox-test")
        XCTAssertEqual(try restored.pendingAcknowledgements(scope: response.scope).singleEnvelope, response.applied.first)
        try restored.markAcknowledged(response.applied[0], scope: response.scope)
        XCTAssertTrue(try restored.pendingAcknowledgements(scope: response.scope).isEmpty)
        XCTAssertEqual(try restored.pendingCrypto(scope: response.scope).singleEnvelope, response.applied.first)
        try restored.capture(response, sessionDeviceId: "device-1")
        XCTAssertTrue(try restored.pendingAcknowledgements(scope: response.scope).isEmpty)
        XCTAssertEqual(keychain.storedAccessibility(forAccount: "current.ciphertext-inbox", service: "inbox-test.ciphertext-inbox"), .whenUnlockedThisDeviceOnly)
    }

    func testRelayOpaqueUnicodeIdentitiesRemainByteDistinctAcrossRestartAndACK() throws {
        let ids = ["\u{00E9}", "e\u{0301}"]
        XCTAssertEqual(ids[0], ids[1]) // Swift normalization is unsuitable for protocol IDs.
        let first = try inboundResponse(id: ids[0])
        let second = try inboundResponse(id: ids[1])
        let receiptRows = ids.map { ["messageId": $0, "outcome": "APPLIED", "atUtc": "2026-10-07T00:00:00.000Z"] }
        let envelopeRows = try [first.applied[0], second.applied[0]].map {
            try JSONSerialization.jsonObject(with: JSONEncoder().encode($0))
        }
        let wire: [String: Any] = ["scope": ["familyId": first.scope.familyId, "recipientDeviceId": "device-1"],
            "applied": envelopeRows, "unparseableMessageIds": [], "droppedForListBound": [],
            "hasMore": false, "nextCursor": NSNull(), "hasUnresolved": false,
            "sessionIncarnation": String(repeating: "a", count: 64), "receipts": receiptRows]
        let response = try JSONDecoder().decode(PCAInboundRuntimeSyncResponse.self,
            from: JSONSerialization.data(withJSONObject: wire))
        let keychain = InMemoryKeychainStore()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "unicode-custody")
        try inbox.capture(response, sessionDeviceId: "device-1", sessionIncarnation: String(repeating: "a", count: 64), requestedCursor: nil)
        let restored = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "unicode-custody")
        XCTAssertEqual(try restored.pendingAcknowledgements(scope: first.scope).count, 2)
        try restored.markAcknowledged(first.applied[0], scope: first.scope)
        let pending = try restored.pendingAcknowledgements(scope: first.scope)
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(Data(try XCTUnwrap(pending.first).envelope.messageId.utf8), Data(ids[1].utf8))
        let conflict = try inboundResponse(id: ids[1], mutation: { $0["senderKeyId"] = "different-key" })
        XCTAssertThrowsError(try restored.capture(conflict, sessionDeviceId: "device-1"))
        XCTAssertEqual(try restored.pendingCrypto(scope: first.scope).count, 2)
    }

    func testRelayScopeRejectsNormalizedEquivalentOpaqueFamilyAndRecipient() throws {
        let composed = PCAInboundScope(familyId: "\u{00E9}", recipientDeviceId: "\u{00E9}")
        let decomposed = PCAInboundScope(familyId: "e\u{0301}", recipientDeviceId: "e\u{0301}")
        XCTAssertNotEqual(composed, decomposed)
        let inbox = PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "unicode-scope")
        let empty = PCAInboundRuntimeSyncResponse(scope: composed, applied: [], unparseableMessageIds: [], droppedForListBound: [])
        XCTAssertThrowsError(try inbox.capture(empty, sessionDeviceId: decomposed.recipientDeviceId))
        try inbox.capture(empty, sessionDeviceId: composed.recipientDeviceId)
        XCTAssertThrowsError(try inbox.pendingCrypto(scope: decomposed))
        XCTAssertEqual(try inbox.retainedScope(), composed)
    }

    func testInboundNavigationRestartRotationAndRejectedCursorPreserveCustody() throws {
        let keychain = InMemoryKeychainStore()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "navigation-test")
        let legacy = try inboundResponse()
        let incarnation = String(repeating: "a", count: 64)
        let navigation = PCAInboundNavigation(nextCursor: "cursor1", hasMore: true, hasUnresolved: true, sessionIncarnation: incarnation)
        let response = PCAInboundRuntimeSyncResponse(scope: legacy.scope, applied: legacy.applied,
            unparseableMessageIds: [], droppedForListBound: [], hasMore: true,
            receipts: [PCAInboundReceipt(messageId: "message-1", outcome: .applied, atUtc: "2026-10-07T00:00:00.000Z")],
            navigation: navigation)
        try inbox.capture(response, sessionDeviceId: "device-1", sessionIncarnation: incarnation, requestedCursor: nil)
        let restored = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "navigation-test")
        XCTAssertEqual(try restored.navigation(sessionIncarnation: incarnation), navigation)
        XCTAssertEqual(try restored.retainedScope(), legacy.scope)
        XCTAssertEqual(try restored.pendingAcknowledgements(scope: legacy.scope).count, 1)
        XCTAssertThrowsError(try restored.resetRejectedNavigation(sessionIncarnation: incarnation, cursor: "wrong"))
        XCTAssertEqual(try restored.navigation(sessionIncarnation: incarnation), navigation)
        try restored.resetRejectedNavigation(sessionIncarnation: incarnation, cursor: "cursor1")
        XCTAssertNil(try restored.navigation(sessionIncarnation: incarnation))
        XCTAssertEqual(try restored.pendingCrypto(scope: legacy.scope).singleEnvelope, legacy.applied.first)
        try restored.capture(response, sessionDeviceId: "device-1", sessionIncarnation: incarnation, requestedCursor: nil)
        XCTAssertNil(try restored.navigation(sessionIncarnation: String(repeating: "b", count: 64)))
        XCTAssertEqual(try restored.pendingAcknowledgements(scope: legacy.scope).count, 1)
        XCTAssertTrue(try restored.hasUnresolvedRelayWork())
        let raw = try keychain.retrieve(forAccount: "current.ciphertext-inbox", service: "navigation-test.ciphertext-inbox")
        let snapshot = try XCTUnwrap(JSONSerialization.jsonObject(with: raw) as? [String: Any])
        XCTAssertEqual(snapshot["version"] as? Int, 2)
        XCTAssertEqual((snapshot["receipts"] as? [[String: Any]])?.count, 1)
    }

    func testInboundNavigationRejectsStaleRequestRepeatedCursorAndUnboundModernCapture() throws {
        let keychain = InMemoryKeychainStore()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "navigation-test")
        let legacy = try inboundResponse()
        let incarnation = String(repeating: "a", count: 64)
        let response = PCAInboundRuntimeSyncResponse(scope: legacy.scope, applied: legacy.applied,
            unparseableMessageIds: [], droppedForListBound: [], hasMore: true,
            navigation: PCAInboundNavigation(nextCursor: "cursor1", hasMore: true, hasUnresolved: false, sessionIncarnation: incarnation))
        XCTAssertThrowsError(try inbox.capture(response, sessionDeviceId: "device-1"))
        try inbox.capture(response, sessionDeviceId: "device-1", sessionIncarnation: incarnation, requestedCursor: nil)
        let before = try keychain.retrieve(forAccount: "current.ciphertext-inbox", service: "navigation-test.ciphertext-inbox")
        for (session, cursor) in [(incarnation, "cursor1"), (incarnation, "stale"), (String(repeating: "b", count: 64), "cursor1")] {
            XCTAssertThrowsError(try inbox.capture(response, sessionDeviceId: "device-1", sessionIncarnation: session, requestedCursor: cursor))
        }
        XCTAssertEqual(try keychain.retrieve(forAccount: "current.ciphertext-inbox", service: "navigation-test.ciphertext-inbox"), before)
    }

    func testInboundNavigationMissingPersistedNullableFieldFailsClosed() throws {
        let keychain = InMemoryKeychainStore()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "navigation-test")
        let response = try inboundResponse()
        try inbox.capture(response, sessionDeviceId: "device-1")
        let raw = try keychain.retrieve(forAccount: "current.ciphertext-inbox", service: "navigation-test.ciphertext-inbox")
        var snapshot = try XCTUnwrap(JSONSerialization.jsonObject(with: raw) as? [String: Any])
        snapshot.removeValue(forKey: "navigation")
        try keychain.storeReplacingAtomically(JSONSerialization.data(withJSONObject: snapshot), forAccount: "current.ciphertext-inbox",
            service: "navigation-test.ciphertext-inbox", accessibility: .whenUnlockedThisDeviceOnly)
        XCTAssertThrowsError(try inbox.retainedScope())
        XCTAssertThrowsError(try inbox.pendingAcknowledgements(scope: response.scope))
    }

    func testInboundLegacySnapshotMigratesWithoutLosingCiphertext() throws {
        let keychain = InMemoryKeychainStore()
        let response = try inboundResponse()
        let legacy: [String: Any] = ["version": 1,
            "scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
            "entries": [["envelope": try JSONSerialization.jsonObject(with: JSONEncoder().encode(response.applied[0])),
                         "relayAcknowledged": false, "processingState": "PENDING_CRYPTO"]]]
        try keychain.storeReplacingAtomically(JSONSerialization.data(withJSONObject: legacy), forAccount: "current.ciphertext-inbox",
            service: "migration-test.ciphertext-inbox", accessibility: .whenUnlockedThisDeviceOnly)
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "migration-test")
        XCTAssertEqual(try inbox.pendingAcknowledgements(scope: response.scope).singleEnvelope, response.applied.first)
        let raw = try keychain.retrieve(forAccount: "current.ciphertext-inbox", service: "migration-test.ciphertext-inbox")
        let snapshot = try XCTUnwrap(JSONSerialization.jsonObject(with: raw) as? [String: Any])
        XCTAssertEqual(snapshot["version"] as? Int, 2)
        XCTAssertTrue(snapshot["navigation"] is NSNull)
        XCTAssertEqual(try inbox.pendingCrypto(scope: response.scope).singleEnvelope, response.applied.first)
    }

    func testInboundModernWriteAndCapacityFailureDoNotAdvanceCursor() throws {
        let keychain = FaultingInboxKeychain()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "navigation-test", maxRecords: 1)
        let incarnation = String(repeating: "a", count: 64)
        let legacy = try inboundResponse()
        func page(_ wrappers: [PCAInboundEnvelope], _ cursor: String) -> PCAInboundRuntimeSyncResponse {
            PCAInboundRuntimeSyncResponse(scope: legacy.scope, applied: wrappers,
                unparseableMessageIds: [], droppedForListBound: [], hasMore: true,
                navigation: PCAInboundNavigation(nextCursor: cursor, hasMore: true, hasUnresolved: false, sessionIncarnation: incarnation))
        }
        try inbox.capture(page(legacy.applied, "cursor1"), sessionDeviceId: "device-1", sessionIncarnation: incarnation, requestedCursor: nil)
        let before = keychain.data
        keychain.failReplace = true
        XCTAssertThrowsError(try inbox.capture(page([], "cursor2"), sessionDeviceId: "device-1", sessionIncarnation: incarnation, requestedCursor: "cursor1"))
        XCTAssertThrowsError(try inbox.navigation(sessionIncarnation: incarnation))
        keychain.failReplace = false
        XCTAssertEqual(keychain.data, before)
        XCTAssertEqual(try inbox.navigation(sessionIncarnation: incarnation)?.nextCursor, "cursor1")
        XCTAssertThrowsError(try inbox.capture(page(try inboundResponse(id: "message-2").applied, "cursor2"), sessionDeviceId: "device-1",
            sessionIncarnation: incarnation, requestedCursor: "cursor1"))
        XCTAssertEqual(keychain.data, before)
        XCTAssertEqual(try inbox.pendingCrypto(scope: legacy.scope).singleEnvelope, legacy.applied.first)
    }

    func testInboundInboxRejectsConflictsWithoutChangingOriginal() throws {
        let inbox = PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "inbox-test")
        let response = try inboundResponse()
        try inbox.capture(response, sessionDeviceId: "device-1")
        for field in ["signature", "senderKeyId", "sequenceOrNonce", "payload"] {
            let changed = try inboundResponse { $0[field] = field == "payload" ? "BA==" : "changed" }
            XCTAssertThrowsError(try inbox.capture(changed, sessionDeviceId: "device-1"))
        }
        XCTAssertThrowsError(try inbox.capture(response, sessionDeviceId: "other-device"))
        XCTAssertEqual(try inbox.pendingCrypto(scope: response.scope).singleEnvelope, response.applied.first)
    }

    func testInboundInboxRejectsMalformedFieldsBeforeKeychainWrite() throws {
        for (field, value) in [("trustSetEpoch", 2147483648 as Any), ("keyEpoch", -1 as Any),
            ("payload", "A!QID" as Any), ("semanticVersion", "01.0.0" as Any),
            ("messageType", "UNKNOWN" as Any), ("signature", String(repeating: "s", count: 513) as Any),
            ("recipientDeviceId", "other-device" as Any), ("familyId", "other-family" as Any)] {
            let keychain = InMemoryKeychainStore()
            let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "inbox-test")
            let response = try inboundResponse { $0[field] = value }
            XCTAssertThrowsError(try inbox.capture(response, sessionDeviceId: "device-1"))
            XCTAssertThrowsError(try keychain.retrieve(forAccount: "current.ciphertext-inbox", service: "inbox-test.ciphertext-inbox"))
        }
        XCTAssertThrowsError(try inboundResponse { $0["correlationId"] = 42 })
        XCTAssertThrowsError(try inboundResponse { $0["trustSetEpoch"] = 1.5 })
    }

    func testInboundInboxWriteAndReadbackFailuresNeverExposeAckCandidates() throws {
        let keychain = FaultingInboxKeychain()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "inbox-test")
        let response = try inboundResponse()
        keychain.failReplace = true
        XCTAssertThrowsError(try inbox.capture(response, sessionDeviceId: "device-1"))
        XCTAssertThrowsError(try inbox.pendingAcknowledgements(scope: response.scope))
        keychain.failReplace = false
        keychain.corruptReadback = true
        XCTAssertThrowsError(try inbox.capture(response, sessionDeviceId: "device-1"))
        keychain.corruptReadback = false
        XCTAssertEqual(try inbox.pendingAcknowledgements(scope: response.scope).count, 1)
    }

    func testInboundInboxCapacityAndCorruptionNeverEvictCiphertext() throws {
        let keychain = FaultingInboxKeychain()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "inbox-test", maxRecords: 1)
        let response = try inboundResponse()
        try inbox.capture(response, sessionDeviceId: "device-1")
        let original = keychain.data
        XCTAssertThrowsError(try inbox.capture(inboundResponse(id: "message-2"), sessionDeviceId: "device-1"))
        XCTAssertEqual(keychain.data, original)
        keychain.data = Data(#"{"version":99}"#.utf8)
        XCTAssertThrowsError(try inbox.capture(response, sessionDeviceId: "device-1"))
        XCTAssertThrowsError(try inbox.pendingAcknowledgements(scope: response.scope))
        XCTAssertEqual(keychain.data, Data(#"{"version":99}"#.utf8))
    }

    @MainActor func testRuntimeHostPersistsBeforeAckAndEmptyPullKeepsPendingCrypto() async throws {
        let keychain = InMemoryKeychainStore()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "host-test")
        let response = try inboundResponse()
        let responseData = try JSONSerialization.data(withJSONObject: ["scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
            "applied": [try JSONSerialization.jsonObject(with: JSONEncoder().encode(response.applied[0]))],
            "unparseableMessageIds": [], "droppedForListBound": []])
        var pulls = 0
        var acks = 0
        let transport = InMemoryPCAHTTPTransport { request in
            if request.httpMethod == "GET" {
                pulls += 1
                if pulls == 1 { return PCAHTTPResponse(statusCode: 200, data: responseData) }
                return PCAHTTPResponse(statusCode: 200, data: Data(#"{"scope":{"familyId":"family-1","recipientDeviceId":"device-1"},"applied":[],"unparseableMessageIds":[],"droppedForListBound":[]}"#.utf8))
            }
            if request.url?.path.hasSuffix("/ack") == true {
                XCTAssertEqual(try inbox.pendingCrypto(scope: response.scope).singleEnvelope, response.applied[0])
                acks += 1
            }
            return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
        }
        let attempts = InMemoryPCADeviceStateStore()
        try attempts.saveSession(PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60)))
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: attempts,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport), inboundInbox: inbox)
        await model.synchronizeRuntime()
        await model.synchronizeRuntime()
        XCTAssertEqual(acks, 1)
        XCTAssertEqual(try inbox.pendingCrypto(scope: response.scope).count, 1)
        XCTAssertNotEqual(model.syncConnectionState, .live)
        XCTAssertNotEqual(model.dependencies.protectionRuntime.status, .active)
    }

    @MainActor func testRuntimeHostKeepsEmptyContinuationPagePendingWithoutAckOrExtraPull() async throws {
        let attempts = InMemoryPCADeviceStateStore()
        try attempts.saveSession(PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60)))
        let response = Data(#"{"scope":{"familyId":"family-1","recipientDeviceId":"device-1"},"applied":[],"unparseableMessageIds":[],"droppedForListBound":[],"hasMore":true}"#.utf8)
        var pulls = 0
        var acks = 0
        let transport = InMemoryPCAHTTPTransport { request in
            if request.httpMethod == "GET" {
                pulls += 1
                return PCAHTTPResponse(statusCode: 200, data: response)
            }
            if request.url?.path.hasSuffix("/ack") == true { acks += 1 }
            return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
        }
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: attempts,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
            inboundInbox: PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "has-more-host"))

        await model.synchronizeRuntime()

        XCTAssertEqual(model.syncConnectionState, .syncPending)
        XCTAssertEqual(pulls, 1)
        XCTAssertEqual(acks, 0)
        XCTAssertNotEqual(model.dependencies.protectionRuntime.status, .active)
    }

    func testAuthoritySnapshotEqualityUsesExactBytesIncludingNestedAndOptionalFields() {
        let composed = "\u{00E9}", decomposed = "e\u{0301}"
        XCTAssertEqual(composed, decomposed)
        var seed = trustRootSeed(); seed.deviceId = composed
        var alteredSeed = seed; alteredSeed.deviceId = decomposed
        XCTAssertNotEqual(seed, alteredSeed)
        let root = FirstDeviceRootRecord(seed: seed, state: .rootCommitted, familyId: composed)
        XCTAssertEqual(root, root)
        var altered = root; altered.familyId = decomposed
        XCTAssertNotEqual(root, altered)
        altered = root; altered.seed = alteredSeed
        XCTAssertNotEqual(root, altered)
        altered = root; altered.familyId = nil
        XCTAssertNotEqual(root, altered)
        let payload = FirstDeviceSubmissionPayload(proofBytes: composed, proofSignature: "sig", epoch1Bytes: "epoch", epoch1Signature: "sig", attestationEvidence: "evidence")
        var changedPayload = payload; changedPayload.proofBytes = decomposed
        XCTAssertNotEqual(payload, changedPayload)
        var submitted = root; submitted.submission = payload
        var changedSubmitted = submitted; changedSubmitted.submission = changedPayload
        XCTAssertNotEqual(submitted, changedSubmitted)
        let expires = Date().addingTimeInterval(60)
        XCTAssertNotEqual(PCADeviceSession(deviceId: composed, sessionToken: "token", expiresAt: expires),
                          PCADeviceSession(deviceId: decomposed, sessionToken: "token", expiresAt: expires))
        XCTAssertNotEqual(PCADeviceSession(deviceId: "device-1", sessionToken: composed, expiresAt: expires),
                          PCADeviceSession(deviceId: "device-1", sessionToken: decomposed, expiresAt: expires))
    }

    @MainActor func testRuntimeRootUnicodeReplacementDuringPullNeverCapturesOrACKs() async throws {
        let composed = "\u{00E9}", decomposed = "e\u{0301}"
        let root = FirstDeviceRootRecord(seed: trustRootSeed(), state: .rootCommitted, familyId: composed)
        let roots = InMemoryFirstDeviceRootStore(record: root)
        let inbox = PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "unicode-root-race")
        let response = try inboundResponse(mutation: { $0["familyId"] = composed })
        let wire = try JSONSerialization.data(withJSONObject: ["scope": ["familyId": composed, "recipientDeviceId": "device-1"],
            "applied": [try JSONSerialization.jsonObject(with: JSONEncoder().encode(response.applied[0]))],
            "unparseableMessageIds": [], "droppedForListBound": []])
        var acks = 0
        let transport = InMemoryPCAHTTPTransport { request in
            if request.httpMethod == "GET" {
                var replacement = root; replacement.familyId = decomposed
                XCTAssertTrue(roots.save(replacement))
                return PCAHTTPResponse(statusCode: 200, data: wire)
            }
            if request.url?.path.hasSuffix("/ack") == true { acks += 1 }
            return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
        }
        let state = InMemoryPCADeviceStateStore()
        try state.saveSession(PCADeviceSession(deviceId: "device-1", sessionToken: "token", expiresAt: Date().addingTimeInterval(60)))
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: state,
            firstDeviceRootStore: roots, runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport), inboundInbox: inbox)
        await model.synchronizeRuntime()
        XCTAssertEqual(acks, 0)
        XCTAssertNil(try inbox.retainedScope())
        XCTAssertEqual(model.syncConnectionState, .stale)
    }

    @MainActor func testRuntimeRootUnicodeReplacementDuringACKRetainsPendingMarker() async throws {
        var root = FirstDeviceRootRecord(seed: trustRootSeed(), state: .rootCommitted, familyId: "family-1")
        root.seed.attemptId = "\u{00E9}"
        let capturedRoot = root
        let roots = InMemoryFirstDeviceRootStore(record: capturedRoot)
        let inbox = PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "unicode-ack-race")
        let response = try inboundResponse()
        try inbox.capture(response, sessionDeviceId: "device-1")
        var acks = 0
        let transport = InMemoryPCAHTTPTransport { request in
            if request.url?.path.hasSuffix("/ack") == true {
                acks += 1
                var replacement = capturedRoot; replacement.seed.attemptId = "e\u{0301}"
                XCTAssertTrue(roots.save(replacement))
            }
            return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
        }
        let state = InMemoryPCADeviceStateStore()
        let session = PCADeviceSession(deviceId: "device-1", sessionToken: "token", expiresAt: Date().addingTimeInterval(60))
        try state.saveSession(session)
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: state,
            firstDeviceRootStore: roots, runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport), inboundInbox: inbox)
        await model.synchronizeRuntime()
        XCTAssertEqual(acks, 1)
        XCTAssertEqual(try inbox.pendingAcknowledgements(scope: response.scope).count, 1)
        XCTAssertEqual(try state.loadSession(), session)
    }

    @MainActor func testRuntimeHostSessionReplacementDuringPullNeverAcksOrDeletesNewSession() async throws {
        for responseStatus in [200, 401] {
            let attempts = InMemoryPCADeviceStateStore()
            let old = PCADeviceSession(deviceId: "device-1", sessionToken: "old-session", expiresAt: Date().addingTimeInterval(60))
            let replacement = PCADeviceSession(deviceId: "device-2", sessionToken: "new-session", expiresAt: Date().addingTimeInterval(60))
            try attempts.saveSession(old)
            var acks = 0
            let transport = InMemoryPCAHTTPTransport { request in
                if request.httpMethod == "GET" {
                    try attempts.saveSession(replacement)
                    return PCAHTTPResponse(statusCode: responseStatus, data: Data(#"{"scope":{"familyId":"family-1","recipientDeviceId":"device-1"},"applied":[],"unparseableMessageIds":[],"droppedForListBound":[]}"#.utf8))
                }
                if request.url?.path.hasSuffix("/ack") == true { acks += 1 }
                return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
            }
            let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: attempts,
                runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
                inboundInbox: PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "race-test"))
            await model.synchronizeRuntime()
            XCTAssertEqual(try attempts.loadSession(), replacement)
            XCTAssertEqual(acks, 0)
        }
    }

    @MainActor func testRuntimeHostFailedCustodyOrMissingInboxNeverAcknowledges() async throws {
        for mode in [0, 1, 2] {
            let keychain = FaultingInboxKeychain()
            keychain.failReplace = mode == 0
            keychain.corruptReadback = mode == 1
            var acks = 0
            let response = try inboundResponse()
            let responseData = try JSONSerialization.data(withJSONObject: ["scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
                "applied": [try JSONSerialization.jsonObject(with: JSONEncoder().encode(response.applied[0]))],
                "unparseableMessageIds": [], "droppedForListBound": []])
            let transport = InMemoryPCAHTTPTransport { request in
                if request.httpMethod == "GET" { return PCAHTTPResponse(statusCode: 200, data: responseData) }
                if request.url?.path.hasSuffix("/ack") == true { acks += 1 }
                return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
            }
            let attempts = InMemoryPCADeviceStateStore()
            try attempts.saveSession(PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60)))
            let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: attempts,
                runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
                inboundInbox: mode == 2 ? nil : PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "failed-host"))
            await model.synchronizeRuntime()
            XCTAssertEqual(acks, 0)
            XCTAssertNotEqual(model.syncConnectionState, .live)
        }
    }

    @MainActor func testRuntimeHostLostAckAndMarkerFailureRetryFromRestoredInbox() async throws {
        for failMarker in [false, true] {
            let keychain = FaultingInboxKeychain()
            let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "retry-host")
            let response = try inboundResponse()
            let responseData = try JSONSerialization.data(withJSONObject: ["scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
                "applied": [try JSONSerialization.jsonObject(with: JSONEncoder().encode(response.applied[0]))],
                "unparseableMessageIds": [], "droppedForListBound": []])
            let emptyData = Data(#"{"scope":{"familyId":"family-1","recipientDeviceId":"device-1"},"applied":[],"unparseableMessageIds":[],"droppedForListBound":[]}"#.utf8)
            var serverAcked = false
            var ackCalls = 0
            let transport = InMemoryPCAHTTPTransport { request in
                if request.httpMethod == "GET" { return PCAHTTPResponse(statusCode: 200, data: serverAcked ? emptyData : responseData) }
                if request.url?.path.hasSuffix("/ack") == true {
                    ackCalls += 1
                    serverAcked = true
                    if ackCalls == 1 {
                        if failMarker { keychain.failOnReplaceCall = keychain.replaceCalls + 2 }
                        else { throw PCAHTTPTransportError.network }
                    }
                }
                return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
            }
            let attempts = InMemoryPCADeviceStateStore()
            try attempts.saveSession(PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60)))
            let client = try PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
            let first = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: attempts,
                runtimeSyncClient: client, inboundInbox: inbox)
            await first.synchronizeRuntime()
            keychain.failReplace = false
            XCTAssertEqual(try inbox.pendingAcknowledgements(scope: response.scope).count, 1)
            let restored = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "retry-host")
            let second = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: attempts,
                runtimeSyncClient: client, inboundInbox: restored)
            await second.synchronizeRuntime()
            XCTAssertEqual(ackCalls, 2)
            XCTAssertTrue(try restored.pendingAcknowledgements(scope: response.scope).isEmpty)
            XCTAssertEqual(try restored.pendingCrypto(scope: response.scope).count, 1)
            XCTAssertNotEqual(second.syncConnectionState, .live)
        }
    }

    @MainActor func testRuntimeHostSessionReplacementDuringAckPreservesReplacement() async throws {
        let attempts = InMemoryPCADeviceStateStore()
        let old = PCADeviceSession(deviceId: "device-1", sessionToken: "old-session", expiresAt: Date().addingTimeInterval(60))
        let replacement = PCADeviceSession(deviceId: "device-2", sessionToken: "new-session", expiresAt: Date().addingTimeInterval(60))
        try attempts.saveSession(old)
        let response = try inboundResponse()
        let responseData = try JSONSerialization.data(withJSONObject: ["scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
            "applied": [try JSONSerialization.jsonObject(with: JSONEncoder().encode(response.applied[0]))],
            "unparseableMessageIds": [], "droppedForListBound": []])
        var reports = 0
        let transport = InMemoryPCAHTTPTransport { request in
            if request.httpMethod == "GET" { return PCAHTTPResponse(statusCode: 200, data: responseData) }
            if request.url?.path.hasSuffix("/ack") == true { try attempts.saveSession(replacement) }
            else { reports += 1 }
            return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
        }
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: attempts,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
            inboundInbox: PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "ack-race"))
        await model.synchronizeRuntime()
        XCTAssertEqual(try attempts.loadSession(), replacement)
        XCTAssertEqual(reports, 0)
        XCTAssertNotEqual(model.syncConnectionState, .live)
    }

    @MainActor func testRuntimeKeyLossStopsCachedSessionBeforePullWithoutDeletingSecrets() async throws {
        let attempts = InMemoryPCADeviceStateStore()
        let retainedSession = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60))
        try attempts.saveSession(retainedSession)
        var requests = 0
        let transport = InMemoryPCAHTTPTransport { _ in
            requests += 1
            return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
        }
        let model = try makeEnrollmentModel(identityStore: RecordingDeviceIdentityStore(), attemptStore: attempts,
            runtimeSyncClient: PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
            inboundInbox: PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "lost-key"),
            assertRuntimeKeyCustody: { _ in throw PCADeviceProofError.secureKeyUnavailable })
        await model.synchronizeRuntime()
        XCTAssertEqual(requests, 0)
        XCTAssertEqual(try attempts.loadSession(), retainedSession)
        XCTAssertEqual(model.lastError, .securityGate)
        XCTAssertNotEqual(model.syncConnectionState, .live)
    }

    func testRuntimeAckEncodesOpaqueMessageIdAsOnePathComponent() async throws {
        for (id, encoded) in [("a/b?c#d%e", "a%2Fb%3Fc%23d%25e"), (".", "%2E"), ("..", "%2E%2E")] {
            let transport = InMemoryPCAHTTPTransport { request in
                XCTAssertEqual(request.url?.absoluteString, "https://api.example.test/v1/runtime-sync/inbound/\(encoded)/ack")
                return PCAHTTPResponse(statusCode: 200, data: Data("{}".utf8))
            }
            let client = try PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
            try await client.acknowledge(messageId: id, session: PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60)))
        }
    }

    func testInboundInboxScopeReplacementByteBoundAndInvalidBatchPreservePreviousData() throws {
        let keychain = FaultingInboxKeychain()
        let inbox = PCAKeychainInboundInboxStore(keychain: keychain, serviceNamespace: "bounded-inbox", maxBytes: 1500)
        let response = try inboundResponse()
        try inbox.capture(response, sessionDeviceId: "device-1")
        let original = keychain.data
        for scope in [PCAInboundScope(familyId: "other-family", recipientDeviceId: "device-1"),
                      PCAInboundScope(familyId: "family-1", recipientDeviceId: "other-device")] {
            let changed = PCAInboundRuntimeSyncResponse(scope: scope, applied: [], unparseableMessageIds: [], droppedForListBound: [])
            XCTAssertThrowsError(try inbox.capture(changed, sessionDeviceId: scope.recipientDeviceId))
            XCTAssertEqual(keychain.data, original)
        }
        let valid = try inboundResponse(id: "message-2")
        let invalid = try inboundResponse(id: "message-3") { $0["familyId"] = "wrong-family" }
        let batch = PCAInboundRuntimeSyncResponse(scope: response.scope, applied: valid.applied + invalid.applied,
            unparseableMessageIds: [], droppedForListBound: [])
        XCTAssertThrowsError(try inbox.capture(batch, sessionDeviceId: "device-1"))
        XCTAssertEqual(keychain.data, original)
        let large = try inboundResponse(id: "message-2") { $0["signature"] = String(repeating: "s", count: 500) }
        XCTAssertThrowsError(try inbox.capture(large, sessionDeviceId: "device-1"))
        XCTAssertEqual(keychain.data, original)
        keychain.failReplace = true
        XCTAssertThrowsError(try inbox.capture(valid, sessionDeviceId: "device-1"))
        XCTAssertEqual(keychain.data, original)
    }

    private func makeEnrollmentModel(
        identityStore: RecordingDeviceIdentityStore,
        attemptStore: PCADeviceSessionStore & PCAEnrollmentAttemptStore,
        firstDeviceRootStore: FirstDeviceRootStoring? = nil,
        firstDeviceTrustRootCoordinator: FirstDeviceTrustRootCoordinating? = nil,
        proofProvider: PCADeviceProofProvider = TestEnrollmentProofProvider(),
        keyDeletion: FirstDeviceKeyPairDeletion? = nil,
        bootstrapStatus: String = "PAIRED",
        sessionClient: PCADeviceSessionClient? = nil,
        runtimeSyncClient: PCADeviceRuntimeSyncClient? = nil,
        inboundInbox: PCAInboundInboxStoring? = nil,
        inboundConsumer: PCAInboundCommandConsumer? = nil,
        assertRuntimeKeyCustody: @escaping (String) throws -> Void = { _ in },
        policyRuntime: PCAProtectionPolicyRuntime = PCAUnavailableProtectionPolicyRuntime(),
        authorizationStatus: RawAuthorizationStatus = .approved
    ) throws -> PCAApplicationModel {
        let authorizationSource = FakeAuthorizationStatusSource()
        authorizationSource.status = authorizationStatus
        let authorizationCenter = ChildAuthorizationCenter(source: authorizationSource)
        // Runtime fixtures use an explicit committed root; this is not real-device evidence.
        let runtimeRoot = firstDeviceRootStore ?? (runtimeSyncClient == nil ? nil :
            InMemoryFirstDeviceRootStore(record: FirstDeviceRootRecord(seed: trustRootSeed(), state: .rootCommitted, familyId: "family-1")))
        let transport = InMemoryPCAHTTPTransport { _ in
            PCAHTTPResponse(statusCode: 200, data: Data("{\"deviceId\":\"device-1\",\"signingKeyId\":\"key-1\",\"encryptionKeyId\":\"key-2\",\"status\":\"\(bootstrapStatus)\",\"childProfileId\":\"child-1\",\"ageUxTier\":\"TEEN\",\"initialPolicyProfile\":\"BALANCED\"}".utf8))
        }
        let dependencies = PCAProductionDependencies(
            authorizationCenter: authorizationCenter,
            enrollmentCoordinator: ChildEnrollmentCoordinator(
                keyMaterialStore: FamilyKeyMaterialStore(keychain: InMemoryKeychainStore(), serviceNamespace: "org.pca.test"),
                authorizationCenter: authorizationCenter
            ),
            enrollmentClient: try PCAEnrollmentBootstrapClient(baseURL: URL(string: "https://api.example.test")!, transport: transport),
            sessionClient: sessionClient,
            runtimeSyncClient: runtimeSyncClient,
            inboundInbox: inboundInbox,
            inboundConsumer: inboundConsumer,
            assertRuntimeKeyCustody: assertRuntimeKeyCustody,
            sessionStore: attemptStore,
            attemptStore: attemptStore,
            profileStore: InMemoryPCAEnrollmentProfileStore(),
            proofProvider: proofProvider,
            keyDeletion: keyDeletion,
            firstDeviceRootStore: runtimeRoot,
            firstDeviceTrustRootCoordinator: firstDeviceTrustRootCoordinator,
            policyRuntime: policyRuntime,
            protectionRuntime: PCAHostProtectionRuntime(),
            deviceIdentityStore: identityStore
        )
        return PCAApplicationModel(dependencies: dependencies)
    }

    private func waitForRejectedEnrollment(_ model: PCAApplicationModel) async {
        for _ in 0..<100 {
            if model.applicationState == .error(.permanent) { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(model.applicationState, .error(.permanent))
        XCTAssertEqual(model.lastError, .permanent)
    }

    private func waitForRecoverableEnrollment(_ model: PCAApplicationModel) async {
        for _ in 0..<100 {
            if model.applicationState == .error(.recoverable) { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(model.applicationState, .error(.recoverable))
        XCTAssertEqual(model.lastError, .recoverable)
    }

    private func waitForEnrollmentSecurityGate(_ model: PCAApplicationModel) async {
        for _ in 0..<100 {
            if model.applicationState == .enrollmentBlockedBySecurityGate { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(model.applicationState, .enrollmentBlockedBySecurityGate)
        XCTAssertEqual(model.lastError, .securityGate)
    }

    private func waitForEnrollmentInProgress(_ model: PCAApplicationModel) async {
        for _ in 0..<100 {
            if model.applicationState == .enrollmentInProgress { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(model.applicationState, .enrollmentInProgress)
    }

    private func trustRootSeed() -> FirstDeviceCeremonySeed {
        FirstDeviceCeremonySeed(
            attemptId: "attempt0000000001",
            attemptRecoveryToken: "recovery-token",
            serverBaseUrl: "https://api.example.test",
            deviceId: "device-1",
            signingKeyId: "55555555-5555-4555-8555-555555555555",
            encryptionKeyId: "66666666-6666-4666-8666-666666666666",
            dskPublicKeyBase64: "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A",
            dekPublicKeyBase64: "BP_-_fz7-vn49_b19PPy8fDv7u3s6-rp6Ofm5eTj4uHg397d3Nva2djX1tXU09LR0M_OzczLysnIx8bFxMPCwcA",
            dskAlias: "pca.dsk.attempt0000000001",
            dekAlias: "pca.dek.attempt0000000001"
        )
    }

    func testRuntimeProtectionStatusUsesExistingAuthenticatedRoute() async throws {
        let transport = InMemoryPCAHTTPTransport { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/v1/runtime-sync/protection-status")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer opaque-session")
            XCTAssertEqual(request.httpBody, Data(#"{"protectionLevel":"PROTECTED"}"#.utf8))
            return PCAHTTPResponse(statusCode: 204, data: Data())
        }
        let client = try PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
        let session = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60))
        try await client.reportProtectionStatus(.active, session: session)
    }

    func testRuntimeModernNavigationRequiresCompleteBoundedMetadata() throws {
        let base: [String: Any] = ["scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
            "applied": [], "unparseableMessageIds": [], "droppedForListBound": [],
            "hasMore": true, "nextCursor": "cursor1", "hasUnresolved": true,
            "sessionIncarnation": String(repeating: "a", count: 64),
            "receipts": [["messageId": "held-1", "outcome": "HELD_PENDING", "atUtc": "2026-10-07T00:00:00.000Z"]]]
        func decode(_ value: [String: Any]) throws -> PCAInboundRuntimeSyncResponse {
            try JSONDecoder().decode(PCAInboundRuntimeSyncResponse.self, from: JSONSerialization.data(withJSONObject: value))
        }
        let valid = try decode(base)
        XCTAssertEqual(valid.navigation?.nextCursor, "cursor1")
        XCTAssertEqual(valid.receipts.first?.outcome, .heldPending)
        for key in ["nextCursor", "hasUnresolved", "sessionIncarnation", "receipts", "hasMore"] {
            var partial = base
            partial.removeValue(forKey: key)
            XCTAssertThrowsError(try decode(partial))
        }
        for (key, value) in [("hasUnresolved", NSNull() as Any), ("sessionIncarnation", "wrong" as Any),
                              ("nextCursor", NSNull() as Any), ("nextCursor", String(repeating: "a", count: 6145) as Any)] {
            var invalid = base
            invalid[key] = value
            XCTAssertThrowsError(try decode(invalid))
        }
        var terminal = base
        terminal["hasMore"] = false
        terminal["nextCursor"] = NSNull()
        XCTAssertNil(try decode(terminal).navigation?.nextCursor)
        var duplicate = base
        let receiptRows = base["receipts"] as! [[String: Any]]
        duplicate["receipts"] = receiptRows + receiptRows
        XCTAssertThrowsError(try decode(duplicate))
    }

    func testPublishedLegacyReceiptsDoNotRequireNewNavigationFields() throws {
        for outcomes in [[], ["APPLIED"], ["HELD_PENDING"], ["REJECTED"]] as [[String]] {
            let receipts = outcomes.map { ["messageId": "message-1", "outcome": $0, "atUtc": "2026-10-07T00:00:00.000Z"] }
            let body: [String: Any] = ["scope": ["familyId": "family-1", "recipientDeviceId": "device-1"],
                "applied": [], "unparseableMessageIds": [], "droppedForListBound": [], "hasMore": false, "receipts": receipts]
            let response = try JSONDecoder().decode(PCAInboundRuntimeSyncResponse.self, from: JSONSerialization.data(withJSONObject: body))
            XCTAssertNil(response.navigation)
            XCTAssertEqual(response.receipts.count, outcomes.count)
            let inbox = PCAKeychainInboundInboxStore(keychain: InMemoryKeychainStore(), serviceNamespace: "legacy-receipt-\(outcomes.first ?? "empty")")
            try inbox.capture(response, sessionDeviceId: "device-1")
            XCTAssertEqual(try inbox.hasUnresolvedRelayWork(), outcomes.contains { $0 != "APPLIED" })
            XCTAssertTrue(try inbox.pendingAcknowledgements(scope: response.scope).isEmpty)
        }
    }

    func testRuntimePullSendsCursorAndDistinguishesNavigationRejection() async throws {
        let transport = InMemoryPCAHTTPTransport { request in
            if request.url?.query != nil {
                XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems,
                               [URLQueryItem(name: "cursor", value: "cursor1")])
            }
            return PCAHTTPResponse(statusCode: 400, data: Data(#"{"error":"invalid_cursor"}"#.utf8))
        }
        let client = try PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
        let session = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60))
        do {
            _ = try await client.pull(session: session, cursor: "cursor1")
            XCTFail("Expected navigation rejection")
        } catch PCAInboundNavigationError.invalidCursor { }
        do {
            _ = try await client.pull(session: session)
            XCTFail("Expected ordinary rejection without navigation")
        } catch {
            XCTAssertEqual(error as? PCAAPIError, .invalidRequest)
        }
    }

    func testRuntimePullPropagatesCancellation() async throws {
        let transport = InMemoryPCAHTTPTransport { _ in throw CancellationError() }
        let client = try PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
        let session = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60))
        do {
            _ = try await client.pull(session: session)
            XCTFail("Cancellation must propagate")
        } catch is CancellationError { }
    }

    func testProductionURLSessionTransportPreservesCancelledURLError() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CancelledRuntimeURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let transport = PCAURLSessionTransport(session: session)
        do {
            _ = try await transport.send(URLRequest(url: URL(string: "https://api.example.test/v1/runtime-sync/inbound")!))
            XCTFail("Production cancellation must not become a network failure")
        } catch is CancellationError { }
    }

    func testRuntimePullDecodesContinuationAndUsesDeferredIdsForLegacyResponses() async throws {
        let cases: [(dropped: String, continuation: String?, expected: Bool)] = [
            ("[]", nil, false),
            ("[\"deferred-message\"]", nil, true),
            ("[]", "true", true),
            ("[]", "false", false),
        ]
        for value in cases {
            let continuationField = value.continuation.map { ",\"hasMore\":\($0)" } ?? ""
            let transport = InMemoryPCAHTTPTransport { request in
                XCTAssertEqual(request.httpMethod, "GET")
                XCTAssertEqual(request.url?.path, "/v1/runtime-sync/inbound")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer opaque-session")
                return PCAHTTPResponse(statusCode: 200, data: Data("{\"scope\":{\"familyId\":\"family-1\",\"recipientDeviceId\":\"device-1\"},\"applied\":[],\"unparseableMessageIds\":[],\"droppedForListBound\":\(value.dropped)\(continuationField)}".utf8))
            }
            let client = try PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
            let session = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60))
            let result = try await client.pull(session: session)
            XCTAssertEqual(result.droppedForListBound, value.dropped == "[]" ? [] : ["deferred-message"])
            XCTAssertEqual(result.hasMore, value.expected)
        }

        for malformed in ["null", "\"true\"", "1"] {
            let transport = InMemoryPCAHTTPTransport { _ in
                PCAHTTPResponse(statusCode: 200, data: Data("{\"scope\":{\"familyId\":\"family-1\",\"recipientDeviceId\":\"device-1\"},\"applied\":[],\"unparseableMessageIds\":[],\"droppedForListBound\":[],\"hasMore\":\(malformed)}".utf8))
            }
            let client = try PCADeviceRuntimeSyncClient(baseURL: URL(string: "https://api.example.test")!, transport: transport)
            let session = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date().addingTimeInterval(60))
            do {
                _ = try await client.pull(session: session)
                XCTFail("Expected malformed hasMore value \(malformed) to be rejected")
            } catch {
                XCTAssertEqual(error as? PCAAPIError, .malformedResponse)
            }
        }
        XCTAssertThrowsError(try JSONDecoder().decode(PCAInboundRuntimeSyncResponse.self,
            from: Data(#"{"applied":[],"unparseableMessageIds":[],"droppedForListBound":false}"#.utf8)))
    }

    func testProductionBaseURLRejectsHTTP() {
        XCTAssertThrowsError(try PCAEnrollmentBootstrapClient(baseURL: URL(string: "http://localhost:4001")!, transport: InMemoryPCAHTTPTransport { _ in fatalError() })) { error in
            XCTAssertEqual(error as? PCAAPIError, .invalidConfiguration)
        }
    }

    func testSessionAndRecoveryMaterialUseReplacementAndDeletionSemantics() throws {
        let keychain = InMemoryKeychainStore()
        let store = PCAKeychainDeviceStateStore(keychain: keychain, serviceNamespace: "org.pca.test")
        let first = PCADeviceSession(deviceId: "device-1", sessionToken: "opaque-session", expiresAt: Date(timeIntervalSince1970: 10))
        try store.saveSession(first)
        XCTAssertEqual(try store.loadSession(), first)
        XCTAssertEqual(keychain.storedAccessibility(forAccount: "current.session", service: "org.pca.test.device-state"), .whenUnlockedThisDeviceOnly)
        try store.saveAttempt(PCAEnrollmentAttempt(attemptId: "attempt-1", attemptRecoveryToken: "opaque-recovery"))
        XCTAssertEqual(try store.loadAttempt()?.attemptId, "attempt-1")
        try store.clearSession()
        try store.clearAttempt()
        XCTAssertNil(try store.loadSession())
        XCTAssertNil(try store.loadAttempt())
        XCTAssertEqual(keychain.storedAccessibility(forAccount: "current.session", service: "org.pca.test.device-state"), nil)
    }

    func testCryptoActivationBoundaryFailsClosed() {
        let provider = PendingPCADeviceProofProvider()
        XCTAssertThrowsError(try provider.sign(challenge: "nonce")) { error in
            XCTAssertEqual(error as? PCADeviceProofError, .cryptoActivationPending)
        }
    }

    func testPolicyApplicationBoundaryFailsClosedWithoutApprovedRuntime() {
        let runtime = PCAUnavailableProtectionPolicyRuntime()
        XCTAssertThrowsError(try runtime.applyVerifiedPolicy(
            scheduleData: Data("{}".utf8),
            applicationTokenData: Data(),
            protectedApplicationTokenData: nil,
            now: Date()
        )) { error in
            XCTAssertEqual(error as? PCAProtectionPolicyApplicationError, .frameworkUnavailable)
        }
    }

    func testAuthorizationApprovalAloneNeverClaimsProtectionActive() {
        let runtime = PCAHostProtectionRuntime()
        runtime.authorizationChanged(.approved)
        XCTAssertEqual(runtime.status, .notReady)
        runtime.recordPolicyApplication(.active)
        XCTAssertEqual(runtime.status, .active)
        runtime.authorizationChanged(.revoked(to: .denied))
        XCTAssertEqual(runtime.status, .degraded)
    }
}

private final class RecordingDeviceIdentityStore: PCADeviceIdentityStore {
    private(set) var savedDeviceIds: [String] = []
    func loadDeviceId() -> String? { savedDeviceIds.last }
    func saveDeviceId(_ deviceId: String) { savedDeviceIds.append(deviceId) }
}

private final class RecordingKeyDeletion: FirstDeviceKeyPairDeletion {
    private(set) var keepSets: [Set<String>] = []
    func deleteKeyPair(alias: String) {}
    func deleteOrphanedAttemptKeys(keepAttemptIds: Set<String>) { keepSets.append(keepAttemptIds) }
}

private final class SwitchableFirstDeviceRootStore: FirstDeviceRootStoring {
    private let backing = InMemoryFirstDeviceRootStore()
    var failCapture = true
    var failCurrent = false
    func current() -> FirstDeviceRootRecord? { failCurrent ? nil : backing.current() }
    func save(_ record: FirstDeviceRootRecord) -> Bool { backing.save(record) }
    func clear() { backing.clear() }
    func writeIfCurrent(expected: FirstDeviceRootRecord?, record: FirstDeviceRootRecord) -> Bool {
        backing.writeIfCurrent(expected: expected, record: record)
    }
    func captureSeed(_ candidate: FirstDeviceRootRecord, replacingTerminalStates: [FirstDeviceRootState]) -> Bool {
        guard !failCapture else { return false }
        return backing.captureSeed(candidate, replacingTerminalStates: replacingTerminalStates)
    }
    func confirmDurable(_ record: FirstDeviceRootRecord) -> Bool { backing.confirmDurable(record) }
    func flush() { backing.flush() }
}

private final class ManualTrustRootCoordinator: FirstDeviceTrustRootCoordinating {
    var record: FirstDeviceRootRecord?
    var onRecordChanged: ((FirstDeviceRootRecord?) -> Void)?
    func beginCeremony() async {}
    func refreshStatus() async {}
    func submit() async {}
    func resubmitExact() async {}
}

private final class TrustRootFlowApi: FirstDeviceBootstrapApiClienting {
    var challengeResponse = FirstDeviceChallengeResponse(
        ceremonyId: "33333333-3333-4333-8333-333333333333",
        challengeId: "44444444-4444-4444-8444-444444444444",
        nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        expiresAt: "2026-10-02T00:00:00.000Z",
        familyId: "11111111-1111-4111-8111-111111111111",
        deviceId: "device-1"
    )
    var statusResponse = FirstDeviceStatusResponse(status: "PENDING", outcome: nil)
    var submitResponse = FirstDeviceSubmitResponse(status: "ACCEPTED")
    var challengeError: FirstDeviceBootstrapError?
    private(set) var challengeCalls = 0
    private(set) var statusCalls = 0
    private(set) var submissions: [FirstDeviceSubmissionPayload] = []

    func challenge(attemptId: String, attemptRecoveryToken: String, dskKeyId: String, dskPublicKeyBase64: String) async throws -> FirstDeviceChallengeResponse {
        challengeCalls += 1
        if let challengeError { throw challengeError }
        return challengeResponse
    }

    func submit(attemptId: String, attemptRecoveryToken: String, ceremonyId: String, proofBytes: String, proofSignature: String, epoch1Bytes: String, epoch1Signature: String, attestationEvidence: String) async throws -> FirstDeviceSubmitResponse {
        submissions.append(FirstDeviceSubmissionPayload(
            proofBytes: proofBytes,
            proofSignature: proofSignature,
            epoch1Bytes: epoch1Bytes,
            epoch1Signature: epoch1Signature,
            attestationEvidence: attestationEvidence
        ))
        return submitResponse
    }

    func status(attemptId: String, attemptRecoveryToken: String, ceremonyId: String) async throws -> FirstDeviceStatusResponse {
        statusCalls += 1
        return statusResponse
    }
}

private final class TrustRootFlowKeyMaterial: FirstDeviceDskKeyMaterial {
    private(set) var signCount = 0

    func signingKeyAlias(attemptId: String) -> String { "pca.dsk." + attemptId }
    func encryptionKeyAlias(attemptId: String) -> String { "pca.dek." + attemptId }
    func loadPublicKeyBase64(alias: String) throws -> String { "unused-test-public-key" }
    func generateSigningKeyPair(attemptId: String) throws -> GeneratedDskKeyPair {
        GeneratedDskKeyPair(publicKeyBase64: "unused-test-public-key", privateKeyAlias: signingKeyAlias(attemptId: attemptId))
    }
    func generateEncryptionKeyPair(attemptId: String) throws -> GeneratedDskKeyPair {
        GeneratedDskKeyPair(publicKeyBase64: "unused-test-public-key", privateKeyAlias: encryptionKeyAlias(attemptId: attemptId))
    }
    func signCanonical(alias: String, message: Data) throws -> Data {
        signCount += 1
        return Data(repeating: 0x33, count: 64)
    }
}

private final class TrustRootFlowEvidenceBuilder: FirstDeviceEvidenceBuilding {
    private(set) var callCount = 0

    func buildEvidence(transcript: String, dskKeyId: String, dskPublicKeyBase64: String) async throws -> IosAppAttestEvidence {
        callCount += 1
        return IosAppAttestEvidence(json: #"{"v":1,"platform":"IOS"}"#, keyIdBase64Url: "test-app-attest-key")
    }
}

private struct TestEnrollmentProofProvider: PCADeviceProofProvider {
    let signingPublicKey = "test-signing-public-key"
    let encryptionPublicKey = "test-encryption-public-key"
    func sign(challenge: String) throws -> String { "test-signature" }
}

private struct EmptyEnrollmentProofProvider: PCADeviceProofProvider {
    let signingPublicKey = ""
    let encryptionPublicKey = ""
    func sign(challenge: String) throws -> String { throw PCADeviceProofError.secureKeyUnavailable }
}

private extension Array where Element == PCAStoredInboundEnvelope {
    var singleEnvelope: PCAInboundEnvelope? { count == 1 ? first?.envelope : nil }
}

private final class LockedRuntimeDeviceStateStore: PCADeviceSessionStore, PCAEnrollmentAttemptStore {
    private(set) var clearCalls = 0
    func loadSession() throws -> PCADeviceSession? { throw KeychainStoreError.unexpectedStatus(-25308) }
    func saveSession(_ session: PCADeviceSession) throws { throw KeychainStoreError.unexpectedStatus(-25308) }
    func clearSession() throws { clearCalls += 1 }
    func loadAttempt() throws -> PCAEnrollmentAttempt? { throw KeychainStoreError.unexpectedStatus(-25308) }
    func saveAttempt(_ attempt: PCAEnrollmentAttempt) throws { throw KeychainStoreError.unexpectedStatus(-25308) }
    func clearAttempt() throws { clearCalls += 1 }
}

private final class CancelledRuntimeURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.cancelled)) }
    override func stopLoading() { }
}

private final class FaultingInboxKeychain: KeychainStoreProtocol {
    var data: Data?
    var failReplace = false
    var failOnReplaceCall: Int?
    var replaceCalls = 0
    var corruptReadback = false
    func store(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
        try storeReplacingAtomically(data, forAccount: account, service: service, accessibility: accessibility)
    }
    func storeReplacingAtomically(_ data: Data, forAccount account: String, service: String, accessibility: KeychainAccessibility) throws {
        replaceCalls += 1
        if failReplace || replaceCalls == failOnReplaceCall { throw KeychainStoreError.unexpectedStatus(-1) }
        self.data = data
    }
    func retrieve(forAccount account: String, service: String) throws -> Data {
        guard let data else { throw KeychainStoreError.itemNotFound }
        return corruptReadback ? Data("{}".utf8) : data
    }
    func delete(forAccount account: String, service: String) throws { data = nil }
}
