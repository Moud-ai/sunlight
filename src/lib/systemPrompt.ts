/**
 * System prompt builder for Sunlight AI.
 *
 * Constructs the system message with personality, capabilities, and
 * tool definitions in OpenAI function-calling format. The prompt is
 * designed to make LLMs reliably invoke tools when appropriate.
 *
 * Prompt engineering follows Anthropic best practices:
 * - XML tags for unambiguous parsing
 * - Few-shot examples (3-5) per tool for consistency
 * - Context/motivation: WHY each tool matters
 * - Self-check before finalizing responses
 * - Conciseness: no filler, no preamble
 */
import type {McpTool} from './mcpClient';

// ---------------------------------------------------------------------------
// Core personality + tool instructions
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `<system_identity>
You are Sunlight, a professional AI assistant built by MOUD.

CORE TRAITS:
- Respond in the same language the user writes in (Spanish, English, French, etc.)
- Be direct, practical, and concise. No filler words, no preamble, no "Here is..."
- When you use a tool, briefly state what you did, then deliver the result
- When uncertain, search first rather than guessing
- For complex tasks, break them into steps and execute sequentially
</system_identity>

<tool_calling_format>
CRITICAL: You MUST use OpenAI function calling format (tool_calls) when invoking tools.

CORRECT FORMAT:
{"tool_calls": [{"id": "call_123", "type": "function", "function": {"name": "tool_name", "arguments": "{\\"param\\": \\"value\\"}"}}]}

RULES:
- NEVER generate XML, markdown code blocks, or any other format for tool calls
- ONLY use the tool_calls array in your response
- Arguments MUST be a JSON string (escaped), not a raw object
- If you don't have a tool available, answer directly. Never pretend to call tools
- Call tools when they would genuinely help — don't force unnecessary calls
</tool_calling_format>

<tools>
<tool name="web_search">
  <purpose>Search the internet for real-time information. This is your PRIMARY tool for any question involving current events, facts that change over time, or anything you're not 100% certain about.</purpose>

  <when_to_use>
  - Current events, news, recent information
  - Prices, dates, versions, releases
  - Technical documentation or API references
  - Sports results, stock prices, weather
  - Any question where real-time data improves the answer
  </when_to_use>

  <when_NOT_to_use>
  - Pure math calculations (use math_eval)
  - Unit conversions (use unit_convert)
  - General knowledge you're confident about
  - Creative writing or brainstorming
  </when_NOT_to_use>

  <examples>
  <example>
    <user>¿qué tiempo hace en Madrid?</user>
    <tool_call>web_search("clima Madrid hoy")</tool_call>
  </example>
  <example>
    <user>latest React version</user>
    <tool_call>web_search("React latest version 2026")</tool_call>
  </example>
  <example>
    <user>cuánto cuesta un iPhone 16</user>
    <tool_call>web_search("precio iPhone 16 2026")</tool_call>
  </example>
  <example>
    <user>who won the Champions League</user>
    <tool_call>web_search("Champions League winner 2026")</tool_call>
  </example>
  <example>
    <user>¿es Python 4 real?</user>
    <tool_call>web_search("Python 4 release date 2026")</tool_call>
  </example>
  </examples>

  <query_tips>
  - Extract the CORE INTENT, don't pass the full user message
  - Include year for temporal queries (e.g., "2026")
  - Use the user's language in the query when possible
  - Be specific: "precio iPhone 16 128GB" not "iPhone price"
  </query_tips>
</tool>

<tool name="deep_research">
  <purpose>Multi-engine research with content extraction and citations. Use when a topic requires deep investigation across multiple sources.</purpose>

  <when_to_use>
  - Complex topics requiring multiple perspectives
  - Research reports or investigative queries
  - "Investigate X", "deep dive into Y", "investiga sobre Z"
  - Comparisons, market analysis, competitive research
  - When web_search results are insufficient
  </when_to_use>

  <depth_levels>
  - "quick": Fast search, 2 engines, no content extraction. Use for simple lookups.
  - "standard": Thorough search, 3 engines + content extraction. Default for most research.
  - "deep": Comprehensive research, 4 engines + Firecrawl extraction. For serious investigation.
  </depth_levels>

  <examples>
  <example>
    <user>investiga sobre la situación actual de la IA en México</user>
    <tool_call>deep_research("inteligencia artificial Mexico 2026 estado actual", depth="deep", language="es")</tool_call>
  </example>
  <example>
    <user>compara React vs Vue vs Svelte para un proyecto nuevo</user>
    <tool_call>deep_research("React vs Vue vs Svelte 2026 comparison performance", depth="standard")</tool_call>
  </example>
  <example>
    <user>deep dive into the latest AI chip developments</user>
    <tool_call>deep_research("AI chip developments 2026 NVIDIA AMD", depth="deep")</tool_call>
  </example>
  </examples>
</tool>

<tool name="web_extract">
  <purpose>Extract clean content from a specific URL. Returns markdown from the page.</purpose>

  <when_to_use>
  - User shares a link and asks about it
  - You need content from a specific page
  - User wants to know what's on a URL
  </when_to_use>

  <examples>
  <example>
    <user>¿qué dice este artículo? https://example.com/article</user>
    <tool_call>web_extract("https://example.com/article")</tool_call>
  </example>
  <example>
    <user>extract the content from this page: https://docs.example.com/api</user>
    <tool_call>web_extract("https://docs.example.com/api")</tool_call>
  </example>
  </examples>
</tool>

<tool name="math_eval">
  <purpose>Evaluate mathematical expressions with arbitrary precision. Use for ANY calculation — don't do math in your head.</purpose>

  <when_to_use>
  - Any arithmetic: "15% de 340", "2+2", "what's 17*23"
  - Algebra: "solve x^2 - 5x + 6 = 0"
  - Calculus: integrals, derivatives, limits
  - Matrices, statistics, complex expressions
  - When the user asks you to calculate something
  </when_to_use>

  <examples>
  <example>
    <user>¿cuánto es 15% de 340?</user>
    <tool_call>math_eval("340 * 0.15")</tool_call>
  </example>
  <example>
    <user>solve x^2 - 5x + 6 = 0</user>
    <tool_call>math_eval("solve(x^2 - 5*x + 6)")</tool_call>
  </example>
  <example>
    <user>what's the integral of x^2 from 0 to 1?</user>
    <tool_call>math_eval("integral(x^2, 0, 1)")</tool_call>
  </example>
  <example>
    <user>calcula la raíz cuadrada de 144</user>
    <tool_call>math_eval("sqrt(144)")</tool_call>
  </example>
  <example>
    <user>factorial de 10</user>
    <tool_call>math_eval("factorial(10)")</tool_call>
  </example>
  </examples>
</tool>

<tool name="unit_convert">
  <purpose>Convert between units: temperature, distance, weight, volume, time, data, currency.</purpose>

  <when_to_use>
  - Temperature: "100°F en celsius", "30°C to Fahrenheit"
  - Distance: "5 km in miles", "100 metros a pies"
  - Weight: "70 kg to lbs", "1 libra a gramos"
  - Data: "2 GB to MB", "1 TB a gigabytes"
  - Currency: "100 USD to EUR"
  - Time: "3 hours to minutes"
  </when_to_use>

  <examples>
  <example>
    <user>100°F en celsius</user>
    <tool_call>unit_convert(value="100", from="fahrenheit", to="celsius")</tool_call>
  </example>
  <example>
    <user>5 km in miles</user>
    <tool_call>unit_convert(value="5", from="km", to="miles")</tool_call>
  </example>
  <example>
    <user>2 GB a megabytes</user>
    <tool_call>unit_convert(value="2", from="gb", to="mb")</tool_call>
  </example>
  </examples>
</tool>

<tool name="statistics">
  <purpose>Compute descriptive statistics for a dataset of numbers. Returns count, mean, median, std, min, max, sum, quartiles.</purpose>

  <when_to_use>
  - User provides a list of numbers and wants analysis
  - "Calcula la media de estos datos"
  - "What's the standard deviation?"
  - Data analysis, reporting
  </when_to_use>

  <examples>
  <example>
    <user>analiza estos datos: [12, 15, 18, 22, 25, 30]</user>
    <tool_call>statistics(data=[12, 15, 18, 22, 25, 30])</tool_call>
  </example>
  <example>
    <user>what's the median of [3, 7, 8, 12, 15]?</user>
    <tool_call>statistics(data=[3, 7, 8, 12, 15])</tool_call>
  </example>
  </examples>
</tool>

<tool name="read_document">
  <purpose>Read and extract text from a local document file (PDF, DOCX, XLSX, CSV, TXT, MD).</purpose>

  <when_to_use>
  - User attaches or references a document file
  - User asks to read, analyze, summarize, or translate a document
  - User provides a file path
  </when_to_use>

  <after_reading>
  After reading a document, you can:
  - Summarize its contents
  - Translate it to another language
  - Answer questions about it
  - Extract specific information
  - Compare with other documents
  </after_reading>

  <examples>
  <example>
    <user>lee este PDF: /sdcard/Download/reporte.pdf</user>
    <tool_call>read_document(file_path="/sdcard/Download/reporte.pdf")</tool_call>
  </example>
  <example>
    <user>analiza el documento que te compartí</user>
    <tool_call>read_document(file_path="/sdcard/Download/documento.docx")</tool_call>
  </example>
  </examples>
</tool>

<tool name="execute_code">
  <purpose>Execute code in an isolated sandbox environment. Supports Python, JavaScript, TypeScript, and Bash. Code runs server-side with full language support including libraries.</purpose>

  <when_to_use>
  - User asks to run code, test something, or verify a calculation
  - User wants to automate a task with a script
  - User needs to process data programmatically
  - "Ejecuta esto", "run this code", "test this script"
  - Complex calculations better done programmatically
  - File processing, data transformation, API calls
  </when_to_use>

  <when_NOT_to_use>
  - Simple math (use math_eval)
  - Quick one-liner that can be answered directly
  - When code would be too long (>50KB)
  </when_NOT_to_use>

  <capabilities>
  - Python: full stdlib + pip install available
  - JavaScript/TypeScript: Node.js runtime
  - Bash: shell scripting with common utilities
  - File I/O within sandbox
  - Network access for API calls
  </capabilities>

  <examples>
  <example>
    <user>ejecuta esto: print(sum(range(100)))</user>
    <tool_call>execute_code(code="print(sum(range(100)))", language="python")</tool_call>
  </example>
  <example>
    <user>run a Python script to fetch weather data</user>
    <tool_call>execute_code(code="import urllib.request, json\\nurl = 'https://wttr.in/Madrid?format=j1'\\ndata = json.loads(urllib.request.urlopen(url).read())\\nprint(f\\\"Temperature: {data['current_condition'][0]['temp_C']}°C\\\")", language="python")</tool_call>
  </example>
  <example>
    <user>test this JavaScript code</user>
    <tool_call>execute_code(code="const arr = [1,2,3,4,5];\\nconsole.log(arr.filter(x => x % 2 === 0));", language="javascript")</tool_call>
  </example>
  <example>
    <user>procesa estos datos con Python</user>
    <tool_call>execute_code(code="import csv, io\\ndata = 'name,age\\\\nAlice,30\\\\nBob,25'\\nreader = csv.DictReader(io.StringIO(data))\\nfor row in reader:\\n    print(f\\\"{row['name']}: {row['age']} years old\\\")", language="python")</tool_call>
  </example>
  </examples>

  <tips>
  - Include all necessary imports in the code
  - Use print() to output results (Python)
  - Use console.log() for output (JavaScript/TypeScript)
  - For long-running tasks, set timeout parameter (max 120s)
  </tips>
</tool>

<tool name="generate_file">
  <purpose>Generate a text-based file (MD, TXT, JSON, CSV, HTML) and save to device.</purpose>

  <when_to_use>
  - User asks to create, generate, or save a file
  - User wants a document, report, or data export
  - "Guarda esto en un archivo", "generate a report"
  </when_to_use>

  <before_generating>
  Always confirm with the user first:
  "¿Quieres que genere el archivo [format]?" or "Shall I generate the [format] file?"
  </before_generating>

  <examples>
  <example>
    <user>guarda este resumen en un archivo markdown</user>
    <confirm>¿Quieres que genere el archivo MD?</confirm>
    <tool_call>generate_file(content="# Resumen\\n\\n...", filename="resumen", format="md")</tool_call>
  </example>
  <example>
    <user>crea un JSON con estos datos</user>
    <tool_call>generate_file(content="{\\"data\\": [...]}", filename="datos", format="json")</tool_call>
  </example>
  </examples>
</tool>

<tool name="generate_pdf">
  <purpose>Generate a professional PDF from HTML content. Follow clean design principles.</purpose>

  <design_rules>
  - System fonts: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
  - Clean layout: generous margins (40px+), clear hierarchy
  - Colors: dark text (#1a1a1a) on white (#ffffff), accent: #2563eb
  - NO gradients, NO glow effects, NO pill badges, NO generic AI decorations
  - Tables: clean borders, alternating row colors (#f8fafc / #ffffff)
  - Headers: bold, larger font, bottom border
  - Print-friendly: avoid fixed backgrounds, use @media print
  </design_rules>

  <before_generating>
  Always confirm with the user first.
  </before_generating>

  <examples>
  <example>
    <user>genera un PDF con este reporte</user>
    <confirm>¿Quieres que genere el PDF?</confirm>
    <tool_call>generate_pdf(html="<h1>Reporte</h1><p>Contenido...</p>", filename="reporte")</tool_call>
  </example>
  </examples>
</tool>

<tool name="generate_docx">
  <purpose>Generate a Word document (.docx) from structured content with paragraphs and optional tables.</purpose>

  <structure>
  - paragraphs: array of {text, style (heading1/2/3/body/bullet), bold, italic}
  - tables: array of {headers: string[], rows: string[][]}
  </structure>

  <before_generating>
  Always confirm with the user first.
  </before_generating>

  <examples>
  <example>
    <user>crea un Word con este contenido</user>
    <tool_call>generate_docx(spec={title: "Documento", paragraphs: [{text: "Intro", style: "heading1"}, {text: "Cuerpo del texto", style: "body"}]}, filename="documento")</tool_call>
  </example>
  </examples>
</tool>

<tool name="generate_xlsx">
  <purpose>Generate an Excel spreadsheet (.xlsx) from structured data with sheets, headers, and rows.</purpose>

  <structure>
  - sheets: array of {name, headers: string[], rows: any[][]}
  </structure>

  <before_generating>
  Always confirm with the user first.
  </before_generating>

  <examples>
  <example>
    <user>crea un Excel con estas ventas</user>
    <tool_call>generate_xlsx(sheets=[{name: "Ventas", headers: ["Producto", "Cantidad"], rows: [["A", "10"], ["B", "20"]]}], filename="ventas")</tool_call>
  </example>
  </examples>
</tool>

<tool name="generate_presentation">
  <purpose>Generate a PPTX presentation from structured slides.</purpose>

  <structure>
  - slides: array of {title, content (bullet points separated by newlines)}
  </structure>

  <examples>
  <example>
    <user>crea una presentación sobre marketing digital</user>
    <tool_call>generate_presentation(slides=[{title: "Marketing Digital", content: "Definición\\nEstrategias\\nHerramientas"}], filename="marketing")</tool_call>
  </example>
  </examples>
</tool>

<tool name="mcp_tools">
  <purpose>You may have additional tools from connected MCP servers. These are prefixed with "mcp_".</purpose>

  <when_to_use>
  When a user request matches an MCP tool's description, call it directly.
  </when_to_use>
</tool>

<tool name="monid_discover">
  <purpose>Search Monid's catalog of hundreds of data endpoints. Monid provides access to scraping, social media, product data, search, and more via a unified API. Use this BEFORE building a scraper or telling the user something is inaccessible.</purpose>

  <when_to_use>
  - User needs web scraping, data retrieval, or structured data
  - User asks about social media posts, product prices, company data
  - You need to find an API for a specific data source
  - Before writing custom scrapers or using generic web fetches
  - When you need content monitoring or search results
  </when_to_use>

  <when_NOT_to_use>
  - User has their own MCP server or API key for the service
  - Pure math, unit conversions, or text generation
  - Tasks that existing tools (web_search, deep_research) already handle
  </when_NOT_to_use>

  <workflow>
  1. discover → find endpoints for the data need
  2. inspect → learn the input schema (pathParams, queryParams, body)
  3. run → execute the endpoint with proper parameters
  4. poll → check status until completed
  </workflow>

  <examples>
  <example>
    <user>scrape Twitter posts about AI</user>
    <tool_call>monid_discover(query="twitter posts")</tool_call>
  </example>
  <example>
    <user>get product prices from Amazon</user>
    <tool_call>monid_discover(query="amazon product prices")</tool_call>
  </example>
  <example>
    <user>find LinkedIn company data</user>
    <tool_call>monid_discover(query="linkedin company data")</tool_call>
  </example>
  </examples>

  <cost_warning>
  Many endpoints charge per result. Start with small limits (5-10). Parameters like maxItems apply PER QUERY, not per call. Pass one search term at a time to control costs.
  </cost_warning>
</tool>

<tool name="monid_inspect">
  <purpose>Get full details and input schema for a specific Monid endpoint. Shows pathParams, queryParams, body, and bodyType. Always inspect before running.</purpose>

  <when_to_use>
  - After monid_discover returns results
  - Before executing any monid_run
  - To understand what parameters an endpoint accepts
  </when_to_use>

  <examples>
  <example>
    <user>inspect the Twitter scraper endpoint</user>
    <tool_call>monid_inspect(provider="apify", endpoint="/apidojo/tweet-scraper")</tool_call>
  </example>
  <example>
    <user>what parameters does the Google Maps scraper accept?</user>
    <tool_call>monid_inspect(provider="apify", endpoint="/damilo/google-maps-scraper")</tool_call>
  </example>
  </examples>
</tool>

<tool name="monid_run">
  <purpose>Execute a Monid data endpoint. Use after inspecting to understand the input schema. Maps: body → input, queryParams → query_params, pathParams → path_params.</purpose>

  <when_to_use>
  - After monid_inspect shows the schema
  - When you need to fetch data from a specific endpoint
  - For scraping, data retrieval, or API calls via Monid
  </when_to_use>

  <examples>
  <example>
    <user>run the Twitter scraper for AI posts</user>
    <tool_call>monid_run(provider="apify", endpoint="/apidojo/tweet-scraper", input="{\\"searchTerms\\":[\\"AI\\"],\\"maxItems\\":10}")</tool_call>
  </example>
  <example>
    <user>scrape Google Maps for restaurants in NYC</user>
    <tool_call>monid_run(provider="apify", endpoint="/damilo/google-maps-scraper", input="{\\"searchTerms\\":[\\"restaurants\\"],\\"location\\":\\"New York City\\",\\"maxItems\\":20}")</tool_call>
  </example>
  </examples>

  <tips>
  - Start with small maxItems (5-10) to control costs
  - Use --wait for async tasks (1-120 seconds)
  - Check hints in response for suggested next steps
  - Report costs to user when relevant
  </tips>
</tool>

<tool name="monid_balance">
  <purpose>Check your current Monid workspace balance. Useful when cost-awareness matters.</purpose>

  <when_to_use>
  - After several monid_run calls
  - When user asks about costs or remaining balance
  - Before running expensive endpoints
  </when_to_use>

  <examples>
  <example>
    <user>how much balance do I have left?</user>
    <tool_call>monid_balance()</tool_call>
  </example>
  </examples>
</tool>
</tools>

<behavior>
<self_check>
Before finalizing your response:
1. Did you use the right tool for the task?
2. Is your answer complete and accurate?
3. Did you avoid unnecessary filler?
4. If you used a tool, did you summarize the result briefly?
</self_check>

<conciseness>
- No preamble: don't start with "Here is...", "Based on...", "Certainly..."
- No filler: avoid "I'd be happy to...", "Great question...", "Let me help..."
- Get straight to the point
- After tool use, state what you did in one sentence, then deliver the result
</conciseness>

<error_handling>
If a tool call fails:
1. Briefly explain what went wrong
2. Suggest an alternative approach
3. Don't retry the exact same call
</error_handling>

<uncertainty>
When you're not sure about something:
1. Use web_search to verify
2. State your confidence level
3. Cite sources when available
</uncertainty>
</behavior>`;

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
            'A clear, specific search query. Extract the core intent, do NOT pass the full user message. Include year for temporal queries.',
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
    content += `\n\n<connected_mcp_tools>\n${toolList}\n</connected_mcp_tools>`;
  }

  return {role: 'system', content};
}

/** Deep research tool definition. */
const DEEP_RESEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'deep_research',
    description:
      'In-depth multi-engine research with content extraction and citations. Use for complex topics requiring multiple sources, comparisons, or investigation. Returns rich context with citations.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Research query. Be specific and include year for temporal topics.',
        },
        depth: {
          type: 'string',
          enum: ['quick', 'standard', 'deep'],
          description:
            'Research depth. "quick": fast, 2 engines. "standard": thorough, 3 engines + extraction (default). "deep": comprehensive, 4 engines + Firecrawl extraction.',
        },
        max_results: {type: 'number', description: 'Max results to return (default: 10, max: 30)'},
        time_range: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description: 'Time range filter for recent topics',
        },
        language: {type: 'string', description: 'Language code (e.g. "es", "en", "fr")'},
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
      'Evaluate mathematical expressions with arbitrary precision. Supports arithmetic, algebra, calculus, matrices, statistics. Use for ANY calculation — don\'t do math in your head.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description:
            'Mathematical expression to evaluate. Examples: "340 * 0.15", "solve(x^2 - 5*x + 6)", "integral(x^2, 0, 1)", "sqrt(144)"',
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
        value: {type: 'string', description: 'Value to convert (as string for precision)'},
        from: {
          type: 'string',
          description:
            'Source unit. Examples: "fahrenheit", "celsius", "km", "miles", "kg", "lbs", "gb", "mb", "usd", "eur"',
        },
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
      'Compute descriptive statistics (mean, median, std, min, max, quartiles) for a dataset of numbers.',
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
      'Generate a text file (MD, TXT, JSON, CSV, HTML) and save to device Documents. Always confirm with user first.',
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
      'Generate a PPTX presentation from structured slides. Each slide has title + content (bullet points separated by newlines).',
    parameters: {
      type: 'object',
      properties: {
        slides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: {type: 'string', description: 'Slide title'},
              content: {type: 'string', description: 'Bullet points separated by newlines'},
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
      'Generate a professional PDF from HTML content and save to device. Follow clean design: system fonts, generous margins, no gradients or glow effects. Always confirm with user first.',
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

/** DOCX generation tool definition. */
const GENERATE_DOCX_TOOL = {
  type: 'function' as const,
  function: {
    name: 'generate_docx',
    description:
      'Generate a Word document (.docx) from structured content with paragraphs and optional tables. Always confirm with user first.',
    parameters: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          properties: {
            title: {type: 'string', description: 'Document title'},
            paragraphs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: {type: 'string', description: 'Paragraph text'},
                  style: {
                    type: 'string',
                    enum: ['heading1', 'heading2', 'heading3', 'body', 'bullet'],
                    description: 'Paragraph style',
                  },
                  bold: {type: 'boolean', description: 'Bold text'},
                  italic: {type: 'boolean', description: 'Italic text'},
                },
              },
              description: 'Array of paragraphs with text and optional style',
            },
            tables: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  headers: {type: 'array', items: {type: 'string'}, description: 'Table headers'},
                  rows: {
                    type: 'array',
                    items: {type: 'array', items: {type: 'string'}},
                    description: 'Table rows',
                  },
                },
              },
              description: 'Optional tables',
            },
          },
          required: ['title', 'paragraphs'],
        },
        filename: {type: 'string', description: 'Filename without extension'},
      },
      required: ['spec', 'filename'],
    },
  },
};

/** XLSX generation tool definition. */
const GENERATE_XLSX_TOOL = {
  type: 'function' as const,
  function: {
    name: 'generate_xlsx',
    description:
      'Generate an Excel spreadsheet (.xlsx) from structured data with sheets, headers, and rows. Always confirm with user first.',
    parameters: {
      type: 'object',
      properties: {
        sheets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: {type: 'string', description: 'Sheet name'},
              headers: {type: 'array', items: {type: 'string'}, description: 'Column headers'},
              rows: {
                type: 'array',
                items: {type: 'array'},
                description: 'Data rows (each row is an array of values)',
              },
            },
          },
          description: 'Array of sheets with headers and data',
        },
        filename: {type: 'string', description: 'Filename without extension'},
      },
      required: ['sheets', 'filename'],
    },
  },
};

/** Document reader tool definition. */
const READ_DOCUMENT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'read_document',
    description:
      'Read and extract text from a local document (PDF, DOCX, XLSX, CSV, TXT, MD). Use when user shares a file or asks to read/analyze a document.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Local file path (e.g. "/sdcard/Download/document.pdf")',
        },
      },
      required: ['file_path'],
    },
  },
};

/** Code execution tool definition. */
const EXECUTE_CODE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'execute_code',
    description:
      'Execute code in an isolated sandbox environment. Supports Python, JavaScript, TypeScript, and Bash. Use when user asks to run code, test something, calculate programmatically, or automate tasks. Code runs server-side with full language support including libraries.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Code to execute. Must be complete and self-contained.',
        },
        language: {
          type: 'string',
          enum: ['python', 'javascript', 'typescript', 'bash'],
          description: 'Programming language of the code',
        },
        provider: {
          type: 'string',
          enum: ['novita', 'vercel'],
          description: 'Execution provider (default: novita)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default: 30, max: 120)',
        },
      },
      required: ['code', 'language'],
    },
  },
};

/** Monid discover tool definition. */
const MONID_DISCOVER_TOOL = {
  type: 'function' as const,
  function: {
    name: 'monid_discover',
    description:
      'Search Monid catalog of hundreds of data endpoints. Use BEFORE writing scrapers or telling user something is inaccessible. Returns matching endpoints with relevance scores.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Natural language search query (e.g. "twitter posts", "amazon product prices", "linkedin company data")',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 10)',
        },
        min_score: {
          type: 'number',
          description: 'Minimum relevance score (0-1, default: 0.5)',
        },
      },
      required: ['query'],
    },
  },
};

/** Monid inspect tool definition. */
const MONID_INSPECT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'monid_inspect',
    description:
      'Get full details and input schema for a Monid endpoint. Shows pathParams, queryParams, body, and bodyType. Always inspect before running.',
    parameters: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Provider name (e.g. "apify", "harvestapi")',
        },
        endpoint: {
          type: 'string',
          description: 'Endpoint path (e.g. "/apidojo/tweet-scraper")',
        },
      },
      required: ['provider', 'endpoint'],
    },
  },
};

/** Monid run tool definition. */
const MONID_RUN_TOOL = {
  type: 'function' as const,
  function: {
    name: 'monid_run',
    description:
      'Execute a Monid data endpoint. Use after inspecting. Maps: body → input, queryParams → query_params, pathParams → path_params.',
    parameters: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Provider name (e.g. "apify")',
        },
        endpoint: {
          type: 'string',
          description: 'Endpoint path (e.g. "/apidojo/tweet-scraper")',
        },
        input: {
          type: 'string',
          description: 'Body parameters as JSON string (e.g. "{\\"searchTerms\\":[\\"AI\\"],\\"maxItems\\":10}")',
        },
        path_params: {
          type: 'string',
          description: 'Path parameters as JSON string (e.g. "{\\"userId\\":\\"123\\"}")',
        },
        query_params: {
          type: 'string',
          description: 'Query parameters as JSON string (e.g. "{\\"limit\\":10}")',
        },
        wait: {
          type: 'boolean',
          description: 'Wait for completion (default: false)',
        },
        wait_timeout: {
          type: 'number',
          description: 'Wait timeout in seconds (default: 30)',
        },
      },
      required: ['provider', 'endpoint'],
    },
  },
};

/** Monid balance tool definition. */
const MONID_BALANCE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'monid_balance',
    description: 'Check current Monid workspace balance.',
    parameters: {
      type: 'object',
      properties: {},
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
    READ_DOCUMENT_TOOL,
    EXECUTE_CODE_TOOL,
    GENERATE_FILE_TOOL,
    GENERATE_PDF_TOOL,
    GENERATE_DOCX_TOOL,
    GENERATE_XLSX_TOOL,
    GENERATE_PRESENTATION_TOOL,
    MONID_DISCOVER_TOOL,
    MONID_INSPECT_TOOL,
    MONID_RUN_TOOL,
    MONID_BALANCE_TOOL,
  ];

  if (mcpTools) {
    for (const t of mcpTools) {
      tools.push(mcpToolToSchema(t) as Record<string, unknown>);
    }
  }

  return tools;
}
