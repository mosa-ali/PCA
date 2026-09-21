# PCA-DEC-020-R2 native interop status

`NATIVE_CROSS_CLIENT_RELEASE_BLOCKER = YES`.

The repository does not yet contain approved Android or iOS production
adapters that generate the reviewed P-256 DSK, canonicalize low-S P1363
signatures, and complete the dedicated family-genesis proof contract.

- Android production composition uses
  `NotApprovedDeviceKeyPairGenerator` and fails closed with
  `CryptoSuiteNotApprovedException`.
- iOS production composition uses `PendingPCADeviceProofProvider`, whose
  signing operation fails with `cryptoActivationPending`.

These are deliberate safety gates. Node/backend and browser tests do not count
as Android/iOS certification. No native implementation or release claim is
being fabricated in the R2 source-only lane. Native vectors, adapters, and
physical-device evidence remain required before production crypto activation.
