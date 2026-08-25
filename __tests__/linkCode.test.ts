/**
 * Tests for the link-QR payload validator (src/auth/linkCode.ts).
 * Covers deep-link URLs, bare codes, normalization, and — critically —
 * rejection of otpauth:// and foreign payloads so linking never collides
 * with 2FA enrollment material.
 */
import {parseLinkPayload, normalizeCandidate} from '../src/auth/linkCode';

describe('parseLinkPayload', () => {
  it('accepts the console /device deep link with a formatted code', () => {
    expect(parseLinkPayload('https://mound.opceanai.com/device?code=ABCD-1234')).toEqual({
      kind: 'code',
      code: 'ABCD1234',
    });
  });

  it('accepts the deep link with extra params and trailing slash', () => {
    expect(
      parseLinkPayload('https://mound.opceanai.com/device/?utm_source=x&code=abcd1234'),
    ).toEqual({kind: 'code', code: 'ABCD1234'});
  });

  it('accepts bare codes with hyphens, spaces, lowercase', () => {
    expect(parseLinkPayload('ABCD-1234')).toEqual({kind: 'code', code: 'ABCD1234'});
    expect(parseLinkPayload(' ab cd 12 34 ')).toEqual({kind: 'code', code: 'ABCD1234'});
    expect(parseLinkPayload('abcd1234')).toEqual({kind: 'code', code: 'ABCD1234'});
  });

  it('rejects otpauth:// URIs (2FA QRs are a separate flow)', () => {
    expect(parseLinkPayload('otpauth://totp/Moud:user?secret=ABC234DEF').kind).toBe('invalid');
  });

  it('rejects foreign hosts and wrong paths', () => {
    expect(parseLinkPayload('https://evil.example.com/device?code=ABCD1234').kind).toBe('invalid');
    expect(parseLinkPayload('https://mound.opceanai.com/other?code=ABCD1234').kind).toBe('invalid');
  });

  it('rejects malformed or short codes', () => {
    expect(parseLinkPayload('ABC123').kind).toBe('invalid');
    expect(parseLinkPayload('ABCD-12345').kind).toBe('invalid');
    expect(parseLinkPayload('').kind).toBe('invalid');
    expect(parseLinkPayload('hello world').kind).toBe('invalid');
  });
});

describe('normalizeCandidate', () => {
  it('strips separators and uppercases', () => {
    expect(normalizeCandidate('ab-cd 12')).toBe('ABCD12');
  });
});
