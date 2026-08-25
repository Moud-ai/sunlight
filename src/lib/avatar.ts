/**
 * Letter-mark fallback for avatars.
 *
 * Single source of truth for the big initial shown when a user has no avatar
 * image. Never hardcode a letter at the call site — always go through this
 * helper so the fallback tracks the real identity.
 */

/**
 * First alphanumeric character (uppercased) of displayName ?? subject,
 * defaulting to 'S' when neither yields a usable character.
 *
 * Unicode-aware: letters and digits from any script count ('álvaro' -> 'Á').
 */
export function initialFor(
  name?: string | null,
  subject?: string | null,
): string {
  for (const candidate of [name, subject]) {
    if (!candidate) {
      continue;
    }
    const match = candidate.match(/[\p{L}\p{N}]/u);
    if (match) {
      return match[0].toUpperCase();
    }
  }
  return 'S';
}
