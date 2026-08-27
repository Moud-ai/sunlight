/**
 * MCP (Model Context Protocol) client.
 *
 * Connects to external MCP servers via Streamable HTTP transport, discovers
 * their tools, and executes tool calls. Uses fetch (React Native built-in)
 * with the project's fetchWithTimeout wrapper.
 *
 * Protocol flow:
 *  1. POST /mcp  → initialize  (get server info + session id)
 *  2. POST /mcp  → tools/list  (discover available tools)
 *  3. POST /mcp  → tools/call  (invoke a tool by name)
 */
import {fetchWithTimeout} from './fetchWithTimeout';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerConnection {
  url: string;
  name: string;
  tools: McpTool[];
  sessionId?: string;
}

let requestCounter = 0;

function nextId(): number {
  requestCounter += 1;
  return requestCounter;
}

/**
 * Normalise a base URL: trim whitespace and strip trailing slashes so that
 * path concatenation stays predictable.
 */
function normaliseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Low-level JSON-RPC 2.0 call against an MCP server's `/mcp` endpoint.
 *
 * Returns the parsed `result` field on success, or throws with the server's
 * error message when the response contains a JSON-RPC error.
 */
async function jsonRpcCall(
  baseUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{result: unknown; sessionId?: string}> {
  const endpoint = baseUrl.endsWith('/mcp') ? baseUrl : `${baseUrl}/mcp`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId;
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: nextId(),
    method,
    params,
  });

  const res = await fetchWithTimeout(endpoint, {method: 'POST', headers, body}, timeoutMs);

  if (!res.ok) {
    throw new Error(`MCP ${method} failed: HTTP ${res.status}`);
  }

  // The server may return the session id on every response.
  const newSessionId = res.headers.get('Mcp-Session-Id') ?? undefined;

  // The response may be a JSON-RPC result or an SSE stream. For simple
  // JSON responses we parse directly; if the content type is SSE we read
  // the full text and extract the last `data:` payload.
  const contentType = res.headers.get('Content-Type') ?? '';

  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    const dataLines = text
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim());
    const last = dataLines[dataLines.length - 1];
    if (!last) {
      throw new Error('MCP response contained no SSE data');
    }
    const parsed = JSON.parse(last) as {result?: unknown; error?: {message: string}};
    if (parsed.error) {
      throw new Error(parsed.error.message);
    }
    return {result: parsed.result, sessionId: newSessionId};
  }

  const json = (await res.json()) as {result?: unknown; error?: {message: string}};
  if (json.error) {
    throw new Error(json.error.message);
  }
  return {result: json.result, sessionId: newSessionId};
}

/**
 * Connect to an MCP server: send the `initialize` handshake and discover its
 * tools in a single call. The returned `McpServerConnection` holds the
 * session id for subsequent requests.
 */
export async function connectMcpServer(
  url: string,
  name: string,
): Promise<McpServerConnection> {
  const baseUrl = normaliseUrl(url);

  const {sessionId} = await jsonRpcCall(baseUrl, 'initialize', {
    protocolVersion: '2025-03-26',
    clientInfo: {name: 'sunlight', version: '1.0.0'},
    capabilities: {},
  });

  // Now fetch the tool list.
  const tools = await listMcpTools({url: baseUrl, name, tools: [], sessionId});

  return {url: baseUrl, name, tools, sessionId};
}

/**
 * List tools exposed by the connected MCP server.
 */
export async function listMcpTools(
  connection: McpServerConnection,
): Promise<McpTool[]> {
  const {result, sessionId} = await jsonRpcCall(
    connection.url,
    'tools/list',
    {},
    connection.sessionId,
  );

  const raw = (result as {tools?: Array<{name: string; description?: string; inputSchema?: Record<string, unknown>}>}) ?? {};
  const tools: McpTool[] = (raw.tools ?? []).map(t => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema ?? {},
  }));

  // Propagate session id back when called externally.
  if (sessionId) {
    connection.sessionId = sessionId;
  }

  return tools;
}

/**
 * Execute a tool on the connected MCP server and return the text result.
 */
export async function callMcpTool(
  connection: McpServerConnection,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const {result, sessionId} = await jsonRpcCall(
    connection.url,
    'tools/call',
    {name: toolName, arguments: args},
    connection.sessionId,
  );

  if (sessionId) {
    connection.sessionId = sessionId;
  }

  // MCP tool results follow the Content structure: an array of content blocks.
  const content = (result as {content?: Array<{type: string; text?: string}>})?.content;
  if (Array.isArray(content) && content.length > 0) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n');
  }

  // Fallback: stringify whatever came back.
  return typeof result === 'string' ? result : JSON.stringify(result);
}
