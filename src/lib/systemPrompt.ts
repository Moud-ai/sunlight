/**
 * System prompt builder for Sunlight AI.
 *
 * Constructs the system message with personality, capabilities, and
 * MCP tool definitions in OpenAI function-calling format.
 */
import type {McpTool} from './mcpClient';

// ---------------------------------------------------------------------------
// Personality
// ---------------------------------------------------------------------------

const PERSONALITY = `You are Sunlight, a helpful, concise AI assistant made by MOUD.
You speak in the same language the user writes in (Spanish, English, French, etc.).
Be direct and practical. No filler. No "Sure!" or "Of course!" — just answer.

When you don't know something, say so clearly. When you can use a tool to get
better information, use it.`;

// ---------------------------------------------------------------------------
// Tool schemas (OpenAI function-calling format)
// ---------------------------------------------------------------------------

/** Built-in web_search tool definition. */
const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description:
      'Search the internet for current information. Use this when the user asks about recent events, facts you are unsure about, or anything that benefits from real-time web data.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up on the web.',
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
      parameters: tool.inputSchema && Object.keys(tool.inputSchema).length > 0
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
  let content = PERSONALITY;

  if (opts.mcpTools && opts.mcpTools.length > 0) {
    const toolList = opts.mcpTools
      .map(t => `- ${t.name}: ${t.description || '(no description)'}`)
      .join('\n');
    content += `\n\nYou have access to external tools via MCP servers:\n${toolList}\n\nWhen a user request matches one of these tools, call it using the function calling mechanism. MCP tool names are prefixed with "mcp_" in the function call.`;
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
