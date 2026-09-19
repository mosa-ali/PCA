/**
 * Arabic public-content Latin audit.
 *
 * Arabic prose is expected to be Arabic-first. The allowlist is deliberately
 * keyed to the exact content path and token so a new English phrase cannot be
 * hidden behind a broad "brand" or "technical" exemption.
 */

const LATIN_TOKEN = /[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*/g;

export const ARABIC_LATIN_ALLOWLIST = [
  {
    key: 'footer.group.pca',
    token: 'PCA',
    classification: 'BRAND_REQUIRED',
    reason: 'The footer group label is the PCA brand mark.',
  },
  {
    key: 'privacy.advanced.items[1].body',
    token: 'TLS',
    classification: 'TECHNICAL_IDENTIFIER_REQUIRED',
    reason: 'TLS is the exact name of the transport-security protocol discussed in the technical privacy section.',
  },
];

export const ARABIC_PROHIBITED_TERMINOLOGY = [
  { term: 'تطبيق الوالدين', gate: 'AR_PARENT_APP_INACCURATE_REFERENCES' },
  { term: 'تطبيق الآباء', gate: 'AR_PARENT_APP_INACCURATE_REFERENCES' },
  { term: 'تطبيق الطفل', gate: 'AR_CHILD_APP_AMBIGUOUS_REFERENCES' },
  { term: 'منصة الآباء', gate: 'AR_PARENT_APP_INACCURATE_REFERENCES' },
  { term: 'PCA Parent', gate: 'AR_PARENT_APP_INACCURATE_REFERENCES' },
  { term: 'PCA Child', gate: 'AR_CHILD_APP_AMBIGUOUS_REFERENCES' },
  { term: 'PCA Platform Admin', gate: 'AR_ADMIN_LATIN_REFERENCES' },
];

function walk(value, path, visit) {
  if (typeof value === 'string') {
    visit(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, visit));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => walk(item, `${path}.${key}`, visit));
  }
}

function contentKey(path) {
  return path.replace(/^CONTENT\.ar\./, '');
}

function allowlisted(key, token) {
  return ARABIC_LATIN_ALLOWLIST.find((entry) => entry.key === key && entry.token === token) ?? null;
}

function tokensIn(value) {
  return [...value.matchAll(LATIN_TOKEN)].map((match) => match[0]);
}

function terminologyIn(value, keyOrRoute) {
  const findings = [];
  for (const prohibited of ARABIC_PROHIBITED_TERMINOLOGY) {
    let start = 0;
    while (true) {
      const index = value.indexOf(prohibited.term, start);
      if (index < 0) break;
      findings.push({ key: keyOrRoute, term: prohibited.term, gate: prohibited.gate });
      start = index + prohibited.term.length;
    }
  }
  return findings;
}

/** Return every Latin token in Arabic content, including precise retain decisions. */
export function auditArabicContent(content) {
  const occurrences = [];
  const terminologyViolations = [];
  walk(content, 'CONTENT.ar', (path, value) => {
    // Claim IDs are internal metadata, not user-facing content. They are gated
    // separately by the build's claim-register and artifact metadata checks.
    if (path.endsWith('.claimId')) return;
    terminologyViolations.push(...terminologyIn(value, contentKey(path)));
    for (const token of tokensIn(value)) {
      const key = contentKey(path);
      const allowed = allowlisted(key, token);
      occurrences.push({
        key,
        token,
        classification: allowed?.classification ?? 'REPLACE_WITH_ARABIC',
        reason: allowed?.reason ?? 'Latin text is not justified in ordinary Arabic public copy.',
      });
    }
  });
  return {
    occurrences,
    retained: occurrences.filter((entry) => entry.classification !== 'REPLACE_WITH_ARABIC'),
    unapproved: occurrences.filter((entry) => entry.classification === 'REPLACE_WITH_ARABIC'),
    terminologyViolations,
  };
}

/** Extract visible text and accessibility labels from an emitted HTML page. */
export function visibleArabicHtmlText(html) {
  const labels = [...html.matchAll(/\b(?:aria-label|alt|title|placeholder)="([^"]*)"/gi)].map((match) => match[1]);
  const body = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<a class="pw-skip"[\s\S]*?<\/a>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  return `${body} ${labels.join(' ')}`;
}

/** Audit the rendered Arabic pages, catching hardcoded Latin outside content tables. */
export function auditArabicPages(pages) {
  const occurrences = [];
  const terminologyViolations = [];
  for (const page of pages.filter((candidate) => candidate.locale === 'ar')) {
    const visibleText = visibleArabicHtmlText(page.html);
    terminologyViolations.push(...terminologyIn(visibleText, page.path).map((entry) => ({ ...entry, route: page.path })));
    for (const token of tokensIn(visibleText)) {
      const allowed = token === 'TLS'
        ? ARABIC_LATIN_ALLOWLIST.find((entry) => entry.token === token)
        : null;
      occurrences.push({
        route: page.path,
        token,
        classification: allowed?.classification ?? 'REPLACE_WITH_ARABIC',
        reason: allowed?.reason ?? 'Latin text is not justified in rendered Arabic public content.',
      });
    }
  }
  return {
    occurrences,
    retained: occurrences.filter((entry) => entry.classification !== 'REPLACE_WITH_ARABIC'),
    unapproved: occurrences.filter((entry) => entry.classification === 'REPLACE_WITH_ARABIC'),
    terminologyViolations,
  };
}
