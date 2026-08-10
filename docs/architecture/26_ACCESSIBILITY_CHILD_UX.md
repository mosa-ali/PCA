# 26 — Accessibility, Child UX and Transparency

## 1. Design contract

PCA must be understandable by a child without reducing safety, dignity, privacy, or emergency access. It explains a parent rule, an unavailable platform capability, a technical fault, and an urgent safety action as different states. It does not use shame, dark patterns, artificial urgency, deceptive system styling, or a “secret monitoring” experience.

The parent and each child select language independently. A parent changing language never changes the child’s language or disclosure acknowledgement. English and Arabic are complete supported product languages, not merely translated store text.

## 2. Required child journeys

The child application supplies accessible routes for Today/remaining time, break and return-to-use, eye-protection explanation, prayer/Dhikr (optional family content), request-more-time, protection/capability status, what a parent can see, privacy/data, errors, permission changes, and emergency help. Every route has a plain-language heading, keyboard/screen-reader focus order, language-correct accessible name, and a return path that does not depend on a swipe direction or color.

The protection-status screen names each applicable category as **Active**, **Limited**, **Unavailable**, or **Needs attention**, gives the non-sensitive reason, and avoids a false global “Protected” claim. It must say, for example, that web protection is temporarily unavailable when the VPN/authorization is inactive, and it links to a safe remediation/help explanation. It never reveals a parent secret, policy-rule detail that would assist bypass, or another family member’s data.

## 3. Interaction and sensory accessibility

- Controls have programmatic name, role, value/state, and actionable hint; decorative graphics are hidden from assistive technology.
- All essential flows work with screen reader, switch/keyboard navigation where the OS provides it, touch accommodations, large text/Dynamic Type/font scaling, and display zoom without clipping, overlap, loss of controls, or horizontal-only critical scrolling.
- Color, vibration, animation, sound, and camera/proximity signals are never the sole carrier of a limit, warning, or success state. Text/icon alternatives are supplied.
- Contrast, focus indication, target size/spacing, error identification, and readable plain language are reviewed against the current platform accessibility guidance and the project’s applicable accessibility target.
- Animation honors reduced-motion settings; flashing/rapid effects are avoided. Sound and haptic notices honor system preferences and have visual/screen-reader equivalents.
- Forms announce error summaries and field-specific corrections; permission denial and capability loss use actionable, non-blaming explanations.

## 4. Break, emergency and wellbeing experiences

A break screen explains remaining time and the next allowed action in a calm tone. Continuous-use and break calculations come from document 12; the UI does not invent a different timer. Optional Dhikr/reflection can be skipped and never becomes a prerequisite for emergency use, an accessibility action, or a parent contact route. Prayer names, transliteration/meaning where provided, and schedule notices remain readable in the child’s selected language.

Emergency action is permanently reachable from break, blocked, error, enrollment, offline, and degraded screens. It is not disabled by parent policy, subscription, RTL layout, a network error, or assistive technology. The flow should use the OS’s available emergency mechanism and disclose any platform limitation rather than simulate emergency service.

## 5. Transparency and request-more-time

“What parents can see” uses category-level explanations aligned with the canonical inventory in document 10: it separates a domain/category from a full URL, a location state from a precise coordinate, and a policy event from message/content surveillance. It explicitly states that PCA does not store camera frames or facial identity as family monitoring history. The page identifies provider-visible delivery/infrastructure metadata in child-appropriate terms without implying access to family plaintext.

Request-more-time includes the requested amount/reason, confirmation, pending/approved/declined/expired state, and parent response. It does not promise delivery while offline or leak a parent’s availability. Bonus and emergency override semantics are those in document 12.

## 6. Bilingual and RTL resilience

Arabic uses true RTL layout rather than text alignment alone. Directional navigation, back/forward chevrons, progress/timeline direction, charts, tables, toast placement, badges, and gesture alternatives mirror when appropriate; non-directional symbols (brand, phone, play, mathematical signs) retain their intended semantics. Bidirectional isolation is used for mixed Arabic/English text such as domain names, email addresses, one-time codes, version values, times, Latin app names, and URLs so surrounding Arabic order is not corrupted.

Dates/times, numbers, durations, prayer times, time zones, and calendar labels use locale-aware formatting while retaining unambiguous information where safety requires it. Parent reports, child transparency copy, errors, permission prompts, notifications, emails, break UI, and accessibility labels are tested in both English and Arabic, including expanded text and mixed-direction values. A chart or timeline has an accessible tabular/text equivalent.

## 7. Acceptance evidence

Document 28 requires device-assisted testing with VoiceOver/TalkBack (or current platform equivalent), large text, contrast/reduced-motion modes, English/Arabic/RTL/mixed-bidi samples, offline and permission-revoked paths, and emergency reachability. A release is blocked if a child cannot discover a protection state, understand a material restriction, use an essential control, or reach emergency help with supported accessibility settings.
