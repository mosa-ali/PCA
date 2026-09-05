# PCA Public Design Guideline

**Status:** First visual/UX standard draft  
**Implementation:** NOT AUTHORIZED  
**Principle:** light, calm, human, accessible, family-friendly and privacy-first.

## 1. Design philosophy

PCA should visually communicate care and competence without looking childish, corporate or threatening. Parents should feel that the product is serious about child protection but does not exploit fear.

The visual system should favor clarity, generous spacing, readable typography, friendly shapes, restrained illustration and calm interactive feedback.

## 2. Default theme

The public site and auth shell use a light-default design. Dark mode may be considered later as an optional preference, but it is not the brand default.

### Explicitly prohibited default directions
- dark cyberpunk interfaces;
- hacker masks/hoods;
- surveillance cameras as decorative motifs;
- red-alert dashboards as the main visual language;
- code-rain/security-operations imagery;
- children portrayed as helpless victims;
- “spy app” aesthetics.

## 3. Provisional color system

**OWNER_APPROVAL_PENDING — visual identity.** Recommended first implementation direction:

- Primary action: calm medium blue family;
- Trust/privacy accent: teal/green family;
- Warm neutral accent: soft sand/cream;
- Main text: deep slate/near-black;
- Secondary text: medium slate;
- Background: white and very light neutral surfaces;
- Success/warning/error: conventional semantic colors with accessible contrast.

If fixed tokens are needed during prototyping, the design agent may propose accessible values, but final brand colors require owner approval. Contrast must meet WCAG AA minimums for normal text and controls.

## 4. Typography

Use a modern sans-serif family with strong Arabic and Latin support or a carefully paired EN/AR system that produces equivalent weight, hierarchy and readability.

Guidelines:
- body text generally 16–18px equivalent on public pages;
- comfortable line-height around 1.5–1.7;
- avoid overly thin font weights;
- headings should be bold enough for hierarchy without feeling corporate-heavy;
- maximum readable text measure around 65–75 characters for long paragraphs;
- Arabic line-height may require additional vertical space;
- avoid uppercase-only navigation because it does not translate naturally to Arabic.

## 5. Spacing and layout rhythm

Use a consistent 4px/8px-based spacing scale. Sections should breathe; avoid dense dashboard spacing on public pages.

Recommended rhythm:
- compact control gaps: 8–12px;
- card internal padding: 20–28px depending on viewport;
- component group spacing: 24–40px;
- major section spacing: 64–112px desktop, 48–72px mobile;
- never rely on whitespace alone to communicate semantic grouping when borders/headings are needed.

## 6. Page width

Recommended responsive container:
- content max width approximately 1180–1280px;
- long-form text narrower, approximately 720–820px;
- full-bleed background sections may span viewport while inner content remains bounded.

Avoid very long full-width paragraphs on wide screens.

## 7. Header — desktop

Components:
- PCA logo/home link;
- primary navigation;
- EN / العربية switcher;
- Login text/button;
- prominent Get Started button.

Behavior:
- clear focus states;
- sticky header may be used if it does not consume excessive vertical space;
- no hidden essential links behind hover-only interactions;
- current page state communicated visually and semantically.

## 8. Header — mobile

Components:
- logo;
- visible language action;
- accessible menu button with text alternative.

Mobile menu:
- full-height sheet/drawer or clearly bounded dropdown;
- focus trapping if modal;
- Escape closes where applicable;
- no tiny nested menus;
- Login and Get Started visible at the end of the menu.

## 9. Footer

Use grouped navigation:
- PCA;
- Trust;
- Help;
- Legal.

Footer should also contain:
- language switching if appropriate;
- concise copyright/legal entity area once supplied;
- privacy and accessibility links;
- no unsupported badges, certifications or store logos.

## 10. CTA hierarchy

### Primary
Solid high-contrast button for the single main action per section.

### Secondary
Outlined or softer button for exploration.

### Tertiary
Text link with visible hover/focus treatment.

Rules:
- do not show three visually equal primary buttons in one section;
- use action verbs;
- touch targets minimum 44×44 CSS pixels where practical;
- disabled states must remain legible and explain why when necessary.

## 11. Cards

Use cards for feature summaries, principles, FAQ previews and steps. Cards should have:
- short headline;
- one clear purpose;
- optional simple icon;
- short body copy;
- link only when deeper content exists.

Avoid decorative card overload. Large public pages should not resemble an analytics dashboard.

## 12. Icons

Use a coherent, simple icon family. Icons supplement labels; they do not replace text for key actions.

Avoid icons that imply spying, hidden monitoring or recording. Privacy icons should emphasize control, encryption, trusted devices and local processing rather than CCTV imagery.

RTL review must confirm directional icons (arrows, chevrons, progress direction) mirror appropriately while non-directional symbols remain unchanged.

## 13. Illustrations and imagery

Preferred themes:
- parent and child discussing devices;
- balanced device use;
- calm home/school contexts;
- simplified device interactions;
- protective boundaries visualized abstractly;
- friendly product UI illustrations.

Avoid:
- distressed children used to trigger fear;
- hidden cameras;
- message spying;
- hacker imagery;
- screenshots suggesting unavailable features;
- stock imagery that implies surveillance.

Images of real children require appropriate rights/consent and child-safeguarding review. Illustration is preferable for the first public version when permissions are uncertain.

## 14. Forms

Form standards:
- persistent labels above fields;
- optional/required status clear;
- helpful examples only where needed;
- inline validation near the field;
- errors summarized for long forms when appropriate;
- no color-only error communication;
- password requirements clear before failure;
- password manager and autofill compatibility;
- avoid unnecessary data fields.

## 15. Auth pages

Auth should feel like PCA, but task completion is primary.

Recommended desktop pattern:
- centered or split layout;
- one concise brand/purpose panel at most;
- auth form kept narrow and focused;
- visible language switcher;
- privacy reassurance below or beside the form;
- Terms/Privacy links accessible.

Mobile:
- form first;
- no oversized marketing art above the login controls.

## 16. Feedback dialogs

Dialogs should:
- have clear title and short privacy warning;
- use one-column forms on mobile;
- preserve typed text if a recoverable submission error occurs;
- provide explicit success confirmation;
- never auto-attach sensitive diagnostics;
- support keyboard focus management and screen readers.

## 17. Alerts and notices

Use semantic alert types:
- information;
- success;
- warning;
- error.

Avoid alarming language for routine states. Critical security warnings may be more prominent but should explain the required action clearly.

## 18. Privacy and security sections

Trust sections should use plain-language summaries first, then optional deeper explanation.

Recommended visual pattern:
1. simple promise;
2. “what happens where” diagram or cards;
3. detailed expandable explanations;
4. links to full policy/security page.

Never use a padlock icon as proof of security. The copy and evidence carry the claim.

## 19. Installation prompt

Owner-approved content:

**Welcome to PCA Parent**

“For the best experience, install PCA Parent on this device.”

Benefits:
- Quick access
- App-like experience
- Designed for phone, tablet and computer

Actions:
- **Install PCA Parent**
- **Continue in Browser**

Design requirements:
- optional, not blocking;
- dismissible;
- no fake OS-style dialogs;
- platform guidance appears only when relevant;
- separate explanation from Trusted Browser security.

## 20. FAQ

Use accessible accordion only if implementation preserves:
- native button semantics;
- keyboard operation;
- clear expanded/collapsed state;
- no essential content hidden from search/indexing because of client-only rendering.

Long FAQ answers may link to dedicated pages.

## 21. Responsive requirements

Mandatory test widths:
- 320px;
- 375px;
- 390px;
- tablet portrait/landscape;
- desktop;
- wide desktop.

### 320px rules
- no horizontal scrolling from content;
- buttons may stack;
- no two-column forms;
- navigation remains usable;
- modal/dialog fits viewport and can scroll internally.

### Tablet
- use one/two-column transitions thoughtfully;
- do not simply scale desktop components down.

### Wide desktop
- maintain bounded text widths;
- avoid excessive empty stretches by using balanced grid/container sizing.

## 22. Arabic RTL

Arabic is a full layout mode.

Requirements:
- document direction RTL;
- text alignment appropriate to language;
- navigation order and horizontal groups reviewed, not mechanically reversed when task logic should remain consistent;
- icons with direction mirror when meaningful;
- form labels and validation align naturally;
- numbers, email addresses and URLs remain readable using bidi-safe patterns;
- English product name “PCA” may remain Latin where appropriate;
- do not shrink Arabic typography to force English-sized layouts.

## 23. Accessibility

Minimum requirements:
- semantic HTML structure;
- one logical H1 per page;
- heading levels not skipped for visual styling;
- keyboard navigation everywhere;
- visible focus ring with adequate contrast;
- descriptive link/button names;
- form labels programmatically associated;
- status changes announced where needed;
- meaningful alternative text;
- decorative images hidden from assistive technology;
- reduced-motion preference respected;
- zoom to 200% without loss of essential function;
- accessible error states;
- logical tab order;
- no keyboard trap except intentional accessible modal focus management.

## 24. Motion

Motion should be subtle and purposeful. Avoid auto-playing complex animation, parallax or attention-demanding effects.

When `prefers-reduced-motion` is active, remove or minimize non-essential transitions and animation.

## 25. Empty states

Empty states should explain:
1. what is absent;
2. whether this is expected;
3. what the user can do next.

Never use child-sensitive example data in screenshots or empty-state demonstrations.

## 26. Error states

Error copy should be calm, specific and recoverable.

Examples:
- “We couldn't submit your feedback. Your message is still here—please try again.”
- “This link is no longer valid. Request a new password reset link.”

Avoid blaming the user or exposing internal error details.

## 27. Design release gate

The design system is not accepted merely because screenshots look polished. PUBLIC-5/12/13 acceptance requires:
- responsive browser evidence;
- EN/AR parity;
- keyboard validation;
- focus-state review;
- contrast checks;
- reduced-motion review;
- no unsupported feature imagery;
- no overlap with Platform Admin visual/security realm.
