# PCA-DEC-020-R2 browser key lifecycle policy

The production Parent Web trusted-endpoint signing key is a WebCrypto ECDSA
P-256 private key generated with `extractable: false`. The private key is held
only by a module-scoped in-memory handle and is never exported, serialized,
placed in localStorage/sessionStorage/cookies, or logged. Signatures are
canonicalized to fixed-width low-S IEEE-P1363 before they leave the browser.

This is intentionally a tab-lifetime key policy. A page reload, tab close,
browser restart, origin-data clear, or in-memory module reset loses the key and
requires the approved pairing flow again. That is a known availability cost,
not permission to weaken private-key handling. IndexedDB persistence of a
non-extractable CryptoKey may be reviewed as a separate change; it is not
introduced by R2.
