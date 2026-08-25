/**
 * Pure-logic tests for the device login helpers: poll outcome mapping
 * (pending/slow_down/expired/approved incl. interval growth), QR deep-link
 * payload composition, and user-code formatting.
 */
import {
  mapPollOutcome,
  nextPollInterval,
  buildVerificationDeepLink,
  formatUserCode,
} from '../src/auth/deviceLogin';

describe('mapPollOutcome', () => {
  test('pending maps with no approval', () => {
    expect(mapPollOutcome({status: 'pending'})).toEqual({
      status: 'pending',
      approval: null,
    });
  });

  test('slow_down maps with no approval', () => {
    expect(mapPollOutcome({status: 'slow_down'})).toEqual({
      status: 'slow_down',
      approval: null,
    });
  });

  test('expired maps with no approval', () => {
    expect(mapPollOutcome({status: 'expired'})).toEqual({
      status: 'expired',
      approval: null,
    });
  });

  test('approved maps the minted key', () => {
    expect(
      mapPollOutcome({
        status: 'approved',
        api_key: 'moud_abc',
        key_id: 'device/ABCD-1234',
        subject: 'user-1',
      }),
    ).toEqual({
      status: 'approved',
      approval: {apiKey: 'moud_abc', keyId: 'device/ABCD-1234', subject: 'user-1'},
    });
  });

  test('approved without api_key yields no approval', () => {
    const out = mapPollOutcome({status: 'approved'});
    expect(out.status).toBe('approved');
    expect(out.approval).toBeNull();
  });

  test('unknown or missing status reads as pending', () => {
    expect(mapPollOutcome({}).status).toBe('pending');
    expect(mapPollOutcome({status: 'wat'}).status).toBe('pending');
    expect(mapPollOutcome(null).status).toBe('pending');
  });
});

describe('nextPollInterval', () => {
  test('slow_down grows the interval by 5s', () => {
    expect(nextPollInterval(5000, 'slow_down')).toBe(10000);
    expect(nextPollInterval(2000, 'slow_down')).toBe(7000);
  });

  test('slow_down is capped at 30s', () => {
    expect(nextPollInterval(28000, 'slow_down')).toBe(30000);
    expect(nextPollInterval(30000, 'slow_down')).toBe(30000);
  });

  test('other statuses keep the current interval', () => {
    expect(nextPollInterval(5000, 'pending')).toBe(5000);
    expect(nextPollInterval(12000, 'expired')).toBe(12000);
    expect(nextPollInterval(9000, 'approved')).toBe(9000);
  });
});

describe('buildVerificationDeepLink', () => {
  test('appends code to a plain URL and strips trailing slashes', () => {
    expect(
      buildVerificationDeepLink('https://moud.example/device/', 'ABCD1234'),
    ).toBe('https://moud.example/device?code=ABCD1234');
  });

  test('uses & when the URL already carries a query', () => {
    expect(
      buildVerificationDeepLink('https://moud.example/device?x=1', 'ABCD1234'),
    ).toBe('https://moud.example/device?x=1&code=ABCD1234');
  });

  test('encodes unsafe characters in the code', () => {
    expect(buildVerificationDeepLink('https://moud.example/device', 'a b/c'))
      .toBe('https://moud.example/device?code=a%20b%2Fc');
  });
});

describe('formatUserCode', () => {
  test('groups an 8-char code into two groups of four', () => {
    expect(formatUserCode('ABCD1234')).toBe('ABCD-1234');
  });

  test('handles shorter and longer codes', () => {
    expect(formatUserCode('ABC')).toBe('ABC');
    expect(formatUserCode('ABCDEFGHJK')).toBe('ABCD-EFGH-JK');
  });

  test('is idempotent on already-formatted codes', () => {
    expect(formatUserCode(formatUserCode('ABCD1234'))).toBe('ABCD-1234');
    expect(formatUserCode('ABCD-1234')).toBe('ABCD-1234');
    expect(formatUserCode(formatUserCode('ABCDEFGHJK'))).toBe(
      'ABCD-EFGH-JK',
    );
  });
});
