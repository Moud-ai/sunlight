/**
 * Link-code payload parsing for the device-approval scanner.
 *
 * This is intentionally SEPARATE from any 2FA payload handling: the scanner
 * only ever accepts Moud device-linking payloads (a console /device deep link
 * carrying ?code=..., or a bare 8-character user code). otpauth:// URIs and
 * anything else are rejected here so the linking flow can never be confused
 * with TOTP enrollment material.
 *
 * Pure module: no React, no network — fully unit-testable.
 */
import {GATEWAY_URL} from '../config';

export type ParsedLink =
  | {kind: 'code'; code: string}
  | {kind: 'invalid'};

/** Normalize a raw candidate: strip separators, uppercase. */
export function normalizeCandidate(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

function isValidUserCode(candidate: string): boolean {
  // The gateway mints exactly 8 characters from a Crockford-like alphabet.
  return /^[A-Z0-9]{8}$/.test(candidate);
}

/**
 * Parse a scanned QR payload.
 * Accepted forms:
 *  - "https://<gateway-host>/device?code=ABCD-1234" (any extra params ok)
 *  - a bare user code ("ABCD1234" or "ABCD-1234")
 * Everything else — including otpauth:// URIs — is invalid for this flow.
 */
export function parseLinkPayload(raw: string): ParsedLink {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return {kind: 'invalid'};
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return {kind: 'invalid'};
    }
    let gatewayHost = '';
    try {
      gatewayHost = new URL(GATEWAY_URL).hostname;
    } catch {
      return {kind: 'invalid'};
    }
    if (url.hostname !== gatewayHost) {
      return {kind: 'invalid'};
    }
    if (!/\/device\/?$/.test(url.pathname)) {
      return {kind: 'invalid'};
    }
    const codeParam = url.searchParams.get('code');
    if (!codeParam) {
      return {kind: 'invalid'};
    }
    const code = normalizeCandidate(codeParam);
    return isValidUserCode(code) ? {kind: 'code', code} : {kind: 'invalid'};
  }

  const code = normalizeCandidate(trimmed);
  return isValidUserCode(code) ? {kind: 'code', code} : {kind: 'invalid'};
}
