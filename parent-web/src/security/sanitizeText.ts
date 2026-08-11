import DOMPurify from 'dompurify';

/**
 * Defense-in-depth text sanitizer for parent-authored custom message
 * content. We NEVER use dangerouslySetInnerHTML for this content -- React
 * text nodes are already escaped -- but we still strip any markup before
 * display so a message that somehow contains HTML-looking text renders as
 * inert plain text rather than surprising formatting.
 */
export function sanitizePlainText(input: string): string {
  const stripped = DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  return stripped.trim();
}
