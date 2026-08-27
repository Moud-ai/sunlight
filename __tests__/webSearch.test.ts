/**
 * Tests for web search intent detection and context formatting.
 */
import {detectSearchIntent, formatSearchContext, type SearchResult} from '../src/lib/webSearch';

describe('detectSearchIntent', () => {
  it('detects explicit /search command', () => {
    expect(detectSearchIntent('/search alpine linux')).toBe('alpine linux');
  });

  it('detects explicit search: prefix', () => {
    expect(detectSearchIntent('search: quantum computing')).toBe('quantum computing');
  });

  it('detects Spanish buscar en internet', () => {
    expect(detectSearchIntent('busca en internet sobre inteligencia artificial')).toBe(
      'inteligencia artificial',
    );
  });

  it('detects Spanish busca ... sobre', () => {
    expect(detectSearchIntent('busca información sobre React Native')).toBe('React Native');
  });

  it('detects English search the web for', () => {
    expect(detectSearchIntent('search the web for machine learning')).toBe('machine learning');
  });

  it('detects English look up', () => {
    expect(detectSearchIntent('look up TypeScript generics')).toBe('TypeScript generics');
  });

  it('detects English google', () => {
    expect(detectSearchIntent('google best programming languages 2026')).toBe(
      'best programming languages 2026',
    );
  });

  it('detects French cherche', () => {
    expect(detectSearchIntent("cherche l'intelligence artificielle")).toBe(
      "l'intelligence artificielle",
    );
  });

  it('detects Portuguese pesquise', () => {
    expect(detectSearchIntent('pesquise sobre computação quântica')).toBe('computação quântica');
  });

  it('detects German suche nach', () => {
    expect(detectSearchIntent('suche nach maschinelles Lernen')).toBe('maschinelles Lernen');
  });

  it('strips trailing punctuation', () => {
    expect(detectSearchIntent('search for Python?')).toBe('Python');
  });

  it('returns null for short messages', () => {
    expect(detectSearchIntent('hi')).toBeNull();
  });

  it('returns null for normal messages', () => {
    expect(detectSearchIntent('how does React work?')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectSearchIntent('')).toBeNull();
  });
});

describe('formatSearchContext', () => {
  const results: SearchResult[] = [
    {title: 'Alpine Linux', url: 'https://alpinelinux.org', snippet: 'A lightweight Linux distro.'},
    {title: 'QEMU', url: 'https://qemu.org', snippet: 'Machine emulator.'},
  ];

  it('formats results with numbered references', () => {
    const ctx = formatSearchContext(results, 'alpine linux');
    expect(ctx).toContain('Web search results for "alpine linux"');
    expect(ctx).toContain('[1] Alpine Linux');
    expect(ctx).toContain('https://alpinelinux.org');
    expect(ctx).toContain('[2] QEMU');
  });

  it('returns empty string for no results', () => {
    expect(formatSearchContext([], 'nothing')).toBe('');
  });
});