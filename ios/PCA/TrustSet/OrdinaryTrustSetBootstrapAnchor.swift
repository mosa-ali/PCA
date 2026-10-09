import Foundation

/// Seeds ordinary custody exclusively from the durable confirmed first-device ceremony.
/// Legacy committed records without statement B remain unavailable; never reconstruct or fetch a genesis.
public enum OrdinaryTrustSetBootstrapAnchor {
    @discardableResult
    public static func seed(rootStore: FirstDeviceRootStoring, ordinaryStore: OrdinaryTrustSetStoring,
                            verifier: OrdinaryTrustSetSignatureVerifying) throws -> OrdinaryTrustSetHead {
        var result: Result<OrdinaryTrustSetHead, Error>?
        guard rootStore.withConfirmedCurrentRecord({ root in
            result = Result { try seedConfirmed(root: root, rootStore: rootStore, ordinaryStore: ordinaryStore, verifier: verifier) }
        }), let result else { throw OrdinaryTrustSetError.malformedState }
        return try result.get()
    }

    #if canImport(Security) && canImport(CryptoKit)
    /// Composition reuses enrollment Secure Enclave custody and authenticated device session.
    /// It performs no network operation, root creation, lifecycle activation or policy installation.
    public static func makeCoordinator(rootStore: FirstDeviceRootStoring, keychain: KeychainStoreProtocol,
                                       keyMaterial: FirstDeviceDskSigning, sessionStore: PCADeviceSessionStore,
                                       baseURL: URL) throws -> OrdinaryTrustSetCoordinator {
        guard let root = rootStore.current(), root.state == .rootCommitted, let familyId = root.familyId else {
            throw OrdinaryTrustSetError.malformedState
        }
        let seed = root.seed
        let store = KeychainOrdinaryTrustSetStore(keychain: keychain, account: seed.deviceId)
        let verifier = P256OrdinaryTrustSetSignatureVerifier()
        _ = try Self.seed(rootStore: rootStore, ordinaryStore: store, verifier: verifier)
        guard rootStore.confirmDurable(root) else { throw OrdinaryTrustSetError.responseMismatch }
        let api = try OrdinaryTrustSetAPIClient(baseURL: baseURL, familyId: familyId, sessionToken: {
            guard rootStore.confirmDurable(root), let session = try sessionStore.loadSession(),
                  Data(session.deviceId.utf8) == Data(seed.deviceId.utf8), session.expiresAt > Date() else {
                throw PCAAPIError.unauthorized
            }
            return session.sessionToken
        })
        return OrdinaryTrustSetCoordinator(store: store, signer: keyMaterial, verifier: verifier, transport: api,
            familyId: familyId, deviceId: seed.deviceId, dskKeyId: seed.signingKeyId, dskAlias: seed.dskAlias)
    }
    #endif
    private static func seedConfirmed(root: FirstDeviceRootRecord, rootStore: FirstDeviceRootStoring,
                                      ordinaryStore: OrdinaryTrustSetStoring,
                                      verifier: OrdinaryTrustSetSignatureVerifying) throws -> OrdinaryTrustSetHead {
        guard root.state == .rootCommitted,
              let familyId = root.familyId, let anchor = root.acceptedEpoch1,
              root.committedAtMillis != nil, root.submission == nil,
              root.seed.attemptRecoveryToken.isEmpty, rootStore.confirmDurable(root) else {
            throw OrdinaryTrustSetError.malformedState
        }
        let head = OrdinaryTrustSetHead(familyId: familyId, canonicalBytes: Data(anchor.canonicalBytes.utf8), signature: anchor.signature)
        let epoch = try head.epoch()
        guard epoch.trustSetEpoch == 1, epoch.keyEpoch == 1, epoch.supersedesEpoch == nil, epoch.entries.count == 1 else {
            throw OrdinaryTrustSetError.malformedState
        }
        let owner = epoch.entries[0], seed = root.seed
        guard owner.role == .owner, owner.status == .active,
              Data(owner.deviceId.utf8) == Data(seed.deviceId.utf8),
              Data(owner.dskKeyId.utf8) == Data(seed.signingKeyId.utf8),
              Data(owner.dskPublicKey.utf8) == Data(seed.dskPublicKeyBase64.utf8),
              Data(owner.dekKeyId.utf8) == Data(seed.encryptionKeyId.utf8),
              Data(owner.dekPublicKey.utf8) == Data(seed.dekPublicKeyBase64.utf8),
              !seed.dskAlias.isEmpty, !seed.dekAlias.isEmpty, seed.dskAlias != seed.dekAlias,
              try verifier.verify(signature: head.signature, canonicalBytes: head.canonicalBytes, publicKey: seed.dskPublicKeyBase64)
        else { throw OrdinaryTrustSetError.unauthorizedSigner }
        let initial = OrdinaryTrustSetRecord(head: head, rootAnchor: head)
        if try ordinaryStore.compareAndSetDurably(expected: nil, next: initial) { return head }
        let existing = try ordinaryStore.load(), existingEpoch = try existing.head.epoch()
        guard Data(existing.head.familyId.utf8) == Data(familyId.utf8), existingEpoch.trustSetEpoch >= 1,
              existingEpoch.keyEpoch >= 1, existing.rootAnchor == head, try ordinaryStore.confirmDurable(existing), rootStore.confirmDurable(root) else {
            throw OrdinaryTrustSetError.scopeMismatch
        }
        if existingEpoch.trustSetEpoch == 1, existing.head != head { throw OrdinaryTrustSetError.responseMismatch }
        return existing.head
    }
}
