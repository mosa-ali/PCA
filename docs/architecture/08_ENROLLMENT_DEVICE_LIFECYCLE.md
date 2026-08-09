# 08 — Enrollment and Device Lifecycle

## 1. States

`NEW → INVITED → PAIRED → ACTIVE → DEGRADED → REVOKED → REMOVED`

A device may also enter `RECOVERY_PENDING`.

## 2. Pairing

1. Family Owner creates child profile.
2. Parent device requests a one-time enrollment token.
3. Enrollment service returns short-lived opaque token/QR material.
4. Child Agent generates device key pair locally.
5. Child submits public key + enrollment token.
6. Parent confirms device details and establishes family trust.
7. Family policy is E2EE-sent to child.
8. Token is invalidated.

No family private key is uploaded as plaintext.

## 3. Device replacement

- New child device uses fresh key pair.
- Old device is explicitly revoked.
- Parent chooses whether allowed retained family history is copied to the new device.
- Revoked device can no longer decrypt new policy/history messages.

## 4. Parent-phone replacement

Use offline family recovery key plus second factor/authorized parent approval. Recovery rotates parent device keys and revokes lost-device keys.

## 5. Removal

Authorized family removal sequence:
- confirm strong parent authentication;
- send signed removal/revoke command;
- export/delete history according to parent choice;
- release platform parental-control authority through supported APIs;
- revoke device certificates/keys;
- erase family data from the removed device when technically possible.

## 6. Lost/offline child device

The service records revocation intent. The child device rejects future service access and applies revocation when it next reconnects. The parent UI clearly shows pending status.
