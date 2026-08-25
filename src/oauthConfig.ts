/**
 * OAuth provider client IDs for Sunlight.
 *
 * Fill these at release/build time with REAL values registered against
 * `sunlight://auth` as the redirect URI (see docs/OAUTH_SETUP.md).
 *
 * NEVER commit real client IDs of restricted apps here if your policy treats
 * them as sensitive; prefer CI injection or a gitignored local override.
 * Client SECRETS must never be placed here at all: mobile bundles are public,
 * so every flow is PKCE-only and the token exchange happens server-side on
 * the Mound console (/api/auth/mobile/oauth).
 *
 * Empty string = provider disabled at runtime (button shows a setup hint).
 */
export const GOOGLE_CLIENT_ID = '1039508376567-a718g4ae03p5vdhrrcbnrkkd3mj31csg.apps.googleusercontent.com';
export const GITHUB_CLIENT_ID = 'aa3144b3183716840e10ef5433da40778fa56f09';
export const GITLAB_CLIENT_ID = '0c000ca86f110ffcd19be910e422ce13a9f85d7d8879776353bdde1d75cfe3ee';

/**
 * Google requires the reversed client ID as the redirect URL scheme.
 * Format: com.googleusercontent.apps.<GUID>:/oauth2redirect/google
 * This is derived automatically from GOOGLE_CLIENT_ID.
 */
export function googleRedirectUrl(): string {
  // GOOGLE_CLIENT_ID format: "123456789-xxxx.apps.googleusercontent.com"
  // We need the GUID part before ".apps.googleusercontent.com"
  const guid = GOOGLE_CLIENT_ID.split('.apps.googleusercontent.com')[0];
  return `com.googleusercontent.apps.${guid}:/oauth2redirect/google`;
}

/** Typed accessor used by src/config.ts; empty id => provider not usable. */
export const OAUTH_CLIENT_IDS = {
  google: GOOGLE_CLIENT_ID,
  github: GITHUB_CLIENT_ID,
  gitlab: GITLAB_CLIENT_ID,
} as const;
