# PCA shared contract foundation

This directory defines PCA-0's **logical** protocol contract catalogue. It is not an API specification, a wire format, an endpoint implementation, or a cryptographic implementation.

`catalogue.json` is a development-time metadata representation used only to validate the accepted logical contract in [architecture document 22](../docs/architecture/22_API_PROTOCOL_CONTRACTS.md). JSON is not selected as the family-envelope serialization. A future protocol/security review must select any wire representation only after proving that every signed field is preserved exactly.

The catalogue intentionally carries no real family identifiers, public keys, keys, ciphertext, locations, browsing data, or activity. Its fixtures use clearly synthetic opaque values only.

Run the self-contained validation suite with:

```powershell
node --test contracts/test/*.test.cjs
```

The checks reject duplicate message types, incomplete logical envelope fields, unrecognised message vocabulary, non-opaque payload declarations, and an attempt to add a readable server-side family-history surface.
