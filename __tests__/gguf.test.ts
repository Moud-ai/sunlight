/**
 * Pure-part tests for src/lib/gguf.ts: registry merge/parse, URL validation,
 * catalog shape invariants, and progress math — all extracted as module-level
 * pure functions precisely so they can be tested without native modules.
 */
import {
  CURATED_GGUF_MODELS,
  GGUF_PREFIX,
  fromPickerId,
  humanBytes,
  isValidGgufUrl,
  localPath,
  mergeRegistryEntry,
  parseRegistry,
  progressFraction,
  removeRegistryEntry,
  toPickerId,
  validateGgufCatalog,
  type GgufRegistryEntry,
} from '../src/lib/gguf';

const ENTRY: GgufRegistryEntry = {
  path: '/docs/models/x.gguf',
  bytes: 10,
  downloadedAt: 1_700_000_000_000,
};

describe('parseRegistry', () => {
  it('parses a valid registry payload', () => {
    const raw = JSON.stringify({m1: ENTRY});
    expect(parseRegistry(raw)).toEqual({m1: ENTRY});
  });

  it('returns empty for null, garbage JSON, arrays and non-objects', () => {
    expect(parseRegistry(null)).toEqual({});
    expect(parseRegistry('not json {')).toEqual({});
    expect(parseRegistry('[1,2]')).toEqual({});
    expect(parseRegistry('42')).toEqual({});
    expect(parseRegistry('"str"')).toEqual({});
  });

  it('drops malformed entries but keeps valid siblings', () => {
    const raw = JSON.stringify({
      good: ENTRY,
      badPath: {bytes: 1, downloadedAt: 2},
      badBytes: {path: '/x', bytes: 'many', downloadedAt: 2},
      badDate: {path: '/x', bytes: 1, downloadedAt: 'yesterday'},
      nullEntry: null,
    });
    expect(parseRegistry(raw)).toEqual({good: ENTRY});
  });
});

describe('registry merge/remove', () => {
  it('mergeRegistryEntry returns a new object without mutating prev', () => {
    const prev = {};
    const next = mergeRegistryEntry(prev, 'a', ENTRY);
    expect(next).toEqual({a: ENTRY});
    expect(next).not.toBe(prev);
    expect(prev).toEqual({});
  });

  it('merge overwrites an existing id (re-download case)', () => {
    const updated = {...ENTRY, downloadedAt: 2};
    const next = mergeRegistryEntry({a: ENTRY}, 'a', updated);
    expect(next.a).toEqual(updated);
  });

  it('removeRegistryEntry drops only the target id', () => {
    const reg = mergeRegistryEntry(mergeRegistryEntry({}, 'a', ENTRY), 'b', {
      ...ENTRY,
      path: '/b',
    });
    const next = removeRegistryEntry(reg, 'a');
    expect(Object.keys(next)).toEqual(['b']);
    // Removing an absent id is a no-op returning the same reference.
    expect(removeRegistryEntry(next, 'zzz')).toBe(next);
  });
});

describe('progressFraction', () => {
  it('computes in-range fractions', () => {
    expect(progressFraction(0, 100)).toBe(0);
    expect(progressFraction(50, 100)).toBe(0.5);
    expect(progressFraction(100, 100)).toBe(1);
  });

  it('clamps out-of-range writes to [0, 1]', () => {
    expect(progressFraction(-5, 100)).toBe(0);
    expect(progressFraction(150, 100)).toBe(1);
  });

  it('sentinel: missing/non-positive contentLength yields 0, never NaN', () => {
    expect(progressFraction(10, 0)).toBe(0);
    expect(progressFraction(10, -1)).toBe(0);
    expect(Number.isNaN(progressFraction(NaN, NaN))).toBe(false);
    expect(progressFraction(NaN, NaN)).toBe(0);
  });
});

describe('isValidGgufUrl', () => {
  it('accepts direct HF resolve/main .gguf links', () => {
    expect(
      isValidGgufUrl(
        'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
      ),
    ).toBe(true);
  });

  it('rejects non-HF hosts, blob pages, http, non-gguf and bare hosts', () => {
    expect(isValidGgufUrl('http://huggingface.co/a/b/resolve/main/x.gguf')).toBe(
      false,
    );
    expect(
      isValidGgufUrl('https://example.com/repo/resolve/main/x.gguf'),
    ).toBe(false);
    expect(
      isValidGgufUrl('https://huggingface.co/repo/blob/main/x.gguf'),
    ).toBe(false);
    expect(
      isValidGgufUrl('https://huggingface.co/repo/resolve/main/x.bin'),
    ).toBe(false);
    expect(isValidGgufUrl('https://huggingface.co')).toBe(false);
    expect(isValidGgufUrl('ftp://huggingface.co/x.gguf')).toBe(false);
  });
});

describe('picker id mapping', () => {
  it('toPickerId adds the prefix exactly once', () => {
    expect(toPickerId('lfm2_1_2b_q4_k_m')).toBe('gguf/lfm2_1_2b_q4_k_m');
    expect(toPickerId('gguf/lfm2_1_2b_q4_k_m')).toBe(
      'gguf/lfm2_1_2b_q4_k_m',
    );
  });

  it('fromPickerId strips the prefix and rejects foreign ids', () => {
    expect(fromPickerId('gguf/qwen3_1_7b_q4_k_m')).toBe('qwen3_1_7b_q4_k_m');
    expect(fromPickerId('local/llama3_2_1b_spinquant')).toBeNull();
    expect(fromPickerId('gguf/')).toBe('');
  });
});

describe('humanBytes', () => {
  it('formats MB and GB sizes', () => {
    expect(humanBytes(491400032)).toBe('469 MB');
    expect(humanBytes(1282439264)).toBe('1.2 GB');
    expect(humanBytes(386404992)).toBe('369 MB');
  });
});

describe('CURATED_GGUF_MODELS catalog invariants', () => {
  it('has a healthy catalog size with unique slug ids', () => {
    expect(CURATED_GGUF_MODELS.length).toBeGreaterThanOrEqual(3);
    expect(CURATED_GGUF_MODELS.length).toBeLessThanOrEqual(30);
    const ids = CURATED_GGUF_MODELS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('passes full structural validation (URLs, files, byte sizes)', () => {
    expect(validateGgufCatalog(CURATED_GGUF_MODELS)).toEqual([]);
  });

  it('records verified byte sizes matching the HEAD-probed content-lengths', () => {
    const byId = new Map(CURATED_GGUF_MODELS.map(m => [m.id, m]));
    // Exact content-length values captured via curl -sIL at integration time.
    expect(byId.get('qwen3_1_7b_q4_k_m')?.bytes).toBe(1282439264);
    expect(byId.get('lfm2_1_2b_q4_k_m')?.bytes).toBe(730893248);
    expect(byId.get('smollm2_360m_q8_0')?.bytes).toBe(386404992);
    expect(byId.get('qwen25_0_5b_q4_k_m')?.bytes).toBe(491400032);
    expect(byId.get('qwen25_1_5b_q4_k_m')?.bytes).toBe(1117320736);
  });

  it('localPath maps ids into the models dir with the catalog filename', () => {
    expect(localPath('smollm2_360m_q8_0').endsWith('/models/smollm2-360m-instruct-q8_0.gguf')).toBe(
      true,
    );
    expect(localPath('smollm2_360m_q8_0')).toContain('/models/');
  });

  it('rejects unknown ids when resolving paths', () => {
    expect(() => localPath('nope')).toThrow(/unknown GGUF model id/);
  });

  it('picker ids are prefixed consistently with GGUF_PREFIX', () => {
    for (const entry of CURATED_GGUF_MODELS) {
      expect(toPickerId(entry.id).startsWith(GGUF_PREFIX)).toBe(true);
      expect(fromPickerId(toPickerId(entry.id))).toBe(entry.id);
    }
  });
});

describe('validateGgufCatalog rejects malformed catalogs', () => {
  it('flags bad urls, duplicate ids, non-integer bytes and file mismatches', () => {
    const problems = validateGgufCatalog([
      ...CURATED_GGUF_MODELS,
      {
        id: CURATED_GGUF_MODELS[0].id,
        label: 'dup',
        file: 'wrong.gguf',
        url: 'https://example.com/x.gguf',
        bytes: -1,
        quant: 'Q4_K_M',
      },
      {
        id: 'Bad-Id',
        label: 'bad',
        file: 'x.gguf',
        url: 'https://huggingface.co/r/resolve/main/x.gguf',
        bytes: 1,
        quant: 'Q4',
      },
    ]);
    expect(problems.length).toBeGreaterThanOrEqual(5);
    expect(problems.some(p => p.includes('duplicate id'))).toBe(true);
    expect(problems.some(p => p.includes('url is not a direct HF resolve URL'))).toBe(true);
    expect(problems.some(p => p.includes('id must be lowercase slug'))).toBe(true);
    expect(problems.some(p => p.includes('file does not match url basename'))).toBe(true);
  });
});
