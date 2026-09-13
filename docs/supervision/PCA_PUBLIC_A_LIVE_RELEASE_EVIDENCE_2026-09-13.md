# PCA Public Release A — Live Release Evidence

This record documents the controlled Public-only publication and live checks. It
does not authorize backend deployment, Azure production changes outside `pcaSafe`,
or final legal release.

```text
PUBLIC_SOURCE_SHA=96887770a55c8d4cbf44f7cbc4c9cea5681ac8f2
PUBLIC_IMAGE_TAG=pcasafe.azurecr.io/pca-public:sha-9688777-20260913
PUBLIC_IMAGE_DIGEST=sha256:c0b2b1b710adfb3bf9756a1f61c08fb6167a421f7c14efd528d116c5677b8782
AZURE_TARGET=pcaSafe
AZURE_RESOURCE_GROUP=pca-group
DOMAIN=www.pcasafe.com
ROLLBACK_IMAGE_REFERENCE=pcasafe.azurecr.io/pca-backend:5dacd84 (predeploy target state)

EN_AR_PARITY=PASS; build reported EN 193 / AR 193 exact key parity; live EN and AR route set returned 200
ACCESSIBILITY=PARTIAL; automated container verifier passed 301/301, but manual keyboard/focus/visual owner UAT was not executed because the in-app browser session was unavailable
RESPONSIVE=PASS live Chromium checks 48/48 (16 EN/AR routes at 375px, 768px, and 1280px; no horizontal overflow or console errors); visual owner sign-off remains separate
LIVE_ROUTES=PASS; 16/16 published EN/AR routes returned 200; unknown route returned 404
HTTPS=PASS; httpsOnly=true, HTTPS origin served successfully, no redirect defect observed
TLS=PASS; www.pcasafe.com SNI binding active with thumbprint 2E230453442F1A1C59B79FB1CE04AA2C0082B18E, minimum TLS 1.2
PRIVACY_CLAIMS=PASS wording states PCA is designed not to build a readable central profile; no zero-data claim
CONTACT=PASS; EN and AR contact routes returned 200
DOWNLOAD_HONESTY=PASS; no fake store badges or fake download links; unavailable functionality uses Coming Later/Not Yet Available
FAKE_LINKS=0
LOGIN_VISIBLE=NO
SIGNUP_VISIBLE=NO
LEGAL_STATUS=NOT_AUTHORIZED; unresolved legal entity, jurisdiction, controller identity, postal address, and effective-date facts remain OWNER_REQUIRED

PUBLIC_A=LIVE_UAT_CANDIDATE_NOT_FINAL_RELEASE
READY_FOR_APPLICATION_PROGRAMME=NO
```

## Azure target integrity

Before cutover, `pcaSafe` was running the backend reference
`pcasafe.azurecr.io/pca-backend:5dacd84` and contained `MS_CLIENT_ID`,
`MS_CLIENT_SECRET`, and `MS_TENANT_ID` settings. The target-only cutover removed
those settings, set `WEBSITES_PORT=80`, and pinned `DOCKER_CUSTOM_IMAGE_NAME` to
the Public image digest above. The separate `pca` backend App Service was not
modified.

The ACR push used the immutable dated tag above. Local image build and verifier
passed; the verifier checked health, all artifact pages, response security
headers (including error responses), CSP restrictions, manifest/file integrity,
and browser-backed behavior: `301/301` checks passed. A direct live HTTPS pass
also checked all published EN/AR routes, RTL markers, 404 behavior, security
headers, `robots.txt`, `sitemap.xml`, canonical metadata, and forbidden
login/signup/store/download patterns.

The in-app browser connector had no connected browser in this session. Therefore
manual visual, keyboard, and owner legal UAT are not represented as completed by
this document. No deployment was made to the backend App Service, and no Azure
resource outside `pcaSafe` was changed.
