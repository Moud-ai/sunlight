/**
 * Tests for resolveChatTarget (src/lib/chatTarget.ts): the pure routing
 * decision taken before every chat stream across all three quota modes —
 * 'personal' (own moud quota at the gateway), 'community' (shared pool at the
 * gateway) and 'byok' (user's own endpoint) — including graceful fallbacks and
 * the model-id rules.
 *
 * Pure module: no native mocks required.
 */
import {resolveChatTarget, ChatTargetSession, ChatTargetSettings} from '../src/lib/chatTarget';
import {isQuotaMode} from '../src/lib/byok';

const SESSION: ChatTargetSession = {apiKey: 'moud_session_key'};

const BYOK = {
  baseUrl: 'https://my-endpoint.example.com/v1',
  apiKey: 'sk-personal-123',
  modelId: 'vendor/my-model',
};

function settings(
  mode: ChatTargetSettings['mode'],
  byok: ChatTargetSettings['byok'] = null,
): ChatTargetSettings {
  return {byok, mode};
}

describe('resolveChatTarget — three-mode matrix', () => {
  test("'community' routes through the gateway with the session key", () => {
    expect(resolveChatTarget(SESSION, settings('community'), 'moud/lfm2.5')).toEqual({
      apiKey: SESSION.apiKey,
      model: 'moud/lfm2.5',
      baseUrl: undefined,
      route: 'gateway',
    });
  });

  test("'personal' routes through the gateway too (session key, own quota)", () => {
    // personal ≠ BYOK: it consumes the user's own moud quota at the gateway,
    // so transport is identical to community even when a BYOK config exists.
    expect(
      resolveChatTarget(SESSION, settings('personal', BYOK), 'gpt-4o'),
    ).toEqual({
      apiKey: SESSION.apiKey,
      model: 'gpt-4o',
      baseUrl: undefined,
      route: 'gateway',
    });
  });

  test("'community' ignores a stored BYOK config", () => {
    const target = resolveChatTarget(SESSION, settings('community', BYOK), 'x');
    expect(target.route).toBe('gateway');
    expect(target.apiKey).toBe(SESSION.apiKey);
    expect(target.baseUrl).toBeUndefined();
  });

  test("'byok' without a config degrades gracefully to the gateway", () => {
    expect(resolveChatTarget(SESSION, settings('byok'), 'gpt-4o')).toEqual({
      apiKey: SESSION.apiKey,
      model: 'gpt-4o',
      baseUrl: undefined,
      route: 'gateway',
    });
  });

  test("BYOK active + model known in the gateway catalog keeps the picked model", () => {
    const target = resolveChatTarget(SESSION, settings('byok', BYOK), 'gpt-4o', {
      gatewayModelIds: new Set(['gpt-4o', 'moud/lfm2.5']),
    });
    expect(target).toEqual({
      apiKey: BYOK.apiKey,
      model: 'gpt-4o',
      baseUrl: BYOK.baseUrl,
      route: 'byok',
    });
  });

  test("BYOK active + model NOT in the gateway catalog prefers byok.modelId", () => {
    const target = resolveChatTarget(
      SESSION,
      settings('byok', BYOK),
      'stale/removed-model',
      {gatewayModelIds: new Set(['gpt-4o'])},
    );
    expect(target).toEqual({
      apiKey: BYOK.apiKey,
      model: BYOK.modelId,
      baseUrl: BYOK.baseUrl,
      route: 'byok',
    });
  });

  test('BYOK active without catalog knowledge falls back to byok.modelId', () => {
    const target = resolveChatTarget(SESSION, settings('byok', BYOK), 'anything');
    expect(target.model).toBe(BYOK.modelId);
    expect(target.baseUrl).toBe(BYOK.baseUrl);
    expect(target.route).toBe('byok');
  });

  test('empty gatewayModelIds set behaves as "not in gateway"', () => {
    expect(
      resolveChatTarget(SESSION, settings('byok', BYOK), 'gpt-4o', {
        gatewayModelIds: new Set(),
      }).model,
    ).toBe(BYOK.modelId);
  });

    test('legacy boolean shape maps onto the mode enum compatibly', () => {
    // The persisted settings loader (loadByokSettings) derives
    // usePersonalQuota === (mode === 'byok'); resolveChatTarget itself only
    // reads `mode`. A legacy caller that pre-migrates a boolean gets identical
    // behavior through the mapping below.
    expect(isQuotaMode('personal')).toBe(true);
    expect(isQuotaMode('community')).toBe(true);
    expect(isQuotaMode('byok')).toBe(true);
    expect(isQuotaMode(true)).toBe(false);
    expect(isQuotaMode('nope')).toBe(false);
  });
});
