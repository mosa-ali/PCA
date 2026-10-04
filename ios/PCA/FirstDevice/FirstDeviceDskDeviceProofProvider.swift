import Foundation
#if canImport(Security)
import Security
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// Narrow composition seam so tests can substitute key material without a
/// keychain, and so the provider depends on the smallest possible surface.
public protocol FirstDeviceDskKeyMaterial: FirstDeviceKeyPairGenerating, FirstDeviceDskSigning {
    func signingKeyAlias(attemptId: String) -> String
    func encryptionKeyAlias(attemptId: String) -> String
    /// Canonical SEC1 (unpadded base64url) public half of the key behind
    /// `alias`; throws when absent -- never generates anything.
    func loadPublicKeyBase64(alias: String) throws -> String
}

#if canImport(Security) && canImport(CryptoKit)

extension SecureEnclaveDskProvider: FirstDeviceDskKeyMaterial {}

/// WAVE 6D: enrollment-time key preparation capability. This is the ONLY
/// call that generates the attempt's DSK/DEK pair; it runs AFTER the attempt
/// record exists (attemptId BEFORE keygen -- a process death can never leave
/// key material whose attempt is unknown) and BEFORE the bootstrap request
/// reads the public keys. Kept as a separate protocol (not folded into
/// `PCADeviceProofProvider`) so every existing proof-provider implementation
/// stays valid without pretending to prepare keys.
public protocol FirstDeviceEnrollmentKeyPreparation {
    /// Generates (create-once) the attempt's Secure Enclave DSK and DEK.
    /// Idempotent for the SAME attempt id; throws for a different one while
    /// another attempt (or a committed root) is active, and for every
    /// Secure Enclave refusal. Never falls back to software keys.
    func prepareEnrollmentKeys(attemptId: String) throws
}

/// WAVE 6D: the ONE production `PCADeviceProofProvider` instance shared by
/// both transport compositions (the enrollment bootstrap path AND the
/// runtime-sync session client receive the SAME reference -- a single
/// identity/state holder, never two diverging copies).
///
/// IDENTITY MODEL
///  - The active attempt is either the transient PREPARED attempt (set by
///    `prepareEnrollmentKeys` between key generation and durable seed
///    capture) or the PERSISTED attempt of the committed first-device root
///    (resolved through the injected `persistedAttemptId` seam, which the
///    composition root wires to the durable root store in the same Wave 6D
///    checkpoint).
///  - `signingPublicKey` / `encryptionPublicKey` are canonical SEC1
///    (unpadded base64url) Secure Enclave public keys loaded from the
///    active attempt's aliases. FAIL CLOSED: any missing material yields the
///    empty string, which the application's existing enrollment/session
///    guards treat as "crypto gate not ready" -- never as a usable key.
///  - `sign(challenge:)` signs the challenge UTF-8 bytes with the active
///    attempt's DSK inside the Secure Enclave and returns the canonical
///    IEEE-P1363 low-S 64-byte form, unpadded base64url (the exact backend
///    acceptance surface). Missing material throws
///    `PCADeviceProofError.secureKeyUnavailable` -- this provider NEVER
///    fabricates a signature and NEVER regenerates a key.
public final class FirstDeviceDskDeviceProofProvider: PCADeviceProofProvider, FirstDeviceEnrollmentKeyPreparation {
    private let provider: FirstDeviceDskKeyMaterial
    private let persistedAttemptId: () -> String?
    private let lock = NSLock()
    private var preparedAttemptId: String?

    public init(
        provider: FirstDeviceDskKeyMaterial,
        persistedAttemptId: @escaping () -> String? = { nil }
    ) {
        self.provider = provider
        self.persistedAttemptId = persistedAttemptId
    }

    // MARK: - FirstDeviceEnrollmentKeyPreparation

    public func prepareEnrollmentKeys(attemptId: String) throws {
        lock.lock()
        defer { lock.unlock() }
        guard !attemptId.isEmpty else { throw SecureEnclaveDskError.invalidAttemptId }
        if preparedAttemptId == attemptId { return }
        if let persisted = persistedAttemptId() {
            if persisted == attemptId {
                // Crash recovery of an attempt whose keys already exist:
                // re-activate WITHOUT regenerating anything.
                preparedAttemptId = attemptId
                return
            }
            // A committed first-device root exists for a DIFFERENT attempt:
            // generating a second root's keys here would be the forbidden
            // second-root path. Refuse; lifecycle decisions belong to the
            // ceremony coordinator.
            throw SecureEnclaveDskError.keyAliasConflict
        }
        guard preparedAttemptId == nil else {
            // Create-once per attempt: a second, DIFFERENT attempt while one
            // is still transiently prepared is a caller bug, never a silent
            // replacement.
            throw SecureEnclaveDskError.keyAliasConflict
        }
        do {
            _ = try provider.generateSigningKeyPair(attemptId: attemptId)
            _ = try provider.generateEncryptionKeyPair(attemptId: attemptId)
        } catch SecureEnclaveDskError.keyAliasConflict {
            // CRASH RECOVERY (Stage-B finding): key material for this SAME
            // attempt already exists while no durable seed does (process
            // death between keygen and seed capture). Re-activate the
            // attempt ONLY if BOTH public keys are actually readable;
            // otherwise rethrow -- never a silent replacement.
            guard (try? provider.loadPublicKeyBase64(alias: provider.signingKeyAlias(attemptId: attemptId))) != nil,
                  (try? provider.loadPublicKeyBase64(alias: provider.encryptionKeyAlias(attemptId: attemptId))) != nil else {
                throw SecureEnclaveDskError.keyAliasConflict
            }
        } catch {
            throw error
        }
        preparedAttemptId = attemptId
    }

    /// Clears the transient prepared attempt (e.g. after the durable seed
    /// capture takes over, or when enrollment is abandoned). Key material
    /// itself is reclaimed by the attempt-scoped orphan sweep, never here.
    public func clearPreparedAttempt() {
        lock.lock()
        defer { lock.unlock() }
        preparedAttemptId = nil
    }

    // MARK: - PCADeviceProofProvider

    public var signingPublicKey: String {
        guard let attemptId = activeAttemptId() else { return "" }
        return (try? provider.loadPublicKeyBase64(alias: provider.signingKeyAlias(attemptId: attemptId))) ?? ""
    }

    public var encryptionPublicKey: String {
        guard let attemptId = activeAttemptId() else { return "" }
        return (try? provider.loadPublicKeyBase64(alias: provider.encryptionKeyAlias(attemptId: attemptId))) ?? ""
    }

    public func sign(challenge: String) throws -> String {
        guard let attemptId = activeAttemptId() else {
            throw PCADeviceProofError.secureKeyUnavailable
        }
        do {
            let signature = try provider.signCanonical(
                alias: provider.signingKeyAlias(attemptId: attemptId),
                message: Data(challenge.utf8)
            )
            return FirstDeviceCanonical.base64Url(signature)
        } catch {
            // Every Secure Enclave failure collapses to the same typed
            // fail-closed signal; a fabricated or software-signed
            // challenge response must never leave this method.
            throw PCADeviceProofError.secureKeyUnavailable
        }
    }

    // MARK: - Internals

    private func activeAttemptId() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return preparedAttemptId ?? persistedAttemptId()
    }
}

#endif
