export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

// Exactly three dot-separated non-negative integer components, no leading
// zeros (except the literal "0" itself), digits only -- a bounded,
// architecture-required subset of SemVer, not a general parser.
const VERSION_SHAPE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_COMPONENT_VALUE = 999_999;

export function parseVersion(candidate: unknown): ParsedVersion | null {
  if (typeof candidate !== 'string' || candidate.length > 32) return null;
  const match = VERSION_SHAPE.exec(candidate);
  if (!match) return null;
  const [, majorStr, minorStr, patchStr] = match;
  const major = Number(majorStr);
  const minor = Number(minorStr);
  const patch = Number(patchStr);
  if (major > MAX_COMPONENT_VALUE || minor > MAX_COMPONENT_VALUE || patch > MAX_COMPONENT_VALUE) return null;
  return { major, minor, patch };
}

export function isValidVersion(candidate: unknown): candidate is string {
  return parseVersion(candidate) !== null;
}

/** Numeric comparison, never lexicographic -- 1.9.0 < 1.10.0, 2.0.0 > 1.99.99. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new RangeError('compareVersions requires two valid version strings.');
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}
