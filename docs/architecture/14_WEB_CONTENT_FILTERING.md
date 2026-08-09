# 14 — Web and Content Filtering Architecture

## 1. Layered strategy

PCA uses several layers because no single classifier is reliable enough.

### Layer 1 — deterministic security lists
- malware;
- phishing;
- scam/fraud domains;
- known malicious destinations.

### Layer 2 — family content categories
- explicit/adult sexual content;
- nudity/sexual imagery;
- child sexual exploitation/grooming risk indicators;
- gambling (parent configurable);
- violence (age/profile configurable);
- social media (parent configurable);
- unknown/new domains (strict-mode option).

Identity or sexual orientation itself is not treated as a harmful-content category. Content restrictions are based on age-appropriateness and explicitness/risk.

### Layer 3 — parent overrides
- explicit allowlist;
- explicit denylist;
- temporary approval.

### Layer 4 — on-device classifier
Only for content PCA can legitimately inspect, such as pages/images rendered in PCA Safe Browser or metadata available to the app. AI is secondary to deterministic controls.

## 2. Android local VPN

A local `VpnService` can enforce domain/DNS controls without sending ordinary browsing history to PCA servers. The design avoids covert HTTPS decryption.

## 3. PCA Safe Browser

Strict Mode can require/encourage a PCA-controlled browser where the product can locally record:
- domain/full URL;
- page title;
- timestamps;
- block reason;
- parent allow/deny decision.

## 4. Unknown/ambiguous content

Default principle: fail according to age/profile policy, show a neutral child message and allow a parent-review request without exposing unsafe media in email/push previews.

## 5. Rule packages

Rule databases are:
- versioned;
- signed;
- integrity checked;
- rollbackable;
- privacy-preserving (no child-specific rule package generated centrally from activity).
