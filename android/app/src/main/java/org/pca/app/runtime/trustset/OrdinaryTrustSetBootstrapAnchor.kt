package org.pca.app.runtime.trustset

import java.util.Base64
import org.pca.app.firstdevice.FirstDeviceRootReadResult
import org.pca.app.firstdevice.FirstDeviceRootState
import org.pca.app.firstdevice.FirstDeviceRootStore

/** Seeds ordinary Trust Set custody only from the exact durable signed epoch-1 ceremony record. */
object OrdinaryTrustSetBootstrapAnchor {
    fun seed(
        rootStore: FirstDeviceRootStore,
        ordinaryStore: PersistentOrdinaryEpochStore,
        verifier: OrdinaryEpochSignatureVerifier,
    ): AcceptedEpochRecord {
        val root = (rootStore.readState() as? FirstDeviceRootReadResult.Present)?.record
            ?: throw IllegalStateException("committed_first_device_root_unavailable")
        val anchor = root.acceptedEpoch1 ?: throw IllegalStateException("committed_epoch1_anchor_unavailable")
        val familyId = root.familyId ?: throw IllegalStateException("committed_family_unavailable")
        require(root.state == FirstDeviceRootState.ROOT_COMMITTED && root.committedAtMillis != null &&
            root.submission == null && root.seed.attemptRecoveryToken.isEmpty() && rootStore.confirmDurable(root))

        val canonicalBytes = anchor.canonicalBytes.toByteArray(Charsets.UTF_8)
        require(canonicalBytes.isNotEmpty() && canonicalBytes.size <= TrustSetEpochCodec.MAX_CANONICAL_UTF8_BYTES)
        val epoch = TrustSetEpochCodec.decodeCanonical(canonicalBytes)
        require(TrustSetEpochCodec.canonicalize(epoch).toByteArray(Charsets.UTF_8).contentEquals(canonicalBytes))
        require(epoch.familyId == familyId && epoch.trustSetEpoch == 1 && epoch.keyEpoch == 1 &&
            epoch.supersedesEpoch == null && epoch.entries.size == 1)

        val owner = epoch.entries.single()
        val seed = root.seed
        require(owner.role == TrustSetRole.OWNER && owner.status == TrustSetMembershipStatus.ACTIVE &&
            owner.deviceId == seed.deviceId && owner.dskKeyId == seed.signingKeyId &&
            owner.dskPublicKey == seed.dskPublicKeyBase64 && owner.dekKeyId == seed.encryptionKeyId &&
            owner.dekPublicKey == seed.dekPublicKeyBase64 &&
            seed.dskAlias == "pca.dsk.${seed.attemptId}" && seed.dekAlias == "pca.dek.${seed.attemptId}" &&
            seed.dskAlias != seed.dekAlias)

        val signatureBytes = Base64.getUrlDecoder().decode(anchor.signatureBase64Url)
        require(signatureBytes.size == 64 &&
            Base64.getUrlEncoder().withoutPadding().encodeToString(signatureBytes) == anchor.signatureBase64Url)
        val signatureBase64 = Base64.getEncoder().encodeToString(signatureBytes)
        require(verifier.verify(seed.dskPublicKeyBase64, canonicalBytes, signatureBase64))

        val accepted = AcceptedEpochRecord(
            OrdinaryEpochRequest(Base64.getEncoder().encodeToString(canonicalBytes), signatureBase64),
            seed.deviceId,
            seed.signingKeyId,
            trustSetEpoch = 1,
            keyEpoch = 1,
        )
        val initial = OrdinaryEpochState(accepted = accepted, rootAnchor = accepted)
        if (ordinaryStore.initializeFromVerifiedRoot(initial)) {
            check(rootStore.confirmDurable(root))
            check(ordinaryStore.confirmDurable(initial))
            return accepted
        }

        val existing = ordinaryStore.read() ?: throw IllegalStateException("ordinary_trust_set_state_unavailable")
        val existingBytes = Base64.getDecoder().decode(existing.accepted.request.canonicalEpochBase64)
        require(Base64.getEncoder().encodeToString(existingBytes) == existing.accepted.request.canonicalEpochBase64)
        val existingEpoch = TrustSetEpochCodec.decodeCanonical(existingBytes)
        require(existing.rootAnchor == accepted && existingEpoch.familyId == familyId &&
            existing.accepted.trustSetEpoch >= 1 && existing.accepted.keyEpoch >= 1 &&
            (existing.accepted.trustSetEpoch != 1 || existing.accepted == accepted) &&
            ordinaryStore.confirmDurable(existing) && rootStore.confirmDurable(root))
        return existing.accepted
    }
}
