/**
 * Web search — queries the self-hosted SearXNG instance via the gateway
 * and detects search intent from user messages in multiple languages.
 *
 * The gateway proxies to SearXNG (bing/wikipedia/duckduckgo) with caching
 * and falls back to DuckDuckGo Instant Answer if SearXNG is down.
 */
import {request} from '../api/client';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  count: number;
}

/**
 * Execute a web search via the gateway's /v1/tools/web_search endpoint.
 * Requires a valid session apiKey (Bearer token).
 */
export async function searchWeb(
  query: string,
  apiKey: string,
  limit = 5,
): Promise<SearchResult[]> {
  try {
    const resp = await request<SearchResponse>('/v1/tools/web_search', {
      method: 'POST',
      body: {query, limit},
      apiKey,
      timeoutMs: 15_000,
    });
    return resp.results.filter(r => r.title !== 'No results found');
  } catch {
    return [];
  }
}

/**
 * Format search results as context text for the LLM.
 */
export function formatSearchContext(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return '';
  }
  const lines = results.map(
    (r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`,
  );
  return `Web search results for "${query}":\n\n${lines.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// Intent detection — multi-language patterns for "search the internet for X"
// ---------------------------------------------------------------------------

interface SearchPattern {
  /** Regex that matches the search trigger phrase. */
  re: RegExp;
  /** Group index that captures the query (0 = whole match). */
  group: number;
}

const PATTERNS: SearchPattern[] = [
  // Explicit command prefix
  {re: /^\/search\s+(.+)/i, group: 1},
  {re: /^buscar:\s*(.+)/i, group: 1},
  {re: /^search:\s*(.+)/i, group: 1},

  // Spanish
  {re: /busca\s+(?:en\s+)?(?:internet|la\s+web|google|web)\s+(?:sobre\s+|de\s+|para\s+)?(.+)/i, group: 1},
  {re: /buscar\s+(?:en\s+)?(?:internet|la\s+web|google|web)\s+(?:sobre\s+|de\s+|para\s+)?(.+)/i, group: 1},
  {re: /encuentra\s+(?:información\s+)?(?:sobre\s+|de\s+)?(.+)/i, group: 1},
  {re: /busca\s+información\s+sobre\s+(.+)/i, group: 1},
  {re: /busca\s+sobre\s+(.+)/i, group: 1},
  {re: /busca\s+(.+)/i, group: 1},

  // English
  {re: /search\s+(?:the\s+)?(?:internet|web|google)\s+(?:for\s+|about\s+)?(.+)/i, group: 1},
  {re: /look\s+up\s+(.+)/i, group: 1},
  {re: /find\s+(?:information\s+)?(?:about\s+|on\s+)?(.+)/i, group: 1},
  {re: /google\s+(.+)/i, group: 1},
  {re: /search\s+(?:for\s+)?(.+)/i, group: 1},

  // French
  {re: /recherche\s+(?:sur\s+)?(?:internet|le\s+web|google)\s+(?:pour\s+|sur\s+|à\s+propos\s+de\s+)?(.+)/i, group: 1},
  {re: /cherche\s+(?:sur\s+)?(?:internet|le\s+web|google)\s+(.+)/i, group: 1},
  {re: /cherche\s+(.+)/i, group: 1},

  // Portuguese
  {re: /pesquis[ae]\s+(?:na\s+)?(?:internet|web|google)\s+(?:sobre\s+|por\s+)?(.+)/i, group: 1},
  {re: /busc[ae]\s+(?:na\s+)?(?:internet|web|google)\s+(?:sobre\s+|por\s+)?(.+)/i, group: 1},
  {re: /pesquis[ae]\s+sobre\s+(.+)/i, group: 1},
  {re: /pesquis[ae]\s+(.+)/i, group: 1},

  // German
  {re: /such[et]\s+(?:im\s+)?(?:internet|web|google)\s+(?:nach\s+|über\s+|zu\s+)?(.+)/i, group: 1},
  {re: /such[et]\s+(?:nach\s+)?(.+)/i, group: 1},
];

/**
 * Detect whether a user message contains a search intent.
 * Returns the extracted query string, or null if no intent detected.
 */
export function detectSearchIntent(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length < 3) {
    return null;
  }
  for (const p of PATTERNS) {
    const m = trimmed.match(p.re);
    if (m && m[p.group]) {
      const query = m[p.group].trim().replace(/[?.!,;]+$/, '');
      if (query.length >= 2) {
        return query;
      }
    }
  }
  return null;
}