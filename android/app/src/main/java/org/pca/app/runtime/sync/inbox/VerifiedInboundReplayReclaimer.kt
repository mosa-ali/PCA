package org.pca.app.runtime.sync.inbox

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.withLock

sealed class InboundRetirementVerification {
    object Unavailable : InboundRetirementVerification()
    /** A trusted producer authenticates permanent numeric mode, closed coverage and current root. */
    data class Accepted(val boundary: InboundReplayRetirementBoundary, val revalidateAuthority: () -> Unit) : InboundRetirementVerification()
}

fun interface InboundRetirementVerifier {
    suspend fun verify(scope: RuntimeInboxScope): InboundRetirementVerification
}

object UnavailableInboundRetirementVerifier : InboundRetirementVerifier {
    override suspend fun verify(scope: RuntimeInboxScope) = InboundRetirementVerification.Unavailable
}

/** Host-process orchestration only; a shared OS store writer requires a cross-process coordinator. */
class VerifiedInboundReplayReclaimer(
    private val journal: PersistentInboundApplicationJournal,
    private val inbox: PersistentCiphertextInbox,
    private val denial: PersistentInboundReplayDenialLedger,
    private val verifier: InboundRetirementVerifier = UnavailableInboundRetirementVerifier,
    private val monotonicNanos: () -> Long = System::nanoTime,
) {
    init { require(inbox.matchesJournal(journal) && denial.matchesJournal(journal)) }

    /** Returns retired journal records and inbox-only entries, never application completions or relay acknowledgements. */
    suspend fun reclaim(scope: RuntimeInboxScope, assertAuthority: () -> Unit): Int = journal.operationMutex.withLock {
        val context = currentCoroutineContext()
        val started = monotonicNanos()
        fun check() {
            context.ensureActive(); assertAuthority()
            val elapsed = monotonicNanos() - started
            if (elapsed < 0 || elapsed >= 30_000_000_000L) throw InboundReplayDenialUnavailable()
        }
        check()
        if (inbox.retainedScope() != scope) throw InboundReplayDenialUnavailable()
        val acceptance = verifier.verify(scope)
        check()
        if (acceptance !is InboundRetirementVerification.Accepted) return@withLock 0
        if (acceptance.boundary.scope != scope) throw InboundReplayDenialUnavailable()
        fun freshAuthority() { check(); acceptance.revalidateAuthority(); denial.boundaries(); check() }
        freshAuthority()
        // This marker is permanent: all future consumers, including legacy nil-default instances,
        // must require the denial ledger once cleanup begins.
        journal.requireReplayDenial()
        // A verified irreversible denial must be durable before inspecting or deleting records.
        denial.install(acceptance.boundary, ::freshAuthority)
        freshAuthority()
        var reclaimed = 0
        val journalAtStart = journal.records().filter { it.intent.scope == scope }
        for (record in journalAtStart.filter { it.outcome != null }) {
            freshAuthority()
            val envelope = PersistentCiphertextInbox.validateEnvelope(record.intent.envelopeWire, scope)
            if (!denial.coversReplayIdentityPermanently(envelope, scope)) continue
            fun coverage() {
                freshAuthority()
                if (!denial.coversReplayIdentityPermanently(envelope, scope)) throw InboundReplayDenialUnavailable()
            }
            val held = inbox.pendingCrypto(scope).find { it.messageId == record.intent.messageId }
            if (held != null) {
                if (held.envelopeWire != record.intent.envelopeWire) throw InboundReplayDenialUnavailable()
                if (held.acknowledgementPending) continue
                inbox.removeRetiredAcknowledged(scope, held, ::coverage)
            }
            // Missing ciphertext within the retained scope is the resumable state after its
            // deletion succeeded but the final journal write failed. Permanent denial remains.
            coverage()
            if (journal.removeRetiredTerminal(record, ::coverage)) reclaimed++
        }
        // A denied redelivery can be captured after its terminal journal record was retired.
        // Preserve all journal-backed items (including prepared operations), and reclaim only
        // exact, already-acknowledged inbox entries whose replay identity has permanent coverage.
        val remaining = journal.records().filter { it.intent.scope == scope }
        val journalAtStartByMessageId = journalAtStart.associateBy { it.intent.messageId }
        for (held in inbox.pendingCrypto(scope)) {
            freshAuthority()
            val envelope = PersistentCiphertextInbox.validateEnvelope(held.envelopeWire, scope)
            if (envelope.messageId != held.messageId) throw InboundReplayDenialUnavailable()
            val prior = remaining.find { it.intent.messageId == held.messageId }
            if (prior != null) {
                if (prior.intent.envelopeWire != held.envelopeWire) throw InboundReplayDenialUnavailable()
                continue
            }
            val priorAtStart = journalAtStartByMessageId[held.messageId]
            if (priorAtStart != null) {
                if (priorAtStart.intent.envelopeWire != held.envelopeWire) throw InboundReplayDenialUnavailable()
                continue
            }
            if (held.acknowledgementPending || !denial.coversReplayIdentityPermanently(envelope, scope)) continue
            fun coverage() {
                freshAuthority()
                if (!denial.coversReplayIdentityPermanently(envelope, scope)) throw InboundReplayDenialUnavailable()
            }
            if (inbox.removeRetiredAcknowledged(scope, held, ::coverage)) reclaimed++
        }
        reclaimed
    }
}
