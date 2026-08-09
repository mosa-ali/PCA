# 15 — App Usage, Browser and YouTube Visibility

## 1. Android app usage

Android UsageStats APIs can provide application usage statistics/events after appropriate access is granted. PCA normalizes this into local UsageSession records.

## 2. iOS app usage

PCA uses Screen Time APIs and privacy-preserving activity tokens/reports where Apple permits. The architecture does not assume unrestricted package/app history.

## 3. Browser visibility matrix

| Context | Expected visibility |
|---|---|
| PCA Safe Browser | Full local URL/title/history according to retention policy |
| Other Android browsers | Domain-level visibility may be available through local filtering; full HTTPS paths are not generally visible without browser cooperation |
| Safari/other iOS browsers | Only what Apple public APIs/Family Controls expose; do not promise universal full URL history |

## 4. YouTube app

PCA can track YouTube application usage duration where platform usage APIs allow.

The official YouTube Data API does **not** provide access to the user's watch history. PCA must not advertise otherwise.

## 5. PCA-controlled YouTube experience

Optional strict mode may present YouTube content through a compliant PCA-controlled experience using official YouTube APIs/embedded player rules. PCA may locally record videos initiated inside that controlled experience when terms permit, including:
- video ID;
- title/channel metadata;
- start/end time;
- viewing duration.

This does not imply retrieval of the user's general YouTube watch history.

## 6. Reporting labels

Every report must identify its confidence/source, for example:
- `Exact — PCA Safe Browser`;
- `Domain only — local filter`;
- `App usage only — OS usage stats`;
- `Unavailable on this platform`.
