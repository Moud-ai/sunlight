/**
 * MCP (Model Context Protocol) server for Sunlight — Native Module Bridge.
 *
 * Exposes the app's tools to external AI clients (Claude Desktop, Cursor, etc.)
 * via JSON-RPC 2.0 over HTTP (Streamable HTTP transport).
 *
 * The actual HTTP server runs in Kotlin (McpServerModule). This module provides
 * the JS bridge to start/stop the server and execute tools.
 */
import {NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface McpServerConfig {
  enabled: boolean;
  port: number;
}

interface SunlightMcpNative {
  startServer(port: number): Promise<boolean>;
  stopServer(): Promise<boolean>;
  isRunning(): Promise<boolean>;
  getPort(): Promise<number>;
  getConfig(): Promise<{enabled: boolean; port: number}>;
  setConfig(config: {enabled: boolean; port: number}): Promise<boolean>;
  executeTool(name: string, argsJson: string): Promise<string>;
}

function getMcp(): SunlightMcpNative {
  const mod = NativeModules.SunlightMcpServer as SunlightMcpNative | undefined;
  if (!mod) {
    throw new Error('SunlightMcpServer native module is not available');
  }
  return mod;
}

export async function loadMcpConfig(): Promise<McpServerConfig> {
  return getMcp().getConfig();
}

export async function saveMcpConfig(config: McpServerConfig): Promise<void> {
  await getMcp().setConfig(config);
}

export function startMcpServer(port: number, _getApiKey: () => string | undefined): void {
  // The native server doesn't need the API key at startup; tools fetch it at call time.
  getMcp().startServer(port).catch(() => {});
}

export function stopMcpServer(): void {
  getMcp().stopServer().catch(() => {});
}

export async function isMcpServerRunning(): Promise<boolean> {
  return getMcp().isRunning();
}

export async function getMcpServerPort(): Promise<number> {
  return getMcp().getPort();
}

// ---------------------------------------------------------------------------
// Tool execution via native module
// ---------------------------------------------------------------------------

export async function executeMcpTool(
  name: string,
  args: Record<string, unknown>,
  apiKey: string,
): Promise<unknown> {
  const native = getMcp();
  const argsJson = JSON.stringify({...args, apiKey});
  const resultJson = await native.executeTool(name, argsJson);
  return JSON.parse(resultJson);
}