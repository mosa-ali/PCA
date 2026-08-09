# 24 — Threat Model and Abuse Cases

## 1. Protected assets

- family encryption keys;
- parent role authority;
- child location/activity history;
- filtering policies;
- recovery credentials;
- enrollment tokens;
- software/model update integrity.

## 2. Adversaries

- unauthorized person with temporary physical device access;
- child attempting ordinary rule bypass;
- stolen parent phone;
- malicious network observer;
- compromised relay/service database;
- malicious dependency/update;
- abusive adult attempting to use PCA outside its child-parent purpose.

## 3. Key threats and controls

| Threat | Control |
|---|---|
| Relay database breach | E2EE payloads; short ciphertext TTL |
| Stolen parent phone | device key protection, biometric/PIN, remote revoke/recovery |
| Replay old allow policy | version/sequence/expiry validation |
| Fake child device | enrollment token + key confirmation |
| Child disables VPN/permission | visible degraded state + parent alert |
| Malicious model/rule update | signed packages + pin/version validation + rollback |
| Support-agent curiosity | no decryption keys; least-privilege metadata access |
| Covert adult surveillance | product scope, disclosure, monitoring-app policy compliance, no hidden mode |
| Data kept forever | enforced retention choices + delete-now |

## 4. Abuse prevention

PCA is marketed only for lawful parent/guardian child supervision. It does not include stealth icon hiding, invisible monitoring, covert adult tracking or a “secret install” workflow.

## 5. Security assumptions

A fully compromised/rooted/jailbroken OS can undermine application guarantees. PCA reports elevated risk but does not claim absolute tamper-proofing against an attacker who controls the operating system.
