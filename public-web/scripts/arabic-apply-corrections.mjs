/**
 * APPLY VALIDATED ARABIC CORRECTIONS
 *
 * Applies only the reviewer corrections that passed an individual semantic
 * safety check, recorded below as an explicit ledger. There is no bulk
 * CSV-to-source replacement anywhere in this file: every key is named, and
 * every rejection carries its reason.
 *
 * HOW IT WRITES. Not by regenerating the module -- three of the Arabic modules
 * do not round-trip through JSON.stringify, so a regenerate would reformat
 * hundreds of unrelated lines and bury the actual change. Instead each CHANGED
 * LEAF STRING is replaced on its own, in JSON-escaped form, and the replacement
 * must match exactly once in exactly one file. Then the module is re-imported
 * and the resulting structure is compared against the intended structure. A
 * near-miss cannot survive that: either the corpus ends up exactly as intended,
 * or nothing is written.
 *
 * WHAT IT REFUSES TO DO. It never invents Arabic, never partially edits a
 * reviewer's proposal to make it acceptable, and never changes the shape of a
 * value. A proposal is taken whole or rejected whole, because a half-applied
 * proposal is nobody's reviewed text.
 *
 * Usage:  node scripts/arabic-apply-corrections.mjs [--dry-run]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '..');
const DRY = process.argv.includes('--dry-run');

/**
 * REJECTED reviewer proposals, with the reason each was refused.
 *
 * Both rejections are the same failure: a more natural Arabic sentence that
 * says something the approved English does not.
 */
const REJECTED = {
  'home.faq.items': {
    reason:
      'Answer 2 rewrites "arbitrary files" as «أي ملفات أخرى غير لازمة للحماية» — "any other files not necessary for protection". ' +
      'That qualifier implicitly concedes that files which ARE necessary for protection are collected, which the English does not say and ' +
      'which contradicts the locked invariant CHILD_FILES_CENTRAL = 0. The reviewer is right that «الملفات العشوائية» is unnatural, but the ' +
      'fix has to keep the unconditional scope. Routed to the owner sheet for a replacement that does not add the condition.',
    reviewerPointStands: true,
  },
  'video.enroll.title': {
    reason:
      'Broadens the approved English title. EN is "How to Enroll with PCA"; the proposal is «كيفية التسجيل وإعداد الحماية باستخدام PCA» — ' +
      '"How to enroll AND SET UP PROTECTION with PCA". The reviewer\'s observation is sound — the video does cover more than signup — but the ' +
      'remedy is to change the ENGLISH title, which is owner-approved copy and reopens claim review. Making only the Arabic broader would put ' +
      'EN and AR out of parity on a video that does not exist yet. Routed to the owner sheet as a proposed English copy change.',
    reviewerPointStands: true,
  },
};

/**
 * Rows released from the legal-deferred bucket by explicit owner ruling.
 *
 * The owner authorised exactly two, both on the indexable Privacy & Safety page,
 * both classified PRIVACY_ACCURACY_CORRECTION / NOT_A_NEW_LEGAL_COMMITMENT. Every
 * other legal-flagged correction stays deferred behind OD-13.
 */
const OWNER_RELEASED = {
  'privacy.topics.items':
    'Owner ruling: approved as a privacy accuracy correction, not a new legal commitment. The Arabic must preserve READABLE, CENTRAL and the exact scope of the English.',
  'privacy.principles.items':
    'Owner ruling: approved as a privacy accuracy correction, not a new legal commitment. "Protection without surveillance" must not permit non-excessive surveillance.',
};

/**
 * Per-sub-item decisions inside an otherwise accepted proposal.
 *
 * Normally a proposal is taken whole or rejected whole, because a half-applied
 * proposal is nobody's reviewed text. These two rows are the documented
 * exception, and the rule that makes it safe is unchanged: EVERY character that
 * ships is either the reviewer's text, the existing approved text, or a string
 * the owner wrote in the ruling. Nothing here is authored by me.
 *
 *   CURRENT -> keep the text already in the corpus, verbatim
 *   OWNER   -> use the exact wording the owner specified in the ruling
 *
 * The re-derivation the owner asked for is what produced these: the reviewer
 * applied one correct pattern to a place it did not belong.
 */
const SUBITEM_OVERRIDES = {
  'privacy.topics.items': {
    '5.body': {
      source: 'CURRENT',
      reason:
        'The reviewer read items 3 and 5 as the same defect. Only item 3 is. EN item 3 says readable app-usage history must not become "centrally READABLE PCA data", and the Arabic had dropped that second qualifier -- a real drift, and the proposal fixes it. But EN item 5 says readable precise-location history "does not become CENTRAL PCA data", with no second "readable", and the Arabic already matches that exactly. Adding «مقروءة» here as proposed would make the Arabic WEAKER than the English: it would permit precise-location history to be held centrally so long as it were not readable. On a CLM-036 row that is a privacy commitment being quietly loosened, so item 5 keeps its current wording.',
    },
  },
  'privacy.principles.items': {
    '1.title': {
      source: 'OWNER',
      text: 'الحماية دون مراقبة',
      reason:
        'The defect is real: «الحماية دون مراقبة مفرطة» means "protection without EXCESSIVE surveillance", which implies some surveillance is acceptable and weakens the approved principle. But the reviewer\'s replacement «الحماية دون تجسّس» renders "surveillance" as «تجسّس» -- espionage or spying, which is narrower and more loaded than the English. That trades one inexact word for another. The owner specified the exact concept in the ruling: «الحماية دون مراقبة». That is the English principle rendered precisely, and it is the owner\'s own wording, so it is what ships.',
    },
    '2.title': {
      source: 'CURRENT',
      reason:
        '"Privacy by design" is a term of art: privacy built in from the start. The current «الخصوصية من أساس التصميم» ("from the foundation of the design") carries that. The proposed «الخصوصية جزء من التصميم» ("privacy is A PART OF the design") is weaker and more incidental. The body of this item is accepted; only the title is held back.',
    },
  },
};

/**
 * ACCEPTED corrections. Each was checked against the exact English source, the
 * claim register status, the privacy hedge, feature availability, child/family
 * terminology and the legal flag. The note records what the change actually
 * does, so a later reader can re-audit the judgement rather than trust it.
 */
const ACCEPTED = {
  // --- owner-released privacy accuracy corrections (see OWNER_RELEASED) ------
  'privacy.topics.items':
    'Item 3 is the real defect: EN says readable app-usage history must not become "centrally READABLE PCA data", and the Arabic had dropped that second qualifier, so it read as a promise of no central app-usage data at all -- stronger than English. The proposal restores it. Item 1 replaces the literal «الملفات العشوائية» with "other files on the device", which stays unconditional and so does NOT repeat the home.faq.items defect. Item 4 restores "web-safety functions" and plural "decisions". Item 6 replaces «فعّالة» ("effective") with «غير متاحة حاليًا» ("not currently available"), which is what EN "not an active feature today" means -- the current wording could be read as a judgement on the feature\'s efficacy. Item 5 is held back; see SUBITEM_OVERRIDES.',
  'privacy.principles.items':
    'The title of item 1 said "protection without EXCESSIVE surveillance", implying some surveillance is acceptable and weakening the approved principle; the owner-specified wording replaces it. Item 2 body restores "family-side" (the Arabic had listed devices belonging to parents and child). Item 8 disambiguates «حماية يمكن الوصول إليها», which on a site with a separate Accessibility page reads as a11y rather than EN\'s "accessible" in the sense of broad reach. Titles of items 1 and 2 carry overrides; see SUBITEM_OVERRIDES.',

  // --- feature status and release state: the claim-strength cases -----------
  'status.platform':
    'Restores requirement strength. «يعتمد على دعم المنصة» ("depends on") → «يتطلب دعم المنصة» ("requires"), matching EN "Requires platform support". This label renders for nine REQUIRES_PLATFORM_SUPPORT claims, so the weaker Arabic understated the condition on all nine.',
  'status.available': 'Terminology only: «متوفر» → «متاح», the conventional Arabic for an "Available" status. No change in claim strength.',
  'home.availability.items':
    'Current Arabic narrowed EN "Account access is not open yet" to account CREATION only. The proposal restores the full scope. Items 2 and 3 keep COMING_LATER framing.',
  'release.contactNotice': 'Fluency only. "We are not able to receive messages yet" is untouched.',
  'release.journeyNotice': 'Fluency only. "not open for new accounts yet" and "later release" are untouched.',
  'release.reportingPending': 'Fluency only. Reporting channels remain stated as not open.',

  // --- calls to action ------------------------------------------------------
  'accessibility.cta.contact': 'CTA phrasing. Links to /contact/, which states plainly that PCA cannot receive messages yet — same expectation as the English.',
  'cta.access': 'CTA phrasing. "Access options" matches the availability section it opens (Parent web, Child Android, iOS later); no capability is implied that English does not imply.',
  'cta.allFaqs': 'Adds the verb EN has: "View All FAQs" was rendered as a bare section name.',
  'cta.privacyHandling': 'Restores the imperative of EN "See How PCA Handles Privacy"; current Arabic was a question.',
  'privacy.cta.policy': 'Restores the imperative of EN "Read the Detailed Privacy Policy". Target page is unchanged and still a provisional draft.',

  // --- headings and metadata fidelity --------------------------------------
  'home.faq.title': 'EN is "Quick answers". The Arabic said «أسئلة سريعة» — "quick questions". Straight mistranslation.',
  'home.why.title': 'EN is "Built from a parent\'s concern". Arabic specified «أب» (a father), a gender the English does not state. The video transcript keeps «أب» because ITS English says "a father\'s concern" — the two are correctly different.',
  'accessibility.goals.title': 'Arabic had dropped the topic: «أهدافنا» ("our goals") for EN "Our accessibility goals".',
  'accessibility.hero.title': 'Improves fidelity to the hedge: «يجب» ("must") → «ينبغي» ("should"), matching EN "should be usable".',
  'howItWorks.security.title': 'Fluency only.',
  'contact.seo.title': 'Current Arabic dropped EN\'s "Channels Opening Before Launch" and implied channels already exist. The proposal restores it.',
  'howItWorks.seo.title': 'Current Arabic narrowed "Child Protection" to "child DEVICE protection".',
  'howItWorks.seo.description': 'Current Arabic omitted "family requests" from the description entirely.',
  'accessibility.seo.description': 'Fluency and completeness; no accessibility conformance claim is added (CLM-054 stays unasserted).',
  'contact.seo.description': 'Fluency only. "PCA is not able to receive messages yet" is untouched.',
  'privacy.seo.description':
    'Restores two concepts the Arabic had lost: "local-first" (was flattened to "local processing") and "family-side data" (was narrowed to "trusted devices"). "Minimum central technical records" is unchanged. No privacy promise is strengthened.',
  'video.seo.title': 'Register only: «فيديوهات» → «مقاطع فيديو».',

  // --- body copy ------------------------------------------------------------
  'home.protects.items':
    'Three genuine fidelity fixes on a card set carrying eight REQUIRES_PLATFORM_SUPPORT claims: "apply approved web-safety decisions" had become "MAKE web protection decisions"; "whether protections are ACTIVE" had become "whether protection is WORKING" (a stronger assertion); and "RECEIVE relevant protection notices" had become "SEND useful alerts" — wrong direction.',
  'home.different.items': 'Fluency. The readable-central-profile and no-photos/videos/files/messages constraints are unchanged, and item 3 remains a design-intent statement rather than a guarantee.',
  'home.hero.body': 'Preposition only.',
  'home.final.body': 'Fluency only.',
  'home.affordability.body': 'Fluency only; affordability stays an intent, not a price promise.',
  'howItWorks.parent.items': 'Restores EN\'s "just" in "never need to install ... just to use the service"; rest is fluency.',
  'howItWorks.steps.items':
    'Restores "verified" in EN "Depending on VERIFIED platform capabilities", which the Arabic had dropped to "actual capabilities". Step 8 keeps the "should" hedge and drops an extra platform-support qualifier the English does not have, landing on EN parity.',
  'contact.hero.body': 'Removes «فريق PCA» ("the PCA team"), an actor the English does not name.',
  'accessibility.barrier.body': 'Fluency only. Reporting channels remain stated as not open.',
  'accessibility.goals.lead': 'Fluency only.',
  'accessibility.goals.items':
    'Accessibility terminology, and closer to EN: "suitable contrast" → "sufficient contrast" as EN says, and LTR/RTL spelled out in Arabic instead of bare English abbreviations. These are stated design goals, not a conformance claim.',
  'nav.download': 'EN is "Download". Arabic had added "and installation".',
  'footer.group.legal': 'Register only.',
  'footer.group.trust': 'EN is "Trust". Arabic had added "and privacy".',
  'footer.legalNote': 'Current Arabic narrowed EN "availability" to «المزايا» ("features"). The proposal restores the general scope, so nothing described as coming later can read as available.',
  'video.enroll.transcript': 'Step 4: EN says "platform", Arabic said "device type". Android/iOS release states unchanged.',
  'video.intro.transcript': 'Fluency only. Every privacy constraint in steps 6 and 7 is unchanged.',
};

// ---------------------------------------------------------------------------

const problems = [];
const fail = (m) => problems.push(m);

/** Mirrors serialise() in arabic-review-pack.mjs. */
function serialise(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return JSON.stringify(value);
  return value
    .map((item, i) => {
      if (typeof item === 'string') return `[${i + 1}] ${item}`;
      return Object.entries(item)
        .filter(([field]) => field !== 'claimId')
        .map(([field, v]) => `[${i + 1}] ${field}: ${v}`)
        .join('\n');
    })
    .join('\n');
}

/**
 * Turn the reviewer's serialised cell back into the value's own shape.
 *
 * `current` supplies the shape and any claimId, which never appears in the CSV
 * and must therefore be carried across untouched.
 */
function deserialise(text, current) {
  if (typeof current === 'string') return text;
  if (!Array.isArray(current)) throw new Error('unsupported shape');

  const entries = new Map();
  let last = null;
  for (const line of text.split('\n')) {
    const m = /^\[(\d+)\]\s([\s\S]*)$/.exec(line);
    if (m) {
      const index = Number(m[1]) - 1;
      const rest = m[2];
      const fieldMatch = /^([a-zA-Z][\w]*):\s([\s\S]*)$/.exec(rest);
      if (typeof current[index] === 'object' && fieldMatch) {
        if (!entries.has(index)) entries.set(index, {});
        entries.get(index)[fieldMatch[1]] = fieldMatch[2];
        last = { index, field: fieldMatch[1] };
      } else {
        entries.set(index, rest);
        last = { index, field: null };
      }
    } else if (last) {
      // A leaf that legitimately contains a newline.
      if (last.field) entries.get(last.index)[last.field] += '\n' + line;
      else entries.set(last.index, entries.get(last.index) + '\n' + line);
    } else {
      throw new Error('cannot parse serialised value');
    }
  }

  return current.map((item, i) => {
    const parsed = entries.get(i);
    if (parsed === undefined) throw new Error(`item ${i + 1} missing from the proposal`);
    if (typeof item === 'string') {
      if (typeof parsed !== 'string') throw new Error(`item ${i + 1} changed shape`);
      return parsed;
    }
    const out = {};
    for (const [field, value] of Object.entries(item)) {
      if (field === 'claimId') { out.claimId = value; continue; }
      if (!(field in parsed)) throw new Error(`item ${i + 1} is missing field "${field}"`);
      out[field] = parsed[field];
    }
    for (const field of Object.keys(parsed)) {
      if (!(field in item)) throw new Error(`item ${i + 1} adds unknown field "${field}"`);
    }
    return out;
  });
}

/** Every leaf string in a value, as (path, text). */
function leaves(value, path = []) {
  if (typeof value === 'string') return [{ path, text: value }];
  if (!Array.isArray(value)) return [];
  const out = [];
  value.forEach((item, i) => {
    if (typeof item === 'string') out.push({ path: [...path, i], text: item });
    else for (const [field, v] of Object.entries(item)) {
      if (field !== 'claimId' && typeof v === 'string') out.push({ path: [...path, i, field], text: v });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------

const intake = JSON.parse(await readFile(join(ROOT, 'reports/arabic-review-intake.json'), 'utf8'));
const applicable = new Map(intake.applicable.map((r) => [r.key, r]));

/**
 * Pull the owner-released rows out of the deferred set. They carry the same
 * fields as an eligible row, read from the reviewer's own 189-row export, so
 * they go through exactly the same checks as everything else -- shape,
 * re-serialisation, leaf count, single-occurrence replacement, post-condition.
 * Being owner-authorised changes which bucket a row is in, not how carefully it
 * is applied.
 */
for (const key of Object.keys(OWNER_RELEASED)) {
  const row = (intake.legalDeferredRows ?? []).find((r) => r.key === key) ?? intake.applicable.find((r) => r.key === key);
  if (!row) {
    fail(`owner released "${key}" but the intake carries no reviewed row for it.`);
    continue;
  }
  applicable.set(key, row);
}
if (problems.length) {
  console.error('\nOWNER-RELEASED ROWS NOT FOUND:\n');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

// The ledger must cover the eligible set exactly -- no key silently ignored.
for (const key of applicable.keys()) {
  if (!(key in ACCEPTED) && !(key in REJECTED)) fail(`"${key}" is eligible but the ledger records no decision for it.`);
}
for (const key of [...Object.keys(ACCEPTED), ...Object.keys(REJECTED)]) {
  if (!applicable.has(key)) fail(`the ledger decides "${key}", which is not in the eligible set.`);
}
for (const key of Object.keys(SUBITEM_OVERRIDES)) {
  if (!(key in ACCEPTED)) fail(`"${key}" has sub-item overrides but is not an accepted correction.`);
}
if (problems.length) {
  console.error('\nLEDGER INCOMPLETE:\n');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

const { PAGE_CONTENT } = await import('../src/content/index.mjs');
const fileFor = new Map();
for (const [tableId, tables] of Object.entries(PAGE_CONTENT)) {
  for (const key of Object.keys(tables.ar)) fileFor.set(key, `src/content/pages/${tableId}.ar.mjs`);
}

const edits = [];
const applied = [];
const alreadyApplied = [];
const overridesApplied = [];

/** Parse the reviewer's "before" cell back into the value's shape, or record why not. */
function deserialiseSafe(key, text, shape) {
  try {
    const parsed = deserialise(text, shape);
    if (serialise(parsed) !== text) {
      fail(`"${key}": the reviewed "before" text does not re-serialise cleanly.`);
      return null;
    }
    return parsed;
  } catch (err) {
    fail(`"${key}": the reviewed "before" text could not be parsed — ${err.message}`);
    return null;
  }
}

for (const key of Object.keys(ACCEPTED)) {
  const row = applicable.get(key);
  const { CONTENT } = await import('../src/content/index.mjs');
  const current = CONTENT.ar[key];

  const reviewedBase = deserialiseSafe(key, row.currentArabic, current);
  if (!reviewedBase) continue;

  let target;
  try {
    target = deserialise(row.proposedArabic, reviewedBase);
  } catch (err) {
    fail(`"${key}": the proposal could not be read back into the value's shape — ${err.message}`);
    continue;
  }

  if (serialise(target) !== row.proposedArabic) {
    fail(`"${key}": the parsed proposal does not re-serialise to the reviewer's text.`);
    continue;
  }

  // Documented per-sub-item decisions, applied to the parsed proposal.
  const overrides = SUBITEM_OVERRIDES[key] ?? {};
  for (const [path, rule] of Object.entries(overrides)) {
    const [indexText, field] = path.split('.');
    const index = Number(indexText) - 1;
    if (!Array.isArray(target) || !target[index] || typeof target[index] !== 'object' || !(field in target[index])) {
      fail(`"${key}": sub-item override "${path}" does not address a field that exists.`);
      continue;
    }
    if (rule.source === 'CURRENT') {
      // Verbatim from the corpus as the reviewer saw it -- already approved text.
      target[index][field] = reviewedBase[index][field];
    } else if (rule.source === 'OWNER') {
      target[index][field] = rule.text;
    } else {
      fail(`"${key}": sub-item override "${path}" has an unknown source.`);
    }
    overridesApplied.push({ key, path, source: rule.source, reason: rule.reason });
  }

  /**
   * Idempotence. HEAD already carries the first 40 corrections, so re-running
   * must be able to tell "already applied" from "stale". Three outcomes:
   *   corpus == target        -> already applied, skip
   *   corpus == reviewed base -> apply
   *   neither                 -> stale, refuse
   * Without this the guard reads a correctly-remediated corpus as drift and
   * refuses to do anything, which is how a re-run gets dismissed as broken.
   */
  if (JSON.stringify(current) === JSON.stringify(target)) {
    // Already in the corpus, from an earlier run. The ledger describes the state
    // of the corpus, not the work of one invocation, so it is recorded as
    // applied -- otherwise a second run would silently drop 40 rows from the
    // ledger and from the owner sign-off sheet built on top of it.
    alreadyApplied.push(key);
    applied.push({
      key,
      file: fileFor.get(key) ?? 'src/content/global.ar.mjs',
      leavesChanged: 0,
      appliedInThisRun: false,
      decision: row.decision,
      claimId: row.claimId,
      beforeArabic: row.currentArabic,
      afterArabic: serialise(target),
      ownerReleased: key in OWNER_RELEASED ? OWNER_RELEASED[key] : undefined,
    });
    continue;
  }
  if (serialise(current) !== row.currentArabic) {
    fail(`"${key}": the corpus matches neither the reviewed Arabic nor the intended result.`);
    continue;
  }

  const before = leaves(current);
  const after = leaves(target);
  if (before.length !== after.length) {
    fail(`"${key}": the proposal has ${after.length} leaf string(s), the corpus has ${before.length}.`);
    continue;
  }

  const changed = before
    .map((b, i) => ({ old: b.text, next: after[i].text, path: b.path }))
    .filter((c) => c.old !== c.next);

  if (!changed.length) {
    fail(`"${key}": accepted but nothing actually differs.`);
    continue;
  }

  const file = fileFor.get(key) ?? 'src/content/global.ar.mjs';
  edits.push({ key, file, changed, target });
  applied.push({
    key,
    file,
    leavesChanged: changed.length,
    appliedInThisRun: true,
    decision: row.decision,
    claimId: row.claimId,
    // Recorded so the intake validator can tell "already applied" from "stale"
    // on a later run, instead of reporting its own successful output as drift.
    beforeArabic: row.currentArabic,
    afterArabic: serialise(target),
    ownerReleased: key in OWNER_RELEASED ? OWNER_RELEASED[key] : undefined,
  });
}

if (problems.length) {
  console.error('\nPRE-FLIGHT FAILED:\n');
  for (const p of problems) console.error('  ' + p);
  console.error('\nNothing was written.\n');
  process.exit(1);
}

// --- write ------------------------------------------------------------------
const byFile = new Map();
for (const e of edits) {
  if (!byFile.has(e.file)) byFile.set(e.file, []);
  byFile.get(e.file).push(e);
}

for (const [file, fileEdits] of byFile) {
  const path = join(ROOT, file);
  let source = await readFile(path, 'utf8');
  for (const e of fileEdits) {
    for (const c of e.changed) {
      const needle = JSON.stringify(c.old);
      const count = source.split(needle).length - 1;
      if (count !== 1) {
        fail(`"${e.key}": the string to replace occurs ${count} time(s) in ${file}; expected exactly 1.`);
        continue;
      }
      source = source.replace(needle, JSON.stringify(c.next));
    }
  }
  if (!problems.length && !DRY) await writeFile(path, source, 'utf8');
}

if (problems.length) {
  console.error('\nWRITE ABORTED:\n');
  for (const p of problems) console.error('  ' + p);
  console.error('\nRun `git checkout -- public-web/src/content` if any file was partially written.\n');
  process.exit(1);
}

// --- post-condition: the corpus must now equal the intended structure --------
if (!DRY) {
  /**
   * In a CHILD PROCESS, deliberately.
   *
   * The obvious `import('../src/content/index.mjs?verify=' + Date.now())` does
   * not work and is worse than useless: the query busts the cache for index.mjs
   * only, while the page modules it imports stay cached at their PRE-EDIT
   * values. The first run of this script reported all 40 keys as mismatched
   * immediately after writing all 40 correctly. A verification step that fails
   * on correct output would, on the next run, be assumed broken and ignored --
   * which is exactly when it would have a real failure to report.
   */
  const { execFileSync } = await import('node:child_process');
  const script =
    "const {CONTENT}=await import(process.argv[1]);" +
    "process.stdout.write(JSON.stringify(CONTENT.ar));";
  const arNow = JSON.parse(
    execFileSync(
      process.execPath,
      // pathToFileURL, not the bare path: on Windows a `D:\...` argument makes
      // import() throw ERR_UNSUPPORTED_ESM_URL_SCHEME.
      ['--input-type=module', '-e', script, pathToFileURL(join(ROOT, 'src/content/index.mjs')).href],
      { encoding: 'utf8' }
    )
  );
  for (const e of edits) {
    if (JSON.stringify(arNow[e.key]) !== JSON.stringify(e.target)) {
      fail(`"${e.key}": after writing, the corpus does not match the intended value.`);
    }
  }
  const keyCount = Object.keys(arNow).length;
  if (keyCount !== 189) fail(`the Arabic corpus now has ${keyCount} keys; corrections must never change the key count.`);
  if (problems.length) {
    console.error('\nPOST-CONDITION FAILED:\n');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
}

// --- ledger -----------------------------------------------------------------
const ledger = {
  reviewerPackage: intake.reviewerPackage,
  eligible: intake.applicable.length,
  applied: applied
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((a) => ({ ...a, note: ACCEPTED[a.key] })),
  alreadyApplied,
  subItemOverrides: overridesApplied,
  ownerReleasedFromLegalDeferral: Object.entries(OWNER_RELEASED).map(([key, reason]) => ({ key, reason })),
  rejected: Object.entries(REJECTED).map(([key, r]) => ({
    key,
    decision: applicable.get(key).decision,
    reviewerProposal: applicable.get(key).proposedArabic,
    rejectedReason: r.reason,
    finalArabicDecision: 'UNCHANGED — current Arabic retained; routed to the owner sign-off sheet.',
  })),
  deferredLegal: intake.legalDeferred.filter((d) => !(d.key in OWNER_RELEASED)),
};
await mkdir(join(ROOT, 'reports'), { recursive: true });
await writeFile(join(ROOT, 'reports/arabic-corrections-ledger.json'), JSON.stringify(ledger, null, 2), 'utf8');

console.log(DRY ? 'DRY RUN — nothing written' : 'ARABIC CORRECTIONS APPLIED');
console.log(`  eligible (non-legal)               ${intake.applicable.length}`);
console.log(`  ARABIC_CORRECTIONS_APPLIED         ${applied.length}`);
console.log(`      newly applied this run         ${applied.length - alreadyApplied.length}`);
console.log(`      already applied (unchanged)    ${alreadyApplied.length}`);
console.log(`  owner-released from legal deferral ${Object.keys(OWNER_RELEASED).length}`);
console.log(`  documented sub-item overrides      ${overridesApplied.length}`);
for (const o of overridesApplied) console.log(`      ${o.key} [${o.path}] -> ${o.source}`);
console.log(`  ARABIC_CORRECTIONS_REJECTED        ${Object.keys(REJECTED).length}`);
console.log(`  ARABIC_CORRECTIONS_DEFERRED_LEGAL  ${intake.legalDeferred.filter((d) => !(d.key in OWNER_RELEASED)).length}`);
console.log(`  leaf strings changed this run      ${edits.reduce((n, e) => n + e.changed.length, 0)}`);
console.log(`  files touched                      ${byFile.size}`);
for (const [file, e] of byFile) console.log(`      ${file}  (${e.length} key(s))`);
console.log('\nledger: reports/arabic-corrections-ledger.json');
