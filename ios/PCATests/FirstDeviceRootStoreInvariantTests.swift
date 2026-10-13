import XCTest
@testable import PCA

final class FirstDeviceRootStoreInvariantTests: XCTestCase {
    private func seed() -> FirstDeviceCeremonySeed {
        FirstDeviceCeremonySeed(
            attemptId: "attempt-0000000000000000",
            attemptRecoveryToken: "recovery-token",
            serverBaseUrl: "https://api.example.test",
            deviceId: "device-1",
            signingKeyId: "dsk-1",
            encryptionKeyId: "dek-1",
            dskPublicKeyBase64: "dsk-public",
            dekPublicKeyBase64: "dek-public",
            dskAlias: "pca.dsk.attempt-0000000000000000",
            dekAlias: "pca.dek.attempt-0000000000000000"
        )
    }

    func testExpiredRecordWithSignedSubmissionIsUnreadableAndCannotBeReplaced() throws {
        let keychain = InMemoryKeychainStore()
        let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.expired-invariant")
        let contradictory = FirstDeviceRootRecord(
            seed: seed(),
            state: .expired,
            ceremonyId: "ceremony-1",
            submission: FirstDeviceSubmissionPayload(
                proofBytes: "signed-proof",
                proofSignature: "proof-signature",
                epoch1Bytes: "signed-epoch",
                epoch1Signature: "epoch-signature",
                attestationEvidence: "evidence"
            )
        )
        let validJSON = try JSONEncoder().encode(contradictory)
        let service = "org.pca.expired-invariant.\(KeychainFirstDeviceRootStore.defaultServiceSuffix)"
        try keychain.store(validJSON, forAccount: KeychainFirstDeviceRootStore.defaultAccount,
            service: service, accessibility: .whenUnlockedThisDeviceOnly)

        XCTAssertNil(store.current(), "EXPIRED cannot retain replayable signed material")
        let replacement = FirstDeviceRootRecord(seed: seed())
        XCTAssertFalse(store.captureSeed(replacement, replacingTerminalStates: [.expired, .rejected]))
        XCTAssertEqual(
            try keychain.retrieve(forAccount: KeychainFirstDeviceRootStore.defaultAccount, service: service),
            validJSON,
            "a contradictory terminal record must remain untouched, not be replaced as valid EXPIRED state"
        )
    }

    func testStoreRefusesToWriteExpiredRecordWithSubmission() {
        let keychain = InMemoryKeychainStore()
        let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.expired-write")
        let contradictory = FirstDeviceRootRecord(
            seed: seed(),
            state: .expired,
            submission: FirstDeviceSubmissionPayload(
                proofBytes: "signed-proof",
                proofSignature: "proof-signature",
                epoch1Bytes: "signed-epoch",
                epoch1Signature: "epoch-signature",
                attestationEvidence: "evidence"
            )
        )

        XCTAssertFalse(store.save(contradictory))
        XCTAssertNil(store.current())
    }

    func testExpiredAndRejectedRecordsWithAcceptedRootMaterialAreUnreadableAndCannotBeReplaced() throws {
        for state in [FirstDeviceRootState.expired, .rejected] {
            let keychain = InMemoryKeychainStore()
            let namespace = "org.pca.terminal-root-material-\(state.rawValue.lowercased())"
            let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: namespace)
            var contradictory = FirstDeviceRootRecord(seed: seed(), state: state)
            contradictory.acceptedEpoch1 = FirstDeviceAcceptedEpochAnchor(
                canonicalBytes: "accepted-epoch-bytes",
                signature: "accepted-epoch-signature"
            )
            contradictory.committedAtMillis = 1_759_766_400_000
            let validJSON = try JSONEncoder().encode(contradictory)
            let service = "\(namespace).\(KeychainFirstDeviceRootStore.defaultServiceSuffix)"
            try keychain.store(validJSON, forAccount: KeychainFirstDeviceRootStore.defaultAccount,
                service: service, accessibility: .whenUnlockedThisDeviceOnly)

            XCTAssertNil(store.current(), "\(state) cannot coexist with server-accepted root material")
            XCTAssertFalse(store.captureSeed(
                FirstDeviceRootRecord(seed: seed()),
                replacingTerminalStates: [.expired, .rejected]
            ), "contradictory terminal material must not be treated as replaceable")
            XCTAssertEqual(
                try keychain.retrieve(forAccount: KeychainFirstDeviceRootStore.defaultAccount, service: service),
                validJSON,
                "the store must preserve the unreadable record for diagnosis rather than overwrite it"
            )
            XCTAssertFalse(store.save(contradictory), "writes must enforce the same terminal-state invariant")
        }
    }

    func testRejectedRecordRetainsExactSubmissionForStatusFirstRecoveryAndCanBeReplaced() {
        let keychain = InMemoryKeychainStore()
        let store = KeychainFirstDeviceRootStore(keychain: keychain, serviceNamespace: "org.pca.rejected-retry")
        var replacementSeed = seed()
        replacementSeed.attemptId = "attempt-0000000000000001"
        replacementSeed.dskAlias = "pca.dsk.attempt-0000000000000001"
        replacementSeed.dekAlias = "pca.dek.attempt-0000000000000001"
        let rejected = FirstDeviceRootRecord(
            seed: seed(),
            state: .rejected,
            submission: FirstDeviceSubmissionPayload(
                proofBytes: "signed-proof",
                proofSignature: "proof-signature",
                epoch1Bytes: "signed-epoch",
                epoch1Signature: "epoch-signature",
                attestationEvidence: "evidence"
            )
        )

        XCTAssertTrue(store.save(rejected), "REJECTED retains exact submitted bytes until a new enrollment supersedes it")
        XCTAssertEqual(store.current(), rejected)
        XCTAssertTrue(store.captureSeed(
            FirstDeviceRootRecord(seed: replacementSeed),
            replacingTerminalStates: [.expired, .rejected]
        ), "an internally consistent REJECTED record remains an explicitly replaceable terminal state")
        XCTAssertEqual(store.current()?.seed.attemptId, replacementSeed.attemptId)
        XCTAssertEqual(store.current()?.state, .notStarted)
    }
}
