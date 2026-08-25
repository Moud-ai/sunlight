/**
 * client.ts error-mapping tests: parsed success bodies, upstream
 * {"error":{"type":...}} extraction, distinct 401 mapping, and network
 * failures. Uses a mocked global fetch (no native deps).
 */
import {request, ApiError, errorTypeFromBody, isAuthExpired} from '../src/api/client';

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit]>;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(status: number, text: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as unknown as Response;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('request', () => {
  test('returns the parsed body and sends auth + JSON headers', async () => {
    const mock = jest.fn(async (_url: string, init: RequestInit) =>
      jsonResponse(200, {enabled: true}),
    ) as unknown as FetchMock;
    (globalThis as any).fetch = mock;

    const out = await request<{enabled: boolean}>('/auth/2fa', {
      method: 'POST',
      apiKey: 'moud_k',
      body: {code: '123456'},
    });

    expect(out).toEqual({enabled: true});
    const [url, init] = mock.mock.calls[0];
    expect(url).toContain('/auth/2fa');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer moud_k',
    );
    expect(init.body).toBe(JSON.stringify({code: '123456'}));
  });

  test('extracts error.type from an upstream error body', async () => {
    (globalThis as any).fetch = jest.fn(async () =>
      jsonResponse(403, {error: {type: 'totp_invalid'}}),
    );
    const err = await request('/auth/2fa/enable', {
      method: 'POST',
      body: {code: '000000'},
    }).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).type).toBe('totp_invalid');
    expect(isAuthExpired(err)).toBe(false);
  });

  test('maps 401 distinctly even without a typed body', async () => {
    (globalThis as any).fetch = jest.fn(async () =>
      textResponse(401, 'unauthorized'),
    );
    const err = await request('/auth/devices', {
      apiKey: 'moud_revoked',
    }).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(isAuthExpired(err)).toBe(true);
  });

  test('maps transport failures to a network_error ApiError', async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const err = await request('/auth/device/start', {method: 'POST'}).catch(
      e => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).type).toBe('network_error');
  });
});

describe('errorTypeFromBody', () => {
  test('reads nested error.type and falls back cleanly', () => {
    expect(errorTypeFromBody({error: {type: 'totp_required'}})).toBe(
      'totp_required',
    );
    expect(errorTypeFromBody({error: {}}, 'fallback')).toBe('fallback');
    expect(errorTypeFromBody(null, 'fallback')).toBe('fallback');
    expect(errorTypeFromBody('nope')).toBe('error');
  });
});
