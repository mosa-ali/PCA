package org.pca.app.runtime.sync.inbox

import java.util.UUID
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.withLock

sealed class InboundVerificationResult {
    object Unavailable : InboundVerificationResult()
    /** Bindings describe verified acceptance; the verifier must recheck current trusted authority. */
    data class Accepted(val authorityBinding: String, val commandBinding: String, val revalidateAuthority: () -> Unit) : InboundVerificationResult()
}

fun interface InboundCommandVerifier {
    suspend fun verify(candidate: CiphertextInboxRecord, scope: RuntimeInboxScope): InboundVerificationResult
}

object UnavailableInboundCommandVerifier : InboundCommandVerifier {
    override suspend fun verify(candidate: CiphertextInboxRecord, scope: RuntimeInboxScope) = InboundVerificationResult.Unavailable
}

sealed class InboundEffectRecovery {
    object Unknown : InboundEffectRecovery()
    object NotApplied : InboundEffectRecovery()
    data class Completed(val outcome: InboundApplicationOutcome) : InboundEffectRecovery()
}

interface InboundCommandApplier {
    /** Reconcile the durable operation ID, never infer success from an intent alone. */
    suspend fun reconcile(intent: InboundApplicationIntent): InboundEffectRecovery
    /** Check authority at the actual effect boundary after any internal suspension. */
    suspend fun apply(intent: InboundApplicationIntent, assertAuthority: () -> Unit): InboundApplicationOutcome
}

class InboundCommandConsumerUnavailable : Exception("Verified command consumer unavailable")
private class InboundEffectDeferred : Exception()

/** Injectable verified application orchestration. No production crypto suite is selected here. */
class VerifiedInboundCommandConsumer(
    private val journal: PersistentInboundApplicationJournal,
    private val verifier: InboundCommandVerifier,
    private val applier: InboundCommandApplier,
    private val nowEpochMillis: () -> Long = System::currentTimeMillis,
    private val monotonicNanos: () -> Long = System::nanoTime,
    private val replayDenial: PersistentInboundReplayDenialLedger? = null,
) {
    init { require(replayDenial == null || replayDenial.matchesJournal(journal)) }
    private val mutex = journal.operationMutex

    fun pending(candidates: List<CiphertextInboxRecord>, scope: RuntimeInboxScope): List<CiphertextInboxRecord> {
        journal.assertReplayDenialConfiguration(scope, replayDenial)
        replayDenial?.boundaries() // A configured but missing/corrupt ledger is unavailable even with no candidates.
        val records = journal.records()
        val seen = HashSet<String>()
        return candidates.filter { candidate ->
            val envelope = PersistentCiphertextInbox.validateEnvelope(candidate.envelopeWire, scope)
            if (envelope.messageId != candidate.messageId || !seen.add(candidate.messageId)) unavailable()
            val prior = records.find { it.intent.scope == scope && it.intent.messageId == candidate.messageId }
            if (prior != null && prior.intent.envelopeWire != candidate.envelopeWire) unavailable()
            if (prior == null) replayDenial?.isEnvelopeDenied(envelope, scope) != true else prior.outcome == null
        }
    }

    suspend fun consume(candidates: List<CiphertextInboxRecord>, scope: RuntimeInboxScope, assertAuthority: () -> Unit): Int = mutex.withLock {
        val context = currentCoroutineContext()
        val started = monotonicNanos()
        fun checkAuthority() {
            context.ensureActive()
            assertAuthority()
            val elapsed = monotonicNanos() - started
            if (elapsed < 0 || elapsed >= 30_000_000_000L) unavailable()
        }
        checkAuthority()
        val pending = pending(candidates, scope)
        val cursor = journal.processingCursor()
        val position = pending.indexOfFirst { journal.identity(scope, it.messageId) == cursor }
        val ordered = if (position < 0) pending else pending.drop(position + 1) + pending.take(position + 1)
        var completed = 0
        for (candidate in ordered.take(32)) {
            checkAuthority()
            journal.advanceProcessingCursor(scope, candidate.messageId)
            val acceptance = verifier.verify(candidate, scope)
            checkAuthority()
            if (acceptance !is InboundVerificationResult.Accepted) continue
            fun freshAuthority() {
                checkAuthority(); acceptance.revalidateAuthority()
                journal.assertReplayDenialConfiguration(scope, replayDenial)
                replayDenial?.boundaries()
                checkAuthority()
            }
            val envelope = PersistentCiphertextInbox.validateEnvelope(candidate.envelopeWire, scope)
            fun authorizeNewEffect() {
                freshAuthority()
                if (replayDenial?.isEnvelopeDenied(envelope, scope) == true) throw InboundEffectDeferred()
                val now = nowEpochMillis()
                if (now < envelope.issuedAtEpochMillis || now >= envelope.expiresAtEpochMillis) throw InboundEffectDeferred()
            }
            freshAuthority()
            val existing = journal.records().find { it.intent.scope == scope && it.intent.messageId == candidate.messageId }
            val intent = if (existing != null) {
                if (existing.intent.envelopeWire != candidate.envelopeWire || existing.intent.authorityBinding != acceptance.authorityBinding ||
                    existing.intent.commandBinding != acceptance.commandBinding) unavailable()
                existing.intent
            } else {
                try { authorizeNewEffect() } catch (_: InboundEffectDeferred) { continue }
                InboundApplicationIntent(UUID.randomUUID().toString(), scope, candidate.messageId, candidate.envelopeWire,
                    acceptance.authorityBinding, acceptance.commandBinding, nowEpochMillis()).also { journal.prepare(it) }
            }
            val recovery = applier.reconcile(intent)
            freshAuthority()
            val outcome = when (recovery) {
                InboundEffectRecovery.Unknown -> continue
                is InboundEffectRecovery.Completed -> recovery.outcome
                InboundEffectRecovery.NotApplied -> {
                    try {
                        authorizeNewEffect()
                        applier.apply(intent, ::authorizeNewEffect)
                    } catch (_: InboundEffectDeferred) { continue }
                }
            }
            freshAuthority()
            journal.complete(intent, outcome, nowEpochMillis())
            completed++
        }
        completed
    }

    private fun unavailable(): Nothing = throw InboundCommandConsumerUnavailable()
}
