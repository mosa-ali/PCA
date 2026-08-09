# 09 — Security, Privacy and End-to-End Encryption

## 1. Security goals

- family monitoring content confidential from PCA infrastructure;
- only authorized family roles can issue policies/read permitted reports;
- child policy cannot be silently downgraded by network attackers;
- lost parent/child devices can be revoked;
- activity retention is enforceable locally;
- support staff cannot recover family plaintext.

## 2. Key hierarchy

Conceptual keys:

- Family Root Recovery Secret — generated during family setup, displayed/exported securely to Family Owner; not centrally stored in recoverable plaintext.
- Parent Device Identity Key — per parent device.
- Child Device Identity Key — per child device.
- Family Data Encryption Key(s) — rotated and wrapped to authorized device keys.
- Message Session Keys — ephemeral/derived for transport payload encryption.

Concrete cryptographic primitives are selected during security implementation review from platform-supported modern libraries; custom cryptography is prohibited.

## 3. Message properties

Every family-control message must include:
- protocol version;
- family/device opaque IDs;
- sender key ID;
- message type;
- monotonic sequence or replay-resistant nonce;
- issued-at/expiry fields;
- policy/data version;
- authenticated encrypted payload;
- sender authentication/signature as required by the protocol design.

## 4. Server knowledge

Central service may know:
- account/license relationship;
- public keys;
- platform/app versions;
- push routing tokens;
- last relay connection timestamp;
- coarse operational health.

It must not know readable:
- URLs/history;
- app-use events;
- precise locations;
- content classifications tied to a child;
- prayer activity;
- child photos/face frames.

## 5. Push notifications

FCM/APNs payloads contain only opaque wake/reference information or generic messages. Sensitive alert detail is retrieved/decrypted in-app.

## 6. Local encryption

Sensitive local databases use OS-backed key protection. Database encryption must not rely only on an app-level hardcoded password.

## 7. Backup policy

Device/cloud backup behavior must be explicitly configured so private keys and sensitive databases are not unintentionally backed up in insecure/recoverable forms.

## 8. Data export

Parent-requested export is encrypted and generated on the parent device. Exports include retention scope and creation timestamp.
