/**
 * Minimal HTML helpers. No template engine, no dependency.
 *
 * Escaping discipline: every value that originates in a content table goes
 * through esc() or one of the helpers below. The ONLY way to emit raw markup
 * is raw(), which is deliberately noisy at call sites so it stays auditable.
 */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Marks a pre-built, already-escaped fragment. */
export function raw(html) {
  return { __raw: String(html) };
}

function render(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'object' && node.__raw !== undefined) return node.__raw;
  if (Array.isArray(node)) return node.map(render).join('');
  return esc(node);
}

/** Tagged template that escapes interpolations unless they are raw()/arrays. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1];
  }
  return raw(out);
}

/** Joins children into a raw fragment. */
export function frag(nodes) {
  return raw(nodes.map(render).join(''));
}

/** Builds an attribute string. `false`/`null`/`undefined` values are dropped. */
export function attrs(map) {
  const parts = [];
  for (const [key, value] of Object.entries(map)) {
    if (value === false || value === null || value === undefined) continue;
    if (value === true) {
      parts.push(esc(key));
      continue;
    }
    parts.push(`${esc(key)}="${esc(value)}"`);
  }
  return raw(parts.length ? ` ${parts.join(' ')}` : '');
}

export function classes(...values) {
  return values.filter(Boolean).join(' ');
}

/**
 * Renders a content string that may contain **bold** runs.
 *
 * The approved content documents use markdown emphasis inside body copy. This
 * converts exactly that one construct and nothing else -- everything outside
 * the ** ** pairs is escaped normally, so content tables can never inject
 * markup. Anything richer belongs in the component, not the content table.
 */
export function richText(value) {
  const source = String(value ?? '');
  let out = '';
  let index = 0;
  const pattern = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    out += esc(source.slice(index, match.index));
    out += `<strong>${esc(match[1])}</strong>`;
    index = match.index + match[0].length;
  }
  out += esc(source.slice(index));
  return raw(out);
}

/** Renders an array of body strings as <p> elements. */
export function paragraphs(values, className) {
  const cls = className ? ` class="${esc(className)}"` : '';
  return raw(values.map((v) => `<p${cls}>${render(richText(v))}</p>`).join(''));
}

export { render };
