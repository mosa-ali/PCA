import Foundation
import XCTest
@testable import PCA

final class DeviceActivityUsageBindingResolverTests: XCTestCase {
    private struct Token: Hashable, Codable { let value: String }

    private final class Backing: OpaqueBlobStore, DeviceActivityUsageAssociationSnapshotPersistence {
        var values: [String: Data] = [:]

        func writeAtomically(_ data: Data, forKey key: String) throws { values[key] = data }
        func write(_ data: Data, forKey key: String) throws { values[key] = data }
        func read(forKey key: String) -> Data? { values[key] }
        func remove(forKey key: String) { values.removeValue(forKey: key) }
    }

    private let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
    private let acceptedAuthority = Data("accepted-policy-revision-7".utf8)
    private let token = Token(value: "family-controls-token")

    private func binding(_ logicalAppToken: String = "logical-app") throws -> DeviceActivityUsageSelectionBinding {
        DeviceActivityUsageSelectionBinding(logicalAppToken: logicalAppToken,
            applicationTokenData: try PropertyListEncoder().encode(token))
    }

    private func policy(dailyLimit: DailyAppLimit? = DailyAppLimit(
        appScope: .all, limitMinutes: 30, usedMinutesToday: 0, anchorLocalDate: "2026-10-09"
    )) -> DecodedSchedulePolicy {
        DecodedSchedulePolicy(activityId: "policy", appToken: "logical-app", timeZone: TimeZone(secondsFromGMT: 0)!,
            windows: [], bonusGrants: [], exceptions: [], dailyLimit: dailyLimit, enforcementCapability: .enforced)
    }

    private func installedStore() throws -> (Backing, LocalDeviceActivityPolicyCoordination, DeviceActivityUsageAssociationStore<Token>) {
        let backing = Backing()
        let coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        try associations.installAcceptedAssociation(scope: scope, binding: binding(), authorityBinding: acceptedAuthority,
            revision: 7, revalidateAuthority: { context in
                XCTAssertEqual(context.scope, self.scope)
                XCTAssertEqual(context.logicalAppToken, "logical-app")
                XCTAssertEqual(context.authorityBinding, self.acceptedAuthority)
            })
        return (backing, coordination, associations)
    }

    func testAcceptedAssociationFlowsIntoDailyLimitEnforcement() throws {
        let (_, coordination, associations) = try installedStore()
        let resolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { DeviceActivityUsageAssociationAuthoritySnapshot(
                scope: self.scope, authorityBinding: self.acceptedAuthority
            ) },
            revalidateAuthority: { context in
                XCTAssertEqual(context.scope, self.scope)
                XCTAssertEqual(context.authorityBinding, self.acceptedAuthority)
                if let revision = context.revision { XCTAssertEqual(revision, 7) }
            }
        )

        let resolved = try coordination.withExclusiveAccessContext { access in
            resolver.resolve(policy: policy(), selectedTokens: [token], under: access)
        }
        let acceptedBinding = try XCTUnwrap(resolved)
        XCTAssertEqual(acceptedBinding, try binding())

        let now = ISO8601DateFormatter().date(from: "2026-10-09T12:00:00Z")!
        let plan = try DeviceActivityUsagePlanner.plan(policy: policy(), binding: acceptedBinding,
            generation: "22222222-2222-4222-8222-222222222222", now: now,
            deviceTimeZone: TimeZone(secondsFromGMT: 0)!, historicalActivitySupported: true, otherMonitorCount: 1)
        XCTAssertTrue(plan.matches(policy: policy()))

        var applied: Set<Token>?
        var removed = false
        XCTAssertTrue(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: [token], protectedApplications: [], coverageAvailable: true,
            loadLowerBound: { plan.thresholds[0].minutes },
            apply: { applied = $0 }, remove: { removed = true }))
        XCTAssertEqual(applied, [token])
        XCTAssertFalse(removed)
        XCTAssertEqual(ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: policy(), now: now,
            lowerBoundMinutes: plan.thresholds[0].minutes, coverageAvailable: true)).kind, .blockedLimitReached)
    }

    func testResolverRejectsWrongScopeSelectionAndStaleAuthority() throws {
        let (_, coordination, associations) = try installedStore()
        let wrongScopeResolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { DeviceActivityUsageAssociationAuthoritySnapshot(
                scope: DeviceActivityUsageAssociationScope(familyId: "family-b", deviceId: "device-a"),
                authorityBinding: self.acceptedAuthority
            ) },
            revalidateAuthority: { _ in }
        )
        XCTAssertNil(try coordination.withExclusiveAccessContext { access in
            wrongScopeResolver.resolve(policy: policy(), selectedTokens: [token], under: access)
        })

        let staleAuthority = Data("accepted-policy-revision-8".utf8)
        let staleResolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { DeviceActivityUsageAssociationAuthoritySnapshot(
                scope: self.scope, authorityBinding: staleAuthority
            ) },
            revalidateAuthority: { context in
                guard context.authorityBinding == staleAuthority else {
                    throw DeviceActivityUsageAssociationError.authorityRejected
                }
            }
        )
        XCTAssertNil(try coordination.withExclusiveAccessContext { access in
            staleResolver.resolve(policy: policy(), selectedTokens: [token], under: access)
        })

        let currentResolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { DeviceActivityUsageAssociationAuthoritySnapshot(
                scope: self.scope, authorityBinding: self.acceptedAuthority
            ) },
            revalidateAuthority: { context in
                XCTAssertEqual(context.authorityBinding, self.acceptedAuthority)
            }
        )
        let wrongSelection = try coordination.withExclusiveAccessContext { access in
            currentResolver.resolve(policy: policy(), selectedTokens: [Token(value: "other")], under: access)
        }
        XCTAssertNil(wrongSelection)
        XCTAssertNil(try coordination.withExclusiveAccessContext { access in
            staleResolver.resolve(policy: policy(dailyLimit: nil), selectedTokens: [token], under: access)
        })
    }

    func testRevokedAssociationCannotCreateUsagePlan() throws {
        let (_, coordination, associations) = try installedStore()
        try associations.revokeAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            authorityBinding: acceptedAuthority, revision: 8, revalidateAuthority: { context in
                XCTAssertEqual(context.authorityBinding, self.acceptedAuthority)
            })

        let resolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { DeviceActivityUsageAssociationAuthoritySnapshot(
                scope: self.scope, authorityBinding: self.acceptedAuthority
            ) },
            revalidateAuthority: { context in
                XCTAssertEqual(context.authorityBinding, self.acceptedAuthority)
            }
        )
        XCTAssertNil(try coordination.withExclusiveAccessContext { access in
            resolver.resolve(policy: policy(), selectedTokens: [token], under: access)
        })
    }
}
