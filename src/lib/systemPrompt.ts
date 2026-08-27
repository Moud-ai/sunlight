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

## CRITICAL: TOOL CALLING FORMAT

You MUST use OpenAI function calling format (tool_calls) when invoking tools.
NEVER generate XML, markdown code blocks, or any other format for tool calls.
ONLY use the tool_calls array in your response.

When you need a tool, include it in your response like:
{"tool_calls": [{"id": "call_123", "type": "function", "function": {"name": "tool_name", "arguments": "{...}"}}]}

If you don't have a tool available, just answer directly. Never pretend to call tools.

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

### deep_research
Use for in-depth research requiring multiple sources. Returns rich context with citations.
- depth "quick": fast search, 2 engines
- depth "standard": thorough search, 3 engines + content extraction
- depth "deep": comprehensive research, 4 engines + Firecrawl extraction

Use deep_research for: complex topics, multi-faceted questions, research reports, "investigate X", "deep dive into Y".

### web_extract
Extract clean content from a specific URL. Use when user shares a link or asks about a page.
Returns markdown content from the URL.

### math_eval
Evaluate mathematical expressions with arbitrary precision. Use for ANY calculation.
Supports: arithmetic, algebra, calculus, matrices, statistics, unit conversion.
- User: "¿cuánto es 15% de 340?" → call math_eval("340 * 0.15")
- User: "solve x^2 - 5x + 6 = 0" → call math_eval("solve(x^2 - 5*x + 6)")
- User: "integral of x^2 from 0 to 1" → call math_eval("integral(x^2, 0, 1)")

### unit_convert
Convert between units: temperature, distance, weight, volume, time, data, currency.
- User: "100°F en celsius" → call unit_convert(value="100", from="fahrenheit", to="celsius")
- User: "5 km in miles" → call unit_convert(value="5", from="km", to="miles")
- User: "100 USD to EUR" → call unit_convert(value="100", from="usd", to="eur")

### statistics
Compute descriptive statistics for a dataset. Pass an array of numbers.
Returns: count, mean, median, std, min, max, sum, quartiles.

### generate_file
Generate a text-based file (MD, TXT, JSON, CSV, HTML) and save to device.
Always confirm with user before generating. Ask: "¿Quieres que genere el archivo [format]?"

### generate_presentation
Generate a PPTX presentation from structured slides.
Each slide has title + content (bullet points separated by newlines).

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

/** Deep research tool definition. */
const DEEP_RESEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'deep_research',
    description:
      'In-depth multi-engine research with content extraction and citations. Use for complex topics requiring multiple sources.',
    parameters: {
      type: 'object',
      properties: {
        query: {type: 'string', description: 'Research query'},
        depth: {
          type: 'string',
          enum: ['quick', 'standard', 'deep'],
          description: 'Research depth (default: standard)',
        },
        max_results: {type: 'number', description: 'Max results (default: 10)'},
        time_range: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description: 'Time range filter',
        },
        language: {type: 'string', description: 'Language code (e.g. "es", "en")'},
      },
      required: ['query'],
    },
  },
};

/** Web extract tool definition. */
const WEB_EXTRACT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_extract',
    description:
      'Extract clean content from a URL as markdown. Use when user shares a link or asks about a specific page.',
    parameters: {
      type: 'object',
      properties: {
        url: {type: 'string', description: 'URL to extract content from'},
      },
      required: ['url'],
    },
  },
};

/** Math evaluation tool definition. */
const MATH_EVAL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'math_eval',
    description:
      'Evaluate mathematical expressions with arbitrary precision. Supports arithmetic, algebra, calculus, matrices, statistics.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression to evaluate',
        },
      },
      required: ['expression'],
    },
  },
};

/** Unit conversion tool definition. */
const UNIT_CONVERT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'unit_convert',
    description:
      'Convert between units: temperature, distance, weight, volume, time, data, currency.',
    parameters: {
      type: 'object',
      properties: {
        value: {type: 'string', description: 'Value to convert'},
        from: {type: 'string', description: 'Source unit'},
        to: {type: 'string', description: 'Target unit'},
      },
      required: ['value', 'from', 'to'],
    },
  },
};

/** Statistics tool definition. */
const STATISTICS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'statistics',
    description:
      'Compute descriptive statistics (mean, median, std, min, max, quartiles) for a dataset.',
    parameters: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {type: 'number'},
          description: 'Array of numbers to analyze',
        },
      },
      required: ['data'],
    },
  },
};

/** File generation tool definition. */
const GENERATE_FILE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'generate_file',
    description:
      'Generate a text file (MD, TXT, JSON, CSV, HTML) and save to device Documents.',
    parameters: {
      type: 'object',
      properties: {
        content: {type: 'string', description: 'File content'},
        filename: {type: 'string', description: 'Filename without extension'},
        format: {
          type: 'string',
          enum: ['md', 'txt', 'json', 'csv', 'html'],
          description: 'File format',
        },
      },
      required: ['content', 'filename', 'format'],
    },
  },
};

/** Presentation generation tool definition. */
const GENERATE_PRESENTATION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'generate_presentation',
    description:
      'Generate a PPTX presentation from structured slides.',
    parameters: {
      type: 'object',
      properties: {
        slides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: {type: 'string'},
              content: {type: 'string'},
            },
          },
          description: 'Array of slides with title and content',
        },
        filename: {type: 'string', description: 'Filename without extension'},
      },
      required: ['slides', 'filename'],
    },
  },
};

/** PDF generation tool definition. */
const GENERATE_PDF_TOOL = {
  type: 'function' as const,
  function: {
    name: 'generate_pdf',
    description:
      'Generate a PDF document from HTML content and save to device.',
    parameters: {
      type: 'object',
      properties: {
        html: {type: 'string', description: 'HTML content to render as PDF'},
        filename: {type: 'string', description: 'Filename without extension'},
      },
      required: ['html', 'filename'],
    },
  },
};

/**
 * Build the OpenAI-compatible tools array for the chat request.
 * Includes built-in tools plus any MCP tools.
 */
export function buildToolsArray(
  mcpTools?: McpTool[],
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [
    WEB_SEARCH_TOOL,
    DEEP_RESEARCH_TOOL,
    WEB_EXTRACT_TOOL,
    MATH_EVAL_TOOL,
    UNIT_CONVERT_TOOL,
    STATISTICS_TOOL,
    GENERATE_FILE_TOOL,
    GENERATE_PDF_TOOL,
    GENERATE_PRESENTATION_TOOL,
  ];

  if (mcpTools) {
    for (const t of mcpTools) {
      tools.push(mcpToolToSchema(t) as Record<string, unknown>);
    }
  }

  return tools;
}
