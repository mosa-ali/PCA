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
 * ACCEPTED corrections. Each was checked against the exact English source, the
 * claim register status, the privacy hedge, feature availability, child/family
 * terminology and the legal flag. The note records what the change actually
 * does, so a later reader can re-audit the judgement rather than trust it.
 */
const ACCEPTED = {
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

// The ledger must cover the eligible set exactly -- no key silently ignored.
for (const key of applicable.keys()) {
  if (!(key in ACCEPTED) && !(key in REJECTED)) fail(`"${key}" is eligible but the ledger records no decision for it.`);
}
for (const key of [...Object.keys(ACCEPTED), ...Object.keys(REJECTED)]) {
  if (!applicable.has(key)) fail(`the ledger decides "${key}", which is not in the eligible set.`);
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

for (const key of Object.keys(ACCEPTED)) {
  const row = applicable.get(key);
  const { CONTENT } = await import('../src/content/index.mjs');
  const current = CONTENT.ar[key];

  // Guard: the corpus must still hold exactly what the reviewer saw.
  if (serialise(current) !== row.currentArabic) {
    fail(`"${key}": the corpus no longer matches the reviewed Arabic.`);
    continue;
  }

  let target;
  try {
    target = deserialise(row.proposedArabic, current);
  } catch (err) {
    fail(`"${key}": the proposal could not be read back into the value's shape — ${err.message}`);
    continue;
  }

  if (serialise(target) !== row.proposedArabic) {
    fail(`"${key}": the parsed proposal does not re-serialise to the reviewer's text.`);
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
  applied.push({ key, file, leavesChanged: changed.length, decision: row.decision, claimId: row.claimId });
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
  applied: applied.map((a) => ({ ...a, note: ACCEPTED[a.key] })),
  rejected: Object.entries(REJECTED).map(([key, r]) => ({
    key,
    decision: applicable.get(key).decision,
    reviewerProposal: applicable.get(key).proposedArabic,
    rejectedReason: r.reason,
    finalArabicDecision: 'UNCHANGED — current Arabic retained; routed to the owner sign-off sheet.',
  })),
  deferredLegal: intake.legalDeferred,
};
await mkdir(join(ROOT, 'reports'), { recursive: true });
await writeFile(join(ROOT, 'reports/arabic-corrections-ledger.json'), JSON.stringify(ledger, null, 2), 'utf8');

console.log(DRY ? 'DRY RUN — nothing written' : 'ARABIC CORRECTIONS APPLIED');
console.log(`  eligible (non-legal)               ${intake.applicable.length}`);
console.log(`  ARABIC_CORRECTIONS_APPLIED         ${applied.length}`);
console.log(`  ARABIC_CORRECTIONS_REJECTED        ${Object.keys(REJECTED).length}`);
console.log(`  ARABIC_CORRECTIONS_DEFERRED_LEGAL  ${intake.legalDeferred.length}`);
console.log(`  leaf strings changed               ${applied.reduce((n, a) => n + a.leavesChanged, 0)}`);
console.log(`  files touched                      ${byFile.size}`);
for (const [file, e] of byFile) console.log(`      ${file}  (${e.length} key(s))`);
console.log('\nledger: reports/arabic-corrections-ledger.json');
