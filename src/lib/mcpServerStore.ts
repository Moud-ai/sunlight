/**
 * AsyncStorage-backed store for MCP server configurations.
 *
 * Each entry tracks a user-configured MCP server endpoint so it can be
 * re-connected on app start or toggled on/off from the Settings screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@sunlight_mcp_servers';

export interface McpServerConfig {
  /** Local identifier (not a formal UUID — generated with a simple random hex string). */
  id: string;
  /** Display name chosen by the user. */
  name: string;
  /** Full base URL of the MCP server (e.g. "https://example.com/mcp"). */
  url: string;
  /** Whether the server is active and should be connected at launch. */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// ID generation — dependency-free, sufficient for local uniqueness.
// ---------------------------------------------------------------------------

function randomId(): string {
  // Simple hex-id generation: 32 hex chars from Math.random.
  // Sufficient for local uniqueness; no external dependency needed.
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export async function loadMcpServers(): Promise<McpServerConfig[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (s): s is McpServerConfig =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as McpServerConfig).id === 'string' &&
        typeof (s as McpServerConfig).url === 'string' &&
        typeof (s as McpServerConfig).name === 'string' &&
        typeof (s as McpServerConfig).enabled === 'boolean',
    );
  } catch {
    return [];
  }
}

export async function saveMcpServers(servers: McpServerConfig[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

export async function addMcpServer(
  url: string,
  name: string,
): Promise<McpServerConfig> {
  const server: McpServerConfig = {
    id: randomId(),
    name: name.trim() || 'MCP Server',
    url: url.trim(),
    enabled: true,
  };
  const existing = await loadMcpServers();
  await saveMcpServers([...existing, server]);
  return server;
}

export async function removeMcpServer(id: string): Promise<void> {
  const servers = await loadMcpServers();
  await saveMcpServers(servers.filter(s => s.id !== id));
}

export async function toggleMcpServer(
  id: string,
  enabled: boolean,
): Promise<void> {
  const servers = await loadMcpServers();
  const updated = servers.map(s => (s.id === id ? {...s, enabled} : s));
  await saveMcpServers(updated);
}

// ---------------------------------------------------------------------------
// Default servers — pre-configure Tavily on first run
// ---------------------------------------------------------------------------

const TAVILY_DEFAULT: McpServerConfig = {
  id: 'tavily-default',
  name: 'Tavily',
  url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=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',
  enabled: true,
};

/**
 * Ensure the default Tavily MCP server is present.
 * Call once on app start (after loadMcpServers).
 */
export async function ensureDefaultMcpServers(): Promise<McpServerConfig[]> {
  const servers = await loadMcpServers();
  const hasTavily = servers.some(s => s.id === TAVILY_DEFAULT.id);
  if (!hasTavily) {
    const updated = [...servers, TAVILY_DEFAULT];
    await saveMcpServers(updated);
    return updated;
  }
  return servers;
}
