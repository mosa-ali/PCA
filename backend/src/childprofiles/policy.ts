export const MAX_CHILD_PROFILE_ID_LENGTH = 128;

/** Mirrors familyrbac/childrequests' own local isPlausibleOpaqueId -- this module validates its own id shape rather than importing another lane's copy, matching this codebase's existing per-module convention. */
export function isPlausibleChildProfileId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_CHILD_PROFILE_ID_LENGTH;
}
