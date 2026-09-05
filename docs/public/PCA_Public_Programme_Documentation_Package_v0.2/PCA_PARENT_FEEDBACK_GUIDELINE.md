# PCA Parent Feedback Guideline

**Status:** First substantive feature/UX draft  
**Implementation:** NOT AUTHORIZED  
**V1 recommendation:** No screenshot attachment.

## 1. Purpose

Help & Feedback gives parents a clear, privacy-safe way to tell PCA what works, report problems, suggest improvements and provide an internal rating. It must not become a hidden diagnostics pipeline or a new route for collecting child-sensitive information.

## 2. Feature structure

Authenticated Parent area: **Help & Feedback**

Actions:
1. Provide Feedback
2. Report a Problem
3. Suggest a Feature
4. Rate PCA

Public `/contact` remains separate for general/public inquiries.

## 3. Shared privacy rule

Every feedback surface must communicate:

**EN:** “Please do not include private information about your child.”  
**AR:** “يرجى عدم تضمين معلومات خاصة عن طفلك.”  
**Arabic status:** `NATIVE_REVIEW_REQUIRED`

PCA must not automatically attach child activity, browsing history, location, messages, screenshots, files or other readable child content.

## 4. Provide Feedback — UX

### Entry
Parent selects **Provide Feedback** from Help & Feedback.

### Dialog/page fields
- Category — required
- Rating — optional when relevant
- Message — required
- “May we contact you about this feedback?” — optional permission

### Categories
- General feedback
- Usability
- Protection feature
- Performance
- Translation
- Privacy
- Other

### Recommended field limits
Use reasonable limits to prevent abuse without forcing unnaturally short feedback. Final values should be implementation-configurable; recommended starting point is 20–2,000 characters for message text.

### Confirmation
**EN:** “Thank you. Your feedback has been received.”  
**AR:** “شكرًا لك. تم استلام ملاحظاتك.” (`NATIVE_REVIEW_REQUIRED`)

## 5. Report a Problem — UX

Fields:
- Problem area — required
- What happened? — required
- What were you trying to do? — optional but recommended
- Device/platform category — optional structured selection
- Browser/app version — only if safely available and justified
- Contact permission — optional

Recommended problem areas:
- Sign in/account
- Child/device connection
- Protection settings
- Browser/web protection
- App controls
- Screen time/schedules
- Parent PWA/install
- Language/translation
- Performance
- Other

### Diagnostic principle
Do not automatically send:
- child name beyond an opaque internal case reference if absolutely needed;
- URLs visited;
- readable app-usage history;
- precise location;
- messages;
- screenshots;
- arbitrary files;
- encryption keys/tokens;
- raw database payloads.

If minimal technical metadata is later approved, the UI must disclose what will be included before submission.

## 6. Suggest a Feature

Fields:
- Feature area — optional
- Suggestion — required
- Why would this help? — optional
- Contact permission — optional

Confirmation:
> Thanks for the idea. Suggestions help us understand what families need, but submitting a suggestion does not guarantee a feature will be added.

This prevents accidental product promises.

## 7. Rate PCA

Internal rating:
- 1–5 stars;
- optional comment;
- optional contact permission.

Do not link rating automatically to public app-store reviews until store apps exist and relevant platform review policies are assessed.

Avoid dark patterns such as showing external review prompts only to positive raters while suppressing negative feedback.

## 8. Contact permission

Suggested wording:

**EN:** “PCA may contact me about this message.”  
**AR:** “يمكن لـ PCA التواصل معي بخصوص هذه الرسالة.” (`NATIVE_REVIEW_REQUIRED`)

Permission should be unchecked by default unless legal/product review approves another pattern. Feedback submission must not depend on granting contact permission.

## 9. Submission privacy notice

Before the submit button:

**EN:**
> Please describe the issue without sharing private information about your child. PCA does not need photos, messages, browsing history, precise location or other sensitive child content to receive your feedback.

**AR:**
> يرجى وصف المشكلة دون مشاركة معلومات خاصة عن طفلك. لا تحتاج PCA إلى صور الطفل أو رسائله أو سجل التصفح أو موقعه الدقيق أو أي محتوى حساس آخر لاستلام ملاحظاتك.

**Arabic status:** `NATIVE_REVIEW_REQUIRED`

## 10. Screenshot/file attachments

**OWNER_APPROVED — OD-10: NO screenshot or file attachments in V1.**

Reasoning:
- screenshots can contain child names, messages, browsing details, location or account secrets;
- file uploads increase privacy, storage, abuse and malware-handling requirements;
- most V1 feedback can be handled through structured text and safe metadata.

If attachments are later approved:
- explicit parent selection only;
- no background gallery access;
- clear file-size/type limits;
- pre-submit privacy warning;
- malware scanning strategy;
- short retention;
- access controls;
- deletion path;
- no attachment by default.

## 11. Error states

### Network/submission error
> We couldn't submit your message. Your text is still here—please try again.

### Validation error
> Please complete the highlighted fields.

### Rate limit/abuse protection
Use neutral wording such as:
> We couldn't accept another submission right now. Please try again later.

Do not reveal internal anti-abuse thresholds.

## 12. Confirmation and case reference

For Report a Problem, a short case/reference ID may be shown if the backend supports it safely.

Do not expose internal database IDs that reveal system structure.

## 13. Retention recommendation

**OWNER_APPROVAL_PENDING — OD-11. Revised privacy-minimizing recommendation:**
- retain identifiable feedback/support records while the case is open;
- after closure, retain identifiable content for **up to 90 days** to support reasonable follow-up/reopening and quality review;
- then delete or de-identify the content unless a documented legal/security reason requires longer retention;
- security incident records may follow a separate approved security-retention policy;
- aggregate product metrics must not retain readable child-sensitive content.

**Why 90 days:** it is materially shorter than the v0.1 180-day suggestion while still allowing a practical post-closure support window. This is a recommended operational default, not a final legal retention rule.

Final retention must be documented in the privacy policy and backend implementation.

## 14. Support workflow recommendation

V1 workflow:
1. Receive submission in a controlled support queue.
2. Classify category/severity.
3. Route privacy/security reports to designated restricted handling.
4. Respond only where contact permission or support necessity permits.
5. Resolve/close.
6. Apply retention/deletion policy.

Avoid forwarding full feedback indiscriminately to broad email lists.

## 15. Feedback history

**Recommended V1 default:** Do not expose a full historical feedback archive in Parent until the support lifecycle, access controls and retention model are mature.

For problem reports, optionally show a small “Your open support requests” view only if backed by secure case ownership and minimal data. Otherwise confirmation/reference is enough.

**Status:** OWNER_APPROVAL_PENDING.

## 16. Anonymous feedback

**Recommended V1 default:** Authenticated Parent feedback is linked to the parent account for abuse control and response routing, but does not require child identity. Public anonymous feedback should not be enabled initially.

Public Contact may accept inquiries with an email/reply path according to its own anti-abuse/privacy design.

**Status:** OWNER_APPROVAL_PENDING.

## 17. Translation feedback

Because PCA is bilingual, “Translation” is a first-class category. The report should capture:
- language selected;
- page/feature name chosen by the user;
- message.

Do not automatically capture surrounding screen content.

## 18. Privacy/security reports

“Privacy” feedback remains available, but serious security concerns should route to a dedicated security-contact path rather than a general rating flow.

The public Contact page may include **Report security concern**. Do not publish internal operator addresses unless approved.

## 19. Accessibility

Feedback dialogs/forms must support:
- keyboard operation;
- focus management;
- screen-reader field names and errors;
- 44px touch targets where practical;
- no color-only rating selection;
- RTL layout;
- preserved draft text after recoverable errors.

Star rating must have an accessible alternative such as radio buttons with labels “1 out of 5” through “5 out of 5.”

## 20. Analytics

Do not introduce third-party feedback analytics or session replay without separate privacy approval. Session replay is especially sensitive and must not be assumed acceptable for Parent surfaces.

Safe aggregate metrics may include counts by category/status after privacy review, without readable child activity.

## 21. Abuse controls

The feature may use reasonable rate limiting, authenticated ownership and spam filtering. Anti-abuse logs must remain minimal and covered by the operational metadata policy.

## 22. Acceptance criteria

The feature is not accepted until:
1. all four actions work;
2. no automatic sensitive attachment exists;
3. EN/AR warnings are visible;
4. contact permission is optional;
5. error states preserve user work where safe;
6. accessibility checks pass;
7. retention and support handling are documented;
8. privacy/security categories are safely routed;
9. claim register is updated;
10. V1 attachment behavior remains OFF unless separately approved.
