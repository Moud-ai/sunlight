/**
 * Sunlight global configuration.
 */
import {OAUTH_CLIENT_IDS} from './oauthConfig';
export const GATEWAY_URL = 'https://mound.opceanai.com';

/** Default model until a model picker exists. */
export const DEFAULT_MODEL = 'moud/lfm2.5-1.2b-thinking';

/** Deep-link scheme registered in Info.plist / AndroidManifest. */
export const APP_URL_SCHEME = 'com.moud.sunlight';

/** OAuth redirect URL (must match the scheme registered natively). */
export const OAUTH_REDIRECT_URL = `${APP_URL_SCHEME}://auth`;

/** Storage keys (non-sensitive prefs only; secrets live in Keychain). */
export const STORAGE_KEYS = {
  subject: 'sunlight.subject',
} as const;

/**
 * OAuth provider configurations.
 * Each provider does the OIDC dance on-device via react-native-app-auth,
 * then exchanges the provider token for a moud_ API key at the gateway.
 */
export interface OAuthProviderConfig {
  id: 'github' | 'gitlab' | 'google';
  label: string;
  scopes: string[];
  /** Custom service config (endpoints). When omitted, `issuer` is used. */
  serviceConfig?: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revocationEndpoint?: string;
  };
  issuer?: string;
  /** Empty string means the provider is not configured yet. */
  clientId: string;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  github: {
    id: 'github',
    label: 'GitHub',
    scopes: ['read:user', 'user:email'],
    serviceConfig: {
      authorizationEndpoint: 'https://github.com/login/oauth/authorize',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      revocationEndpoint:
        'https://github.com/settings/connections/applications/:client_id',
    },
    clientId: OAUTH_CLIENT_IDS.github,
  },
  gitlab: {
    id: 'gitlab',
    label: 'GitLab',
    scopes: ['read_user', 'email'],
    issuer: 'https://gitlab.com',
    clientId: OAUTH_CLIENT_IDS.gitlab,
  },
  google: {
    id: 'google',
    label: 'Google',
    scopes: ['openid', 'email', 'profile'],
    issuer: 'https://accounts.google.com',
    clientId: OAUTH_CLIENT_IDS.google,
  },
};
