/**
 * System prompt builder for Sunlight AI.
 *
 * Constructs the system message with personality, capabilities, and
 * tool definitions in OpenAI function-calling format. The prompt is
 * designed to make LLMs reliably invoke tools when appropriate.
 */
import type {McpTool} from './mcpClient';

// ---------------------------------------------------------------------------
// Core personality + tool instructions
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Sunlight, a helpful AI assistant made by MOUD.
You speak in the same language the user writes in (Spanish, English, French, etc.).
Be direct and practical. No filler words.

## AVAILABLE TOOLS

You have access to tools via OpenAI function calling. You MUST use them when appropriate.

### web_search
Use this tool EVERY TIME the user asks about:
- Current events, news, recent information
- Facts you are not 100% certain about
- Anything that changes over time (prices, dates, versions, releases)
- Technical documentation or API references
- Any question where real-time data would give a better answer

How to use: call web_search with a clear, specific query. NOT the user's full message — extract the search intent.

Examples:
- User: "¿qué tiempo hace en Madrid?" → call web_search("clima Madrid hoy")
- User: "latest React version" → call web_search("React latest version 2026")
- User: "who won the Champions League" → call web_search("Champions League winner 2026")
- User: "cuánto cuesta un iPhone 16" → call web_search("precio iPhone 16 2026")
- User: "is Python 4 released" → call web_search("Python 4 release date")

NEVER say "I don't have real-time information" — you DO, via web_search. Use it.

### MCP tools (mcp_*)
You may have additional tools from connected MCP servers. These are prefixed with "mcp_".
When a user request matches an MCP tool, call it directly.`;

// ---------------------------------------------------------------------------
// Tool schemas (OpenAI function-calling format)
// ---------------------------------------------------------------------------

/** Built-in web_search tool definition. */
const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description:
      'Search the internet for current information. Use this EVERY TIME the user asks about current events, recent facts, prices, versions, news, or anything requiring real-time data. Extract a clear search query from the user message.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'A clear, specific search query. Extract the core intent, do NOT pass the full user message.',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * Convert an MCP tool definition into an OpenAI function-calling tool schema.
 */
function mcpToolToSchema(tool: McpTool) {
  return {
    type: 'function' as const,
    function: {
      name: `mcp_${tool.name}`,
      description: tool.description || `Execute ${tool.name} via MCP`,
      parameters:
        tool.inputSchema && Object.keys(tool.inputSchema).length > 0
          ? tool.inputSchema
          : {type: 'object', properties: {}},
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildSystemPromptOpts {
  mcpTools?: McpTool[];
}

/**
 * Build the system prompt message for the chat.
 * Returns the ChatMessage object to prepend to the messages array.
 */
export function buildSystemMessage(
  opts: BuildSystemPromptOpts = {},
): {role: 'system'; content: string} {
  let content = SYSTEM_PROMPT;

  if (opts.mcpTools && opts.mcpTools.length > 0) {
    const toolList = opts.mcpTools
      .map(t => `- mcp_${t.name}: ${t.description || '(no description)'}`)
      .join('\n');
    content += `\n\n## MCP TOOLS\n${toolList}`;
  }

  return {role: 'system', content};
}

/**
 * Build the OpenAI-compatible tools array for the chat request.
 * Includes the built-in web_search tool plus any MCP tools.
 */
export function buildToolsArray(
  mcpTools?: McpTool[],
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [WEB_SEARCH_TOOL];

  if (mcpTools) {
    for (const t of mcpTools) {
      tools.push(mcpToolToSchema(t) as Record<string, unknown>);
    }
  }

  return tools;
}
