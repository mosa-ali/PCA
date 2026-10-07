import XCTest
import Foundation
@testable import PCA

final class DeviceActivityUsageAttributionTests: XCTestCase {
    private final class Store: OpaqueBlobStore, DeviceActivityUsageAssociationSnapshotPersistence {
        var values: [String: Data] = [:]
        var ignoreWrites = false
        var failingKey: String?
        var ignoredRemoveKeys = Set<String>()
        var ignoredWriteKeys = Set<String>()
        func writeAtomically(_ data: Data, forKey key: String) throws {
            if key == failingKey { throw DeviceActivityUsageAssociationError.persistenceFailed }
            if !ignoreWrites && !ignoredWriteKeys.contains(key) { values[key] = data }
        }
        func write(_ data: Data, forKey key: String) throws { try writeAtomically(data, forKey: key) }
        func read(forKey key: String) -> Data? { values[key] }
        func remove(forKey key: String) {
            guard !ignoredRemoveKeys.contains(key) else { return }
            values.removeValue(forKey: key)
        }
    }
    private struct PersistedRecordFixture: Codable {
        let binding: DeviceActivityUsageSelectionBinding
        let localDate: String
        let zone: String
        let dayStart: Date
        let dayEnd: Date
        let minutes: Int
    }
    private struct PersistedStateFixture: Codable {
        let schemaVersion: Int
        let records: [PersistedRecordFixture]
    }
    private struct Token: Hashable, Codable { let value: String }
    private final class AccessBox {
        private let lock = NSLock()
        private var stored: DeviceActivityPolicyLockAccess?
        func set(_ access: DeviceActivityPolicyLockAccess) {
            lock.lock(); stored = access; lock.unlock()
        }
        func get() -> DeviceActivityPolicyLockAccess? {
            lock.lock(); defer { lock.unlock() }; return stored
        }
    }
    private final class ActiveUseBodyCompletion {
        private let lock = NSLock()
        private var completed = false

        func markCompleted() {
            lock.lock(); completed = true; lock.unlock()
        }

        var hasCompleted: Bool {
            lock.lock(); defer { lock.unlock() }; return completed
        }
    }
    private final class NonReentrantCoordination: DeviceActivityPolicyCoordination {
        private enum TestError: Error { case nestedAcquisition }
        private let lock = NSRecursiveLock()
        private var depth = 0
        private(set) var acquisitions = 0

        func withExclusiveAccess<T>(_ operation: () throws -> T) throws -> T {
            lock.lock()
            defer { lock.unlock() }
            guard depth == 0 else { throw TestError.nestedAcquisition }
            depth += 1
            acquisitions += 1
            defer { depth -= 1 }
            return try operation()
        }

        func resetAcquisitions() {
            lock.lock()
            acquisitions = 0
            lock.unlock()
        }
    }
    private final class WaiterAwareCoordination: DeviceActivityPolicyCoordination {
        private enum TestError: Error { case waitTimedOut }
        private let condition = NSCondition()
        private let activeUseBodyCompletion: ActiveUseBodyCompletion
        private var locked = false
        private var acquisitionRequests = 0
        private var secondRequestWasBlocked: Bool?
        private var firstLockReleasedBeforeUseBodyCompletion: Bool?
        private var secondLockAcquiredBeforeUseBodyCompletion: Bool?
        private let secondRequestClassified = DispatchSemaphore(value: 0)
        private let firstLockReleasedEarly = DispatchSemaphore(value: 0)

        init(activeUseBodyCompletion: ActiveUseBodyCompletion) {
            self.activeUseBodyCompletion = activeUseBodyCompletion
        }

        func withExclusiveAccess<T>(_ operation: () throws -> T) throws -> T {
            condition.lock()
            acquisitionRequests += 1
            let requestNumber = acquisitionRequests
            if locked {
                if requestNumber == 2 {
                    secondRequestWasBlocked = true
                    secondRequestClassified.signal()
                }
                let deadline = Date().addingTimeInterval(10)
                while locked {
                    guard condition.wait(until: deadline) || !locked else {
                        condition.unlock()
                        throw TestError.waitTimedOut
                    }
                }
            } else if requestNumber == 2 {
                secondRequestWasBlocked = false
                secondRequestClassified.signal()
            }
            if requestNumber == 2 {
                secondLockAcquiredBeforeUseBodyCompletion = !activeUseBodyCompletion.hasCompleted
            }
            locked = true
            condition.unlock()

            defer {
                condition.lock()
                if requestNumber == 1 {
                    firstLockReleasedBeforeUseBodyCompletion = !activeUseBodyCompletion.hasCompleted
                    if firstLockReleasedBeforeUseBodyCompletion == true {
                        firstLockReleasedEarly.signal()
                    }
                }
                locked = false
                condition.broadcast()
                condition.unlock()
            }
            return try operation()
        }

        func awaitSecondRequestClassification() -> Bool? {
            guard secondRequestClassified.wait(timeout: .now() + 5) == .success else { return nil }
            condition.lock()
            defer { condition.unlock() }
            return secondRequestWasBlocked
        }

        func waitForPrematureFirstLockRelease() -> DispatchTimeoutResult {
            firstLockReleasedEarly.wait(timeout: .now() + 1)
        }

        var didFirstLockReleaseBeforeUseBodyCompletion: Bool? {
            condition.lock(); defer { condition.unlock() }
            return firstLockReleasedBeforeUseBodyCompletion
        }

        var didSecondLockAcquireBeforeUseBodyCompletion: Bool? {
            condition.lock(); defer { condition.unlock() }
            return secondLockAcquiredBeforeUseBodyCompletion
        }
    }
    private let now = Date(timeIntervalSince1970: 1_760_011_200)

    private func associationBinding(_ token: Token, logicalAppToken: String = "logical-app") throws -> DeviceActivityUsageSelectionBinding {
        DeviceActivityUsageSelectionBinding(logicalAppToken: logicalAppToken,
            applicationTokenData: try PropertyListEncoder().encode(token))
    }

    func testUsageAssociationRequiresExplicitScopedBindingAndSurvivesStoreRecreation() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let binding = try associationBinding(Token(value: "selected"))
        let authority = Data("accepted-authority-epoch-4".utf8)
        let first = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        XCTAssertNil(try first.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority, revalidateAuthority: { _ in }))

        try first.installAcceptedAssociation(scope: scope, binding: binding, authorityBinding: authority,
            revision: 1, revalidateAuthority: { _ in })
        try first.installAcceptedAssociation(scope: scope, binding: binding, authorityBinding: authority,
            revision: 1, revalidateAuthority: { _ in })
        let restored = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        XCTAssertEqual(try restored.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority, revalidateAuthority: { _ in }), binding)
        XCTAssertNil(try restored.resolveAcceptedAssociation(
            scope: DeviceActivityUsageAssociationScope(familyId: "family-b", deviceId: "device-a"),
            logicalAppToken: "logical-app", selectedTokens: [Token(value: "selected")],
            currentAuthorityBinding: authority, revalidateAuthority: { _ in }))
        XCTAssertNil(try restored.resolveAcceptedAssociation(
            scope: DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-b"),
            logicalAppToken: "logical-app", selectedTokens: [Token(value: "selected")],
            currentAuthorityBinding: authority, revalidateAuthority: { _ in }))
        XCTAssertNotEqual(DeviceActivityUsageAssociationScope(familyId: "fam-é", deviceId: "device"),
            DeviceActivityUsageAssociationScope(familyId: "fam-e\u{301}", deviceId: "device"))
        XCTAssertNil(try restored.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "other")], currentAuthorityBinding: authority, revalidateAuthority: { _ in }))
        XCTAssertNil(try restored.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: Data("stale".utf8), revalidateAuthority: { _ in }))
        XCTAssertNil(try restored.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected"), Token(value: "extra")], currentAuthorityBinding: authority,
            revalidateAuthority: { _ in }))
        XCTAssertNil(try restored.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-e\u{301}",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority, revalidateAuthority: { _ in }))
    }

    func testResolverUsesActiveLockAccessWithoutReentryAndRejectsForeignOrExpiredAccess() throws {
        let backing = Store(), coordination = NonReentrantCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let binding = try associationBinding(Token(value: "selected"))
        let authority = Data("accepted-authority-epoch-4".utf8)
        try associations.installAcceptedAssociation(scope: scope, binding: binding,
            authorityBinding: authority, revision: 1, revalidateAuthority: { _ in })

        coordination.resetAcquisitions()
        let resolved = try coordination.withExclusiveAccessContext { access in
            try associations.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
                selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
                under: access, revalidateAuthority: { _ in })
        }
        XCTAssertEqual(resolved, binding)
        XCTAssertEqual(coordination.acquisitions, 1, "resolution must use the held lock, not reacquire it")

        let staleAuthority = try coordination.withExclusiveAccessContext { access in
            try associations.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
                selectedTokens: [Token(value: "selected")], currentAuthorityBinding: Data("stale".utf8),
                under: access, revalidateAuthority: { _ in })
        }
        XCTAssertNil(staleAuthority)

        var expiredAccess: DeviceActivityPolicyLockAccess!
        try coordination.withExclusiveAccessContext { access in expiredAccess = access }
        XCTAssertThrowsError(try associations.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
            under: expiredAccess, revalidateAuthority: { _ in })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .invalidLockAccess)
        }

        let foreignCoordination = NonReentrantCoordination()
        try foreignCoordination.withExclusiveAccessContext { access in
            XCTAssertThrowsError(try associations.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
                selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
                under: access, revalidateAuthority: { _ in })) {
                XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .invalidLockAccess)
            }
        }
    }

    func testLockAccessInvalidationWaitsForInFlightUseBeforeUnlocking() throws {
        let activeUseBodyCompletion = ActiveUseBodyCompletion()
        let coordination = WaiterAwareCoordination(activeUseBodyCompletion: activeUseBodyCompletion)
        let accessBox = AccessBox()
        let useEntered = DispatchSemaphore(value: 0)
        let useEntryConfirmed = DispatchSemaphore(value: 0)
        let releaseUse = DispatchSemaphore(value: 0)
        let contextReadyToClose = DispatchSemaphore(value: 0)
        let contextFinished = DispatchSemaphore(value: 0)
        let useFinished = DispatchSemaphore(value: 0)
        let useAccepted = DispatchSemaphore(value: 0)
        let competitorEntered = DispatchSemaphore(value: 0)
        let competitorFinished = DispatchSemaphore(value: 0)
        var releaseWasSignaled = false
        defer { if !releaseWasSignaled { releaseUse.signal() } }

        DispatchQueue.global().async {
            defer { contextFinished.signal() }
            do {
                try coordination.withExclusiveAccessContext { access in
                    accessBox.set(access)
                    DispatchQueue.global().async {
                        let result = access.withActiveUse(for: coordination) {
                            useEntered.signal()
                            _ = releaseUse.wait(timeout: .now() + 15)
                            activeUseBodyCompletion.markCompleted()
                        }
                        if result != nil { useAccepted.signal() }
                        useFinished.signal()
                    }
                    if useEntered.wait(timeout: .now() + 5) == .success {
                        useEntryConfirmed.signal()
                    }
                    contextReadyToClose.signal()
                }
            } catch {
                contextReadyToClose.signal()
            }
        }

        XCTAssertEqual(contextReadyToClose.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(useEntryConfirmed.wait(timeout: .now()), .success,
            "the test must observe the read after it has entered the access lease")
        let access = try XCTUnwrap(accessBox.get())
        let invalidationDeadline = Date().addingTimeInterval(5)
        while access.isActive(for: coordination) && Date() < invalidationDeadline {
            Thread.sleep(forTimeInterval: 0.001)
        }
        XCTAssertFalse(access.isActive(for: coordination), "the outer context must have started invalidation")

        DispatchQueue.global().async {
            do { try coordination.withExclusiveAccess { competitorEntered.signal() } }
            catch { XCTFail("competitor lock acquisition failed: \(error)") }
            competitorFinished.signal()
        }
        let competingRequestWasBlocked = coordination.awaitSecondRequestClassification()
        let prematureUnlock = coordination.waitForPrematureFirstLockRelease()
        releaseUse.signal()
        releaseWasSignaled = true

        XCTAssertEqual(competingRequestWasBlocked, true,
            "a competing operation must not enter while the capability use is active")
        XCTAssertEqual(prematureUnlock, .timedOut,
            "the outer lock must not be released while the access use is still held")
        XCTAssertEqual(contextFinished.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(useFinished.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(useAccepted.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(competitorEntered.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(competitorFinished.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(coordination.didFirstLockReleaseBeforeUseBodyCompletion, false,
            "the coordinator lock must remain held until the active-use operation completes")
        XCTAssertEqual(coordination.didSecondLockAcquireBeforeUseBodyCompletion, false,
            "a competing operation must not acquire the coordinator before the active-use operation completes")
    }

    func testUsageAssociationRevocationCannotBeUndoneByStaleRevision() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        let binding = try associationBinding(Token(value: "selected"))
        try associations.installAcceptedAssociation(scope: scope, binding: binding, authorityBinding: authority,
            revision: 3, revalidateAuthority: { _ in })
        var revocationContexts: [DeviceActivityUsageAssociationAuthorityContext] = []
        try associations.revokeAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            authorityBinding: authority, revision: 4, revalidateAuthority: { revocationContexts.append($0) })
        XCTAssertEqual(revocationContexts.count, 3)
        XCTAssertNil(revocationContexts[0].binding)
        XCTAssertEqual(revocationContexts[1].binding, binding)
        XCTAssertEqual(revocationContexts[2].binding, binding)
        XCTAssertEqual(revocationContexts[1].logicalAppToken, "logical-app")
        XCTAssertEqual(revocationContexts[1].revision, 4)
        try associations.revokeAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            authorityBinding: authority, revision: 4, revalidateAuthority: { _ in })
        XCTAssertThrowsError(try associations.revokeAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            authorityBinding: authority, revision: 3, revalidateAuthority: { _ in })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .staleRevision)
        }
        try associations.revokeAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            authorityBinding: authority, revision: 5, revalidateAuthority: { _ in })
        try associations.revokeAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            authorityBinding: authority, revision: 5, revalidateAuthority: { _ in })
        XCTAssertNil(try associations.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority, revalidateAuthority: { _ in }))
        XCTAssertThrowsError(try associations.installAcceptedAssociation(scope: scope, binding: binding,
            authorityBinding: authority, revision: 5, revalidateAuthority: { _ in })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .staleRevision)
        }
        try associations.installAcceptedAssociation(scope: scope, binding: binding, authorityBinding: authority,
            revision: 6, revalidateAuthority: { _ in })
        XCTAssertEqual(try associations.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority, revalidateAuthority: { _ in }), binding)
    }

    func testUsageAssociationUsesByteExactFamilyAndDeviceScopeDuringResolution() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "fam-é", deviceId: "device-é")
        let binding = try associationBinding(Token(value: "selected"))
        let authority = Data("accepted-authority".utf8)
        try associations.installAcceptedAssociation(scope: scope, binding: binding, authorityBinding: authority,
            revision: 1, revalidateAuthority: { _ in })
        XCTAssertNil(try associations.resolveAcceptedAssociation(
            scope: DeviceActivityUsageAssociationScope(familyId: "fam-e\u{301}", deviceId: "device-é"),
            logicalAppToken: "logical-app", selectedTokens: [Token(value: "selected")],
            currentAuthorityBinding: authority, revalidateAuthority: { _ in }))
        XCTAssertNil(try associations.resolveAcceptedAssociation(
            scope: DeviceActivityUsageAssociationScope(familyId: "fam-é", deviceId: "device-e\u{301}"),
            logicalAppToken: "logical-app", selectedTokens: [Token(value: "selected")],
            currentAuthorityBinding: authority, revalidateAuthority: { _ in }))
        XCTAssertEqual(try associations.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
            revalidateAuthority: { _ in }), binding)
    }

    func testUsageAssociationRetainsTombstoneWhenPostRevokeAuthorityCheckFails() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        let binding = try associationBinding(Token(value: "selected"))
        try associations.installAcceptedAssociation(scope: scope, binding: binding, authorityBinding: authority,
            revision: 1, revalidateAuthority: { _ in })
        var validations = 0
        XCTAssertThrowsError(try associations.revokeAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            authorityBinding: authority, revision: 2, revalidateAuthority: { context in
                validations += 1
                if validations == 3 { throw DeviceActivityUsageAssociationError.authorityRejected }
                if validations > 1 {
                    XCTAssertEqual(context.binding, binding)
                    XCTAssertEqual(context.revision, 2)
                }
            })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .authorityRejected)
        }
        XCTAssertEqual(validations, 3)
        let restarted = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        XCTAssertThrowsError(try restarted.installAcceptedAssociation(scope: scope, binding: binding,
            authorityBinding: authority, revision: 1, revalidateAuthority: { _ in })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .staleRevision)
        }
        XCTAssertNil(try restarted.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
            revalidateAuthority: { _ in }))
    }

    func testUsageAssociationRejectsConflictingRevisionAndPreservesPriorSnapshotOnWriteFailure() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        let original = try associationBinding(Token(value: "selected"))
        try associations.installAcceptedAssociation(scope: scope, binding: original, authorityBinding: authority,
            revision: 1, revalidateAuthority: { _ in })
        XCTAssertThrowsError(try associations.installAcceptedAssociation(scope: scope,
            binding: associationBinding(Token(value: "conflict")), authorityBinding: authority,
            revision: 1, revalidateAuthority: { _ in })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .conflictingReplay)
        }
        backing.failingKey = "com.pca.app.deviceactivity.usage-associations.v1"
        XCTAssertThrowsError(try associations.installAcceptedAssociation(scope: scope,
            binding: associationBinding(Token(value: "new")), authorityBinding: authority,
            revision: 2, revalidateAuthority: { _ in }))
        backing.failingKey = nil
        backing.ignoreWrites = true
        XCTAssertThrowsError(try associations.installAcceptedAssociation(scope: scope,
            binding: associationBinding(Token(value: "readback-mismatch")), authorityBinding: authority,
            revision: 2, revalidateAuthority: { _ in }))
        backing.ignoreWrites = false
        XCTAssertEqual(try associations.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority, revalidateAuthority: { _ in }), original)
    }

    func testUsageAssociationTreatsOwnedCorruptionAsUnavailableAndRevalidatesAuthority() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        try associations.installAcceptedAssociation(scope: scope, binding: associationBinding(Token(value: "selected")),
            authorityBinding: authority, revision: 1, revalidateAuthority: { _ in })
        XCTAssertThrowsError(try associations.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
            revalidateAuthority: { _ in throw DeviceActivityUsageAssociationError.authorityRejected })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .authorityRejected)
        }
        backing.values["com.pca.app.deviceactivity.usage-associations.v1"] = Data("corrupt".utf8)
        XCTAssertThrowsError(try associations.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority, revalidateAuthority: { _ in })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .unavailableState)
        }
    }

    func testUsageAssociationPrecheckRejectionDoesNotPersistState() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        XCTAssertThrowsError(try associations.installAcceptedAssociation(scope: scope,
            binding: associationBinding(Token(value: "selected")), authorityBinding: authority, revision: 1,
            revalidateAuthority: { _ in throw DeviceActivityUsageAssociationError.authorityRejected })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .authorityRejected)
        }
        XCTAssertTrue(backing.values.isEmpty)
    }

    func testUsageAssociationFirstSnapshotWriteFailureLeavesOwnedStateUnavailable() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        backing.failingKey = "com.pca.app.deviceactivity.usage-associations.v1"
        XCTAssertThrowsError(try associations.installAcceptedAssociation(scope: scope,
            binding: associationBinding(Token(value: "selected")), authorityBinding: authority, revision: 1,
            revalidateAuthority: { _ in }))
        XCTAssertEqual(backing.values["com.pca.app.deviceactivity.usage-associations.owner.v1"],
            Data("pca-usage-associations-v1".utf8))
        XCTAssertNil(backing.values["com.pca.app.deviceactivity.usage-associations.v1"])
        backing.failingKey = nil
        let restarted = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        XCTAssertThrowsError(try restarted.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
            revalidateAuthority: { _ in })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .unavailableState)
        }
    }

    func testUsageAssociationPostWriteAuthorityRejectionPersistsPoisonLatch() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        let binding = try associationBinding(Token(value: "selected"))
        var validations = 0
        XCTAssertThrowsError(try associations.installAcceptedAssociation(scope: scope,
            binding: binding, authorityBinding: authority, revision: 1,
            revalidateAuthority: { context in
                XCTAssertEqual(context.scope, scope)
                XCTAssertEqual(context.logicalAppToken, "logical-app")
                XCTAssertEqual(context.binding, binding)
                XCTAssertEqual(context.authorityBinding, authority)
                XCTAssertEqual(context.revision, 1)
                validations += 1
                if validations == 2 { throw DeviceActivityUsageAssociationError.authorityRejected }
            })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .authorityRejected)
        }
        XCTAssertEqual(validations, 2)
        XCTAssertEqual(backing.values["com.pca.app.deviceactivity.usage-associations.unavailable.v1"],
            Data("association-authority-changed-during-write".utf8))
        for candidate in [associations, DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)] {
            XCTAssertThrowsError(try candidate.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
                selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
                revalidateAuthority: { _ in })) {
                XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .unavailableState)
            }
        }
    }

    func testUsageAssociationPostWriteAuthorityRejectionFallsBackToRemovingOwnershipMarker() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        let binding = try associationBinding(Token(value: "selected"))
        var validations = 0
        backing.failingKey = "com.pca.app.deviceactivity.usage-associations.unavailable.v1"
        XCTAssertThrowsError(try associations.installAcceptedAssociation(scope: scope,
            binding: binding, authorityBinding: authority, revision: 1,
            revalidateAuthority: { context in
                XCTAssertEqual(context.scope, scope)
                XCTAssertEqual(context.logicalAppToken, "logical-app")
                XCTAssertEqual(context.binding, binding)
                XCTAssertEqual(context.authorityBinding, authority)
                XCTAssertEqual(context.revision, 1)
                validations += 1
                if validations == 2 { throw DeviceActivityUsageAssociationError.authorityRejected }
            })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .authorityRejected)
        }
        XCTAssertEqual(validations, 2)
        XCTAssertNil(backing.values["com.pca.app.deviceactivity.usage-associations.owner.v1"])
        XCTAssertNotNil(backing.values["com.pca.app.deviceactivity.usage-associations.v1"])
        for candidate in [associations, DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)] {
            XCTAssertThrowsError(try candidate.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
                selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
                revalidateAuthority: { _ in })) {
                XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .unavailableState)
            }
        }
    }

    func testUsageAssociationPostWriteRejectionReplacesSnapshotWhenLatchAndMarkerRemovalFail() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        var validations = 0
        backing.failingKey = "com.pca.app.deviceactivity.usage-associations.unavailable.v1"
        backing.ignoredRemoveKeys.insert("com.pca.app.deviceactivity.usage-associations.owner.v1")
        XCTAssertThrowsError(try associations.installAcceptedAssociation(scope: scope,
            binding: associationBinding(Token(value: "selected")), authorityBinding: authority, revision: 1,
            revalidateAuthority: { _ in
                validations += 1
                if validations == 2 { throw DeviceActivityUsageAssociationError.authorityRejected }
            })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .authorityRejected)
        }
        XCTAssertEqual(validations, 2)
        XCTAssertEqual(backing.values["com.pca.app.deviceactivity.usage-associations.owner.v1"],
            Data("pca-usage-associations-v1".utf8))
        XCTAssertEqual(backing.values["com.pca.app.deviceactivity.usage-associations.v1"],
            Data("association-authority-changed-during-write".utf8))
        let restarted = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        XCTAssertThrowsError(try restarted.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
            revalidateAuthority: { _ in })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .unavailableState)
        }
    }

    func testUsageAssociationRevalidatesAuthorityAfterEveryDurableInvalidationPathFails() throws {
        let backing = Store(), coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        let binding = try associationBinding(Token(value: "selected"))
        backing.ignoredRemoveKeys.insert("com.pca.app.deviceactivity.usage-associations.owner.v1")
        var validations = 0
        XCTAssertThrowsError(try associations.installAcceptedAssociation(scope: scope, binding: binding,
            authorityBinding: authority, revision: 1, revalidateAuthority: { context in
                validations += 1
                if validations == 2 {
                    backing.failingKey = "com.pca.app.deviceactivity.usage-associations.unavailable.v1"
                    backing.ignoredWriteKeys.insert("com.pca.app.deviceactivity.usage-associations.v1")
                    throw DeviceActivityUsageAssociationError.authorityRejected
                }
                XCTAssertEqual(context.binding, binding)
            })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .persistenceFailed)
        }
        XCTAssertEqual(validations, 2)
        XCTAssertEqual(backing.values["com.pca.app.deviceactivity.usage-associations.owner.v1"],
            Data("pca-usage-associations-v1".utf8))
        XCTAssertNotNil(backing.values["com.pca.app.deviceactivity.usage-associations.v1"])
        let restarted = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        var resolutionChecks = 0
        XCTAssertThrowsError(try restarted.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
            revalidateAuthority: { context in
                resolutionChecks += 1
                XCTAssertEqual(context.scope, scope)
                XCTAssertEqual(context.logicalAppToken, "logical-app")
                XCTAssertEqual(context.authorityBinding, authority)
                if resolutionChecks == 1 {
                    XCTAssertNil(context.binding)
                    XCTAssertNil(context.revision)
                    return
                }
                XCTAssertEqual(context.binding, binding)
                XCTAssertEqual(context.revision, 1)
                throw DeviceActivityUsageAssociationError.authorityRejected
            })) {
            XCTAssertEqual($0 as? DeviceActivityUsageAssociationError, .authorityRejected)
        }
        XCTAssertEqual(resolutionChecks, 2)
    }

    func testUsageAssociationConcurrentStoreInstancesSerializeConflictingWriters() throws {
        #if canImport(Darwin)
        let backing = Store()
        let lockFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("pca-usage-association-\(UUID().uuidString).lock")
        defer { try? FileManager.default.removeItem(at: lockFile) }
        let first = DeviceActivityUsageAssociationStore<Token>(store: backing,
            coordination: AppGroupDeviceActivityPolicyCoordination(lockFile: lockFile))
        let second = DeviceActivityUsageAssociationStore<Token>(store: backing,
            coordination: AppGroupDeviceActivityPolicyCoordination(lockFile: lockFile))
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        let requests: [(DeviceActivityUsageAssociationStore<Token>, DeviceActivityUsageSelectionBinding)] = [
            (first, try associationBinding(Token(value: "first"))),
            (second, try associationBinding(Token(value: "second")))
        ]
        let group = DispatchGroup()
        let resultLock = NSLock()
        var outcomes: [String] = []
        for (associationStore, binding) in requests {
            group.enter()
            DispatchQueue.global().async {
                let outcome: String
                do {
                    try associationStore.installAcceptedAssociation(scope: scope,
                        binding: binding, authorityBinding: authority, revision: 1,
                        revalidateAuthority: { _ in })
                    outcome = "installed"
                } catch let error as DeviceActivityUsageAssociationError where error == .conflictingReplay {
                    outcome = "conflict"
                } catch {
                    outcome = "unexpected: \(error)"
                }
                resultLock.lock()
                outcomes.append(outcome)
                resultLock.unlock()
                group.leave()
            }
        }
        XCTAssertEqual(group.wait(timeout: .now() + 5), .success)
        resultLock.lock()
        let completedOutcomes = outcomes
        resultLock.unlock()
        XCTAssertEqual(completedOutcomes.filter { $0 == "installed" }.count, 1)
        XCTAssertEqual(completedOutcomes.filter { $0 == "conflict" }.count, 1)
        XCTAssertEqual(completedOutcomes.count, 2)
        let restored = DeviceActivityUsageAssociationStore<Token>(store: backing,
            coordination: AppGroupDeviceActivityPolicyCoordination(lockFile: lockFile))
        let firstResolution = try restored.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "first")], currentAuthorityBinding: authority, revalidateAuthority: { _ in })
        let secondResolution = try restored.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "second")], currentAuthorityBinding: authority, revalidateAuthority: { _ in })
        XCTAssertEqual([firstResolution, secondResolution].compactMap { $0 }.count, 1)
        #endif
    }

    func testUsageAssociationRevokeWinsRaceWithStaleInstallAcrossLockHandles() throws {
        #if canImport(Darwin)
        let backing = Store()
        let lockFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("pca-usage-revocation-\(UUID().uuidString).lock")
        defer { try? FileManager.default.removeItem(at: lockFile) }
        let first = DeviceActivityUsageAssociationStore<Token>(store: backing,
            coordination: AppGroupDeviceActivityPolicyCoordination(lockFile: lockFile))
        let second = DeviceActivityUsageAssociationStore<Token>(store: backing,
            coordination: AppGroupDeviceActivityPolicyCoordination(lockFile: lockFile))
        let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
        let authority = Data("accepted-authority".utf8)
        let binding = try associationBinding(Token(value: "selected"))
        try first.installAcceptedAssociation(scope: scope, binding: binding, authorityBinding: authority,
            revision: 1, revalidateAuthority: { _ in })

        let group = DispatchGroup()
        let ready = DispatchSemaphore(value: 0)
        let start = DispatchSemaphore(value: 0)
        let resultLock = NSLock()
        var outcomes: [String] = []
        group.enter()
        DispatchQueue.global().async {
            ready.signal()
            start.wait()
            let outcome: String
            do {
                try first.revokeAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
                    authorityBinding: authority, revision: 2, revalidateAuthority: { _ in })
                outcome = "revoked"
            } catch {
                outcome = "unexpected revoke: \(error)"
            }
            resultLock.lock()
            outcomes.append(outcome)
            resultLock.unlock()
            group.leave()
        }
        group.enter()
        DispatchQueue.global().async {
            ready.signal()
            start.wait()
            let outcome: String
            do {
                try second.installAcceptedAssociation(scope: scope, binding: binding, authorityBinding: authority,
                    revision: 1, revalidateAuthority: { _ in })
                outcome = "installed"
            } catch let error as DeviceActivityUsageAssociationError where error == .staleRevision {
                outcome = "stale"
            } catch {
                outcome = "unexpected install: \(error)"
            }
            resultLock.lock()
            outcomes.append(outcome)
            resultLock.unlock()
            group.leave()
        }
        ready.wait()
        ready.wait()
        start.signal()
        start.signal()
        XCTAssertEqual(group.wait(timeout: .now() + 5), .success)
        resultLock.lock()
        let completedOutcomes = outcomes
        resultLock.unlock()
        let outcomeSet = Set(completedOutcomes)
        XCTAssertTrue(outcomeSet == Set(["revoked", "installed"]) || outcomeSet == Set(["revoked", "stale"]),
            "outcomes: \(completedOutcomes)")
        let restored = DeviceActivityUsageAssociationStore<Token>(store: backing,
            coordination: AppGroupDeviceActivityPolicyCoordination(lockFile: lockFile))
        XCTAssertNil(try restored.resolveAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            selectedTokens: [Token(value: "selected")], currentAuthorityBinding: authority,
            revalidateAuthority: { _ in }))
        #endif
    }
    func testScopeDecodingPreservesDistinctOpaqueUnicodeIdentities() throws {
        let original = StoredAppScope.apps(["é", "e\u{301}"])
        let decoded = try JSONDecoder().decode(StoredAppScope.self, from: JSONEncoder().encode(original))
        guard case .apps(let identities) = decoded else { return XCTFail("Expected app scope") }
        XCTAssertEqual(identities.count, 2)
        let scope = AppScope.apps(identities)
        XCTAssertTrue(scope.includes("é"))
        XCTAssertTrue(scope.includes("e\u{301}"))
        XCTAssertNotEqual(AppScope.apps(["é"]), AppScope.apps(["e\u{301}"]))
        let candidate = DecodedSchedulePolicy(activityId: "policy", appToken: "é",
            timeZone: TimeZone(identifier: "UTC")!, windows: [], bonusGrants: [], exceptions: [],
            dailyLimit: DailyAppLimit(appScope: scope, limitMinutes: 60, usedMinutesToday: 0,
                anchorLocalDate: "2000-01-01"), enforcementCapability: .enforced)
        XCTAssertThrowsError(try DeviceActivityUsagePlanner.plan(policy: candidate, binding: binding("é"),
            generation: UUID().uuidString, now: now, deviceTimeZone: TimeZone(identifier: "UTC")!,
            historicalActivitySupported: true, otherMonitorCount: 1))
    }
    private func binding(_ name: String = "app") throws -> DeviceActivityUsageSelectionBinding {
        DeviceActivityUsageSelectionBinding(logicalAppToken: name,
            applicationTokenData: try PropertyListEncoder().encode(Token(value: "opaque")))
    }
    private func policy(zone: String = "UTC", minutes: Int = 60, bonuses: [BonusGrant] = [],
                        exceptions: [ParentException] = [], capability: EnforcementCapabilityState = .enforced) -> DecodedSchedulePolicy {
        DecodedSchedulePolicy(activityId: "policy", appToken: "app", timeZone: TimeZone(identifier: zone)!,
            windows: [], bonusGrants: bonuses, exceptions: exceptions,
            dailyLimit: DailyAppLimit(appScope: .all, limitMinutes: minutes, usedMinutesToday: 0,
                anchorLocalDate: "2000-01-01"), enforcementCapability: capability)
    }
    private func plan(_ policy: DecodedSchedulePolicy, deviceZone: String = "UTC", count: Int = 1) throws -> DeviceActivityUsageDayPlan {
        try DeviceActivityUsagePlanner.plan(policy: policy, binding: binding(), generation: UUID().uuidString,
            now: now, deviceTimeZone: TimeZone(identifier: deviceZone)!,
            historicalActivitySupported: true, otherMonitorCount: count)
    }
    func testBindingRequiresExplicitExactIdentityAndSingleton() throws {
        let pair = try binding("é")
        XCTAssertTrue(pair.matches(Set([Token(value: "opaque")]), logicalAppToken: "é"))
        XCTAssertFalse(pair.matches(Set([Token(value: "opaque")]), logicalAppToken: "e\u{301}"))
        XCTAssertFalse(pair.matches(Set<Token>(), logicalAppToken: "é"))
        XCTAssertFalse(pair.matches(Set([Token(value: "opaque"), Token(value: "other")]), logicalAppToken: "é"))
    }
    func testPlanMustMatchStoredPolicyThresholds() throws {
        let value = try plan(policy())
        XCTAssertTrue(value.isValid)
        XCTAssertTrue(value.matches(policy: policy()))
        XCTAssertFalse(value.matches(policy: policy(minutes: 61)))
        XCTAssertFalse(value.matches(policy: policy(zone: "Asia/Aden")))
    }
    func testTimezoneMismatchRejectsNewObservationWithoutInvalidatingPolicyDay() throws {
        let value = try plan(policy())
        XCTAssertTrue(value.contains(now, deviceTimeZone: TimeZone(identifier: "UTC")!))
        XCTAssertFalse(value.contains(now, deviceTimeZone: TimeZone(identifier: "Asia/Aden")!))
        XCTAssertTrue(now >= value.dayStartUtc && now < value.dayEndUtc)
    }
    func testFractionalTimezoneUsesOnlyInDayAccounting() throws {
        let value = try plan(policy(zone: "Asia/Kathmandu"))
        XCTAssertEqual(value.coverage, .partialPolicyDayPlanned)
        XCTAssertGreaterThan(value.accountingStartUtc, value.dayStartUtc)
        XCTAssertLessThan(value.accountingStartUtc, value.dayEndUtc)
    }
    func testMonitorBudgetAndNumericBoundsRejectBeforeRegistration() throws {
        XCTAssertNoThrow(try plan(policy(), count: 19))
        XCTAssertThrowsError(try plan(policy(), count: 20))
        XCTAssertThrowsError(try plan(policy(minutes: -1)))
        XCTAssertThrowsError(try plan(policy(minutes: Int.max)))
    }
    func testFinitePlanExpiresAtPolicyMidnightWithoutClaimingRenewal() throws {
        let value = try plan(policy())
        let utc = TimeZone(identifier: "UTC")!
        XCTAssertEqual(value.status(at: now, deviceTimeZone: utc), .planned(.wholePolicyDayPlanned))
        XCTAssertEqual(value.status(at: value.dayEndUtc, deviceTimeZone: utc), .expired)
        XCTAssertEqual(value.status(at: value.accountingStartUtc.addingTimeInterval(-1), deviceTimeZone: utc), .unavailable)
        XCTAssertEqual(value.status(at: now, deviceTimeZone: TimeZone(identifier: "Asia/Aden")!), .deviceTimeZoneChanged)
    }
    func testEvaluationUsesMaximumWithoutMutatingPolicyOrUpgradingCoverage() {
        let original = policy()
        let input = DeviceActivityUsageEvaluation.input(policy: original, now: now,
            lowerBoundMinutes: 60, coverageAvailable: false)
        XCTAssertEqual(input.dailyLimit?.usedMinutesToday, 60)
        XCTAssertEqual(original.dailyLimit?.usedMinutesToday, 0)
        XCTAssertEqual(input.enforcementCapability, .degraded)
    }
    private func install(_ plan: DeviceActivityUsageDayPlan, store: Store, active: Bool) throws {
        let manifest = DeviceActivityMonitorInstallation(policyActivityId: plan.policyActivityId,
            monitorActivityId: "pca-monitor-" + UUID().uuidString, generation: plan.generation,
            installedAtUtc: now, timeZoneIdentifier: "UTC", state: active ? .active : .starting,
            schemaVersion: 3, boundaryMonitors: [], usageDayPlan: plan)
        try store.write(JSONEncoder().encode(manifest), forKey: deviceActivityMonitorInstallationStorageKey)
        if active { try store.write(Data(plan.policyActivityId.utf8), forKey: "activeActivityId") }
        else { store.remove(forKey: "activeActivityId") }
    }
    func testStartingObservationPublishesOnlyAfterActiveCommitAndDuplicatesDoNotAdd() throws {
        let store = Store(), value = try plan(policy())
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        let event = try XCTUnwrap(value.thresholds.first)
        try install(value, store: store, active: false)
        try usage.stage(plan: value, activityId: value.monitorActivityId, eventId: event.eventId,
            at: now, deviceTimeZone: TimeZone(identifier: "UTC")!)
        XCTAssertNil(try usage.lowerBound(for: value))
        XCTAssertThrowsError(try usage.activate(plan: value))
        try install(value, store: store, active: true)
        try usage.activate(plan: value)
        XCTAssertEqual(try usage.lowerBound(for: value), 60)
        for _ in 0..<3 {
            XCTAssertEqual(try usage.record(plan: value, activityId: value.monitorActivityId,
                eventId: event.eventId, at: now, deviceTimeZone: TimeZone(identifier: "UTC")!), 60)
        }
        XCTAssertEqual(try usage.lowerBound(for: value), 60)
    }
    func testStaleManifestAndFailedReadbackCannotPublishObservation() throws {
        let store = Store(), value = try plan(policy())
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        let event = try XCTUnwrap(value.thresholds.first)
        XCTAssertThrowsError(try usage.record(plan: value, activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: TimeZone(identifier: "UTC")!))
        try install(value, store: store, active: true)
        store.ignoreWrites = true
        XCTAssertThrowsError(try usage.record(plan: value, activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: TimeZone(identifier: "UTC")!))
        XCTAssertNil(try usage.lowerBound(for: value))
    }
    func testCorruptRetainedStateIsAnErrorRatherThanZeroUsage() throws {
        let store = Store(), value = try plan(policy())
        store.values["com.pca.app.deviceactivity.usage-lower-bound.v1"] = Data("broken".utf8)
        XCTAssertThrowsError(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: value))
    }
    func testPersistedZeroMinuteRecordIsUnavailableState() throws {
        let store = Store(), value = try plan(policy())
        let impossible = PersistedRecordFixture(binding: value.binding, localDate: value.localDate,
            zone: value.policyTimeZoneIdentifier, dayStart: value.dayStartUtc, dayEnd: value.dayEndUtc, minutes: 0)
        store.values["com.pca.app.deviceactivity.usage-lower-bound.v1"] = try JSONEncoder().encode(
            PersistedStateFixture(schemaVersion: 1, records: [impossible]))

        XCTAssertThrowsError(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: value)) {
            XCTAssertEqual($0 as? DeviceActivityUsageError, .unavailableState)
        }
    }
    func testEquivalentDecodedTokenEncodingRetainsSameDayMaximumAcrossGeneration() throws {
        let store = Store(), first = try plan(policy())
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        try install(first, store: store, active: true)
        let event = try XCTUnwrap(first.thresholds.first)
        _ = try usage.record(plan: first, activityId: first.monitorActivityId, eventId: event.eventId,
            at: now, deviceTimeZone: TimeZone(identifier: "UTC")!)
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .xml
        let equivalent = DeviceActivityUsageSelectionBinding(logicalAppToken: "app",
            applicationTokenData: try encoder.encode(Token(value: "opaque")))
        XCTAssertNotEqual(equivalent.applicationTokenData, first.binding.applicationTokenData)
        let replacement = try DeviceActivityUsagePlanner.plan(policy: policy(), binding: equivalent,
            generation: UUID().uuidString, now: now, deviceTimeZone: TimeZone(identifier: "UTC")!,
            historicalActivitySupported: true, otherMonitorCount: 1)
        try install(replacement, store: store, active: true)
        XCTAssertEqual(try usage.lowerBound(for: replacement), 60)
        XCTAssertThrowsError(try usage.record(plan: first, activityId: first.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: TimeZone(identifier: "UTC")!))
    }
    func testPolicyDaysFollowSpringAndFallDSTIntervals() throws {
        let formatter = ISO8601DateFormatter()
        let zone = TimeZone(identifier: "America/New_York")!
        for (stamp, hours) in [("2026-03-08T12:00:00Z", 23), ("2026-11-01T12:00:00Z", 25)] {
            let value = try DeviceActivityUsagePlanner.plan(policy: policy(zone: zone.identifier), binding: binding(),
                generation: UUID().uuidString, now: XCTUnwrap(formatter.date(from: stamp)),
                deviceTimeZone: zone, historicalActivitySupported: true, otherMonitorCount: 1)
            XCTAssertEqual(value.dayEndUtc.timeIntervalSince(value.dayStartUtc), Double(hours * 3600))
            XCTAssertEqual(value.coverage, .wholePolicyDayPlanned)
            XCTAssertTrue(value.matches(policy: policy(zone: zone.identifier)))
        }
    }
    func testProcessorStagesThenConsumesOnlyCurrentStoredPolicyGeneration() throws {
        let store = Store(), value = try plan(policy())
        let stored = StoredDeviceActivityPolicy(schemaVersion: 1, activityId: "policy", appToken: "app",
            timeZoneIdentifier: "UTC", windows: [], bonusGrants: [], exceptions: [],
            dailyLimit: StoredDailyAppLimit(appScope: .all, limitMinutes: 60, usedMinutesToday: 0,
                anchorLocalDate: "2000-01-01"), enforcementCapability: .enforced)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        try store.write(encoder.encode(stored), forKey: "schedule.policy." + value.generation)
        try store.write(PropertyListEncoder().encode(Set([Token(value: "opaque")])),
            forKey: "applicationTokens.policy." + value.generation)
        try store.write(PropertyListEncoder().encode(Set<Token>()), forKey: "protectedApplicationTokens." + value.generation)
        let processor = DeviceActivityUsageCallbackProcessor<Token>(store: store)
        let event = try XCTUnwrap(value.thresholds.first)
        let utc = TimeZone(identifier: "UTC")!
        try install(value, store: store, active: false)
        XCTAssertFalse(try processor.consume(activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: utc))
        XCTAssertNil(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: value))
        try install(value, store: store, active: true)
        XCTAssertTrue(try processor.consume(activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: utc))
        XCTAssertEqual(try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: value), 60)
        // A valid-looking manifest threshold must still agree with the stored policy.
        let manifestKey = deviceActivityMonitorInstallationStorageKey
        let originalManifest = try XCTUnwrap(store.read(forKey: manifestKey))
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: originalManifest) as? [String: Any])
        var alteredPlan = try XCTUnwrap(object["usageDayPlan"] as? [String: Any])
        var thresholds = try XCTUnwrap(alteredPlan["thresholds"] as? [[String: Any]])
        thresholds[0]["minutes"] = 61
        alteredPlan["thresholds"] = thresholds
        object["usageDayPlan"] = alteredPlan
        try store.write(JSONSerialization.data(withJSONObject: object), forKey: manifestKey)
        XCTAssertNotNil(DeviceActivityMonitorInstallation.decodeValidated(try XCTUnwrap(store.read(forKey: manifestKey))))
        XCTAssertThrowsError(try processor.consume(activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: utc))
        try store.write(originalManifest, forKey: manifestKey)
        let tokenKey = "applicationTokens.policy." + value.generation
        let originalTokens = try XCTUnwrap(store.read(forKey: tokenKey))
        try store.write(Data("malformed token".utf8), forKey: tokenKey)
        XCTAssertThrowsError(try processor.consume(activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: utc))
        try store.write(originalTokens, forKey: tokenKey)
        store.remove(forKey: "activeActivityId")
        XCTAssertThrowsError(try processor.consume(activityId: value.monitorActivityId,
            eventId: event.eventId, at: now, deviceTimeZone: utc))
    }
    func testObservedQuotaIsExtendedOnlyDuringBonusAndRestoredAtExpiry() throws {
        let bonus = BonusGrant(id: "bonus", appScope: .all, extraMinutes: 15,
            grantedAt: now.addingTimeInterval(-60), expiresAt: now.addingTimeInterval(60))
        let value = policy(bonuses: [bonus])
        let plan = try self.plan(value)
        XCTAssertEqual(Set(plan.thresholds.map(\.minutes)), Set([60, 75]))
        let during = ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: value,
            now: now, lowerBoundMinutes: 60, coverageAvailable: true))
        XCTAssertEqual(during.kind, .allowedBonus)
        XCTAssertEqual(during.remainingMinutesToday, 15)
        let after = ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: value,
            now: bonus.expiresAt, lowerBoundMinutes: 60, coverageAvailable: true))
        XCTAssertEqual(after.kind, .blockedLimitReached)
        XCTAssertEqual(value.dailyLimit?.usedMinutesToday, 0)
    }
    func testUnavailableCapabilityCannotBeUpgradedByUsageEvidence() {
        let input = DeviceActivityUsageEvaluation.input(policy: policy(capability: .unavailable),
            now: now, lowerBoundMinutes: 60, coverageAvailable: true)
        XCTAssertEqual(input.enforcementCapability, .unavailable)
        XCTAssertEqual(ScheduleEngine.evaluate(input).kind, .enforcementUnavailable)
    }
    func testParentExceptionOverridesObservedQuotaOnlyUntilItsExpiry() {
        let exception = ParentException(id: "parent", appScope: .all,
            startAt: now.addingTimeInterval(-60), endAt: now.addingTimeInterval(60))
        let value = policy(exceptions: [exception])
        XCTAssertEqual(ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: value,
            now: now, lowerBoundMinutes: 60, coverageAvailable: true)).kind, .allowedException)
        XCTAssertEqual(ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: value,
            now: exception.endAt, lowerBoundMinutes: 60, coverageAvailable: true)).kind, .blockedLimitReached)
    }
    func testReorderedThresholdsNeverReduceRetainedMaximum() throws {
        let bonus = BonusGrant(id: "bonus", appScope: .all, extraMinutes: 15,
            grantedAt: now.addingTimeInterval(-60), expiresAt: now.addingTimeInterval(60))
        let value = try plan(policy(bonuses: [bonus]))
        let store = Store()
        // The observed store is shared with the active manifest, just as in production.
        let sharedUsage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        try install(value, store: store, active: true)
        let utc = TimeZone(identifier: "UTC")!
        for minutes in [75, 60, 75, 60] {
            let event = try XCTUnwrap(value.thresholds.first(where: { $0.minutes == minutes }))
            XCTAssertEqual(try sharedUsage.record(plan: value, activityId: value.monitorActivityId,
                eventId: event.eventId, at: now, deviceTimeZone: utc), 75)
        }
        XCTAssertEqual(try sharedUsage.lowerBound(for: value), 75)
    }
    func testFailedHigherObservationPreservesPreviouslyPersistedLowerBound() throws {
        let bonus = BonusGrant(id: "bonus", appScope: .all, extraMinutes: 15,
            grantedAt: now.addingTimeInterval(-60), expiresAt: now.addingTimeInterval(60))
        let value = try plan(policy(bonuses: [bonus]))
        let store = Store(), utc = TimeZone(identifier: "UTC")!
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        try install(value, store: store, active: true)
        let low = try XCTUnwrap(value.thresholds.first(where: { $0.minutes == 60 }))
        let high = try XCTUnwrap(value.thresholds.first(where: { $0.minutes == 75 }))
        _ = try usage.record(plan: value, activityId: value.monitorActivityId, eventId: low.eventId,
            at: now, deviceTimeZone: utc)
        store.ignoreWrites = true
        XCTAssertThrowsError(try usage.record(plan: value, activityId: value.monitorActivityId,
            eventId: high.eventId, at: now, deviceTimeZone: utc))
        XCTAssertEqual(try usage.lowerBound(for: value), 60)
        store.ignoreWrites = false
        XCTAssertEqual(try usage.record(plan: value, activityId: value.monitorActivityId,
            eventId: high.eventId, at: now, deviceTimeZone: utc), 75)
    }
    func testSharedEnforcementBoundaryPreservesShieldsOnAttributionOrSafetyFailure() throws {
        var applied = 0, removed = 0
        let tokens = Set([Token(value: "opaque")])
        let store = Store(), value = try plan(policy())
        store.values["com.pca.app.deviceactivity.usage-lower-bound.v1"] = Data("corrupt".utf8)
        XCTAssertFalse(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: tokens, protectedApplications: [], coverageAvailable: true,
            loadLowerBound: { try DeviceActivityUsageLowerBoundStore<Token>(store: store).lowerBound(for: value) },
            apply: { _ in applied += 1 }, remove: { removed += 1 }))
        XCTAssertFalse(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: tokens, protectedApplications: tokens, coverageAvailable: true,
            loadLowerBound: { 60 }, apply: { _ in applied += 1 }, remove: { removed += 1 }))
        XCTAssertEqual(applied, 0)
        XCTAssertEqual(removed, 0)
        XCTAssertTrue(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: tokens, protectedApplications: [], coverageAvailable: true,
            loadLowerBound: { 60 }, apply: { _ in applied += 1 }, remove: { removed += 1 }))
        XCTAssertEqual(applied, 1)
        XCTAssertEqual(removed, 0)
    }
    func testSharedEnforcementPreservesShieldsWhenPendingActivationCannotPersist() throws {
        let store = Store(), value = try plan(policy())
        let usage = DeviceActivityUsageLowerBoundStore<Token>(store: store)
        let event = try XCTUnwrap(value.thresholds.first)
        try install(value, store: store, active: false)
        try usage.stage(plan: value, activityId: value.monitorActivityId, eventId: event.eventId,
            at: now, deviceTimeZone: TimeZone(identifier: "UTC")!)
        try install(value, store: store, active: true)
        store.ignoreWrites = true
        var mutations = 0
        let load: () throws -> Int? = {
            try usage.activate(plan: value)
            return try usage.lowerBound(for: value)
        }
        XCTAssertFalse(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: Set([Token(value: "opaque")]), protectedApplications: [],
            coverageAvailable: true, loadLowerBound: load,
            apply: { _ in mutations += 1 }, remove: { mutations += 1 }))
        XCTAssertEqual(mutations, 0)
        XCTAssertNotNil(store.read(forKey: "usage.pending." + value.generation))
        store.ignoreWrites = false
        XCTAssertTrue(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: Set([Token(value: "opaque")]), protectedApplications: [],
            coverageAvailable: true, loadLowerBound: load,
            apply: { _ in mutations += 1 }, remove: { XCTFail("Retained quota must restrict") }))
        XCTAssertEqual(mutations, 1)
    }
}
