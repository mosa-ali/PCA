import type { OpaqueFamilyId, SenderKeyId } from '../familyenvelope/types.js';
import type { SequenceProgressLedger } from './SequenceProgressLedger.js';

export class InMemorySequenceProgressLedger implements SequenceProgressLedger {
  private readonly lastApplied = new Map<string, number>();

  /**
   * NF-003: previously joined with a literal raw NUL byte (a corrupted
   * separator, not an intentional one) -- not text-source friendly and not
   * a documented encoding choice. Replaced with the same netstring-style
   * length-prefixing convention already used by
   * familyenvelope/canonicalize.ts: `${byteLength}:${value}` per
   * component, concatenated with no separator character between them.
   * Length-prefixing alone disambiguates component boundaries, so unlike a
   * plain delimiter (space, colon, NUL, ...) this can never be defeated by
   * a component that happens to contain that delimiter's byte sequence --
   * familyId and senderKeyId are opaque strings with no guaranteed
   * charset restriction (see familyenvelope/policy.ts's
   * isPlausibleOpaqueId, which bounds only length), so any single
   * delimiter choice would remain collision-prone without this.
   */
  private key(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): string {
    return `${Buffer.byteLength(familyId, 'utf8')}:${familyId}${Buffer.byteLength(senderKeyId, 'utf8')}:${senderKeyId}`;
  }

  async getLastAppliedSequence(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): Promise<number | null> {
    return this.lastApplied.get(this.key(familyId, senderKeyId)) ?? null;
  }

  async recordAppliedSequence(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, sequence: number): Promise<void> {
    const key = this.key(familyId, senderKeyId);
    const current = this.lastApplied.get(key) ?? -Infinity;
    if (sequence > current) this.lastApplied.set(key, sequence);
  }
}
