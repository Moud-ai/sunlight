/**
 * OAuth + email/password login against the moud console.
 *
 * OAuth flow (GitHub / GitLab / Google):
 *   1. react-native-app-auth does the OIDC dance on-device -> provider token.
 *   2. POST /api/auth/mobile/oauth with the provider token -> moud_ API key
 *      (the console verifies the token server-side against the provider).
 *
 * Email/password flow:
 *   POST /api/auth/mobile/password with {email, password} -> moud_ API key.
 *
 * Both paths resolve into a DeviceApproval; HTTP failures throw ApiError
 * {status, type, message} so screens can render copy (no user-facing strings
 * live in this module).
 */
import {authorize} from 'react-native-app-auth';
import {OAUTH_REDIRECT_URL, OAUTH_PROVIDERS, OAuthProviderConfig} from '../config';
import {googleRedirectUrl} from '../oauthConfig';
import {request, ApiError} from '../api/client';
import {DeviceApproval} from './deviceLogin';

export type OAuthProviderId = 'github' | 'gitlab' | 'google';

const EXCHANGE_TIMEOUT_MS = 15_000;
const PASSWORD_TIMEOUT_MS = 20_000;

/**
 * Exchange a provider OAuth token for a moud_ API key.
 * The gateway trusts the provider token and mints a device-bound key.
 */
export async function exchangeOAuthToken(
  provider: OAuthProviderId,
  accessToken: string,
): Promise<DeviceApproval | null> {
  const j = await request<any>('/api/auth/mobile/oauth', {
    method: 'POST',
    body: {provider, access_token: accessToken},
    timeoutMs: EXCHANGE_TIMEOUT_MS,
  });
  if (!j.api_key) {
    return null;
  }
  return {
    apiKey: j.api_key,
    keyId: j.key_id ?? '',
    subject: j.subject ?? '',
  };
}

/** Run the full OAuth dance for one provider and exchange for a moud key. */
export async function loginWithOAuth(
  provider: OAuthProviderId,
): Promise<DeviceApproval | null> {
  const cfg: OAuthProviderConfig = OAUTH_PROVIDERS[provider];
  if (!cfg) {
    throw new Error(`unknown provider: ${provider}`);
  }

  const authConfig: any = {
    clientId: cfg.clientId,
    redirectUrl: provider === 'google' ? googleRedirectUrl() : OAUTH_REDIRECT_URL,
    scopes: cfg.scopes,
    usePKCE: true,
  };
  if (cfg.serviceConfig) {
    authConfig.serviceConfiguration = cfg.serviceConfig;
  } else if (cfg.issuer) {
    authConfig.issuer = cfg.issuer;
  } else {
    throw new Error(`provider ${provider} has no issuer or serviceConfig`);
  }

  const result = await authorize(authConfig);
  return exchangeOAuthToken(provider, result.accessToken);
}

/** Email + password login. Returns a moud_ API key on success. */
export async function loginWithPassword(
  email: string,
  password: string,
  totpCode?: string,
): Promise<DeviceApproval | null> {
  let j: any;
  try {
    j = await request<any>('/api/auth/mobile/password', {
      method: 'POST',
      body: {email, password, ...(totpCode ? {totp_code: totpCode} : {})},
      timeoutMs: PASSWORD_TIMEOUT_MS,
    });
  } catch (e: any) {
    if (e instanceof ApiError && e.status === 401) {
      // Typed only; the screen renders the copy for this case.
      throw e;
    }
    if (e instanceof ApiError && e.status !== 0) {
      throw new ApiError(e.status, e.type, `auth/password HTTP ${e.status}`);
    }
    throw e;
  }
  if (!j.api_key) {
    return null;
  }
  return {
    apiKey: j.api_key,
    keyId: j.key_id ?? '',
    subject: j.subject ?? '',
  };
}
