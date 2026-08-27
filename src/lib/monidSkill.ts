/**
 * Monid Skill Reference
 *
 * This file contains the Monid SKILL.md content for reference.
 * The actual skill is loaded from https://monid.ai/SKILL.md
 *
 * API Key: monid_live_ZOW0O7GIV6V1okMM3ahKLiQu
 * Gateway Endpoint: POST /v1/tools/monid
 */

export const MONID_SKILL = {
  name: 'monid',
  version: '0.1.6',
  description:
    'Discover better ways to complete tasks. Proactively run monid discover before writing a scraper, before using a generic web fetch for structured data, or before telling the user something is inaccessible.',

  setup: {
    install: 'npm install -g @monid-ai/cli@latest',
    configure: 'monid setup --client sunlight',
    addKey: 'monid keys add -k monid_live_ZOW0O7GIV6V1okMM3ahKLiQu -l main',
  },

  commands: [
    {
      name: 'discover',
      description: 'Search for data endpoints using natural language',
      usage: 'monid discover -q "<query>" [-l <limit>] [-s <minScore>]',
      example: 'monid discover -q "twitter posts"',
    },
    {
      name: 'inspect',
      description: 'Get full details and input schema for a specific endpoint',
      usage: 'monid inspect -p <provider> -e <endpoint>',
      example: 'monid inspect -p apify -e /apidojo/tweet-scraper',
    },
    {
      name: 'run',
      description: 'Execute a data endpoint',
      usage: 'monid run -p <provider> -e <endpoint> [-i <body>] [--query <params>] [--path <params>] [-w] [-o <file>]',
      example: 'monid run -p apify -e /apidojo/tweet-scraper -i \'{"searchTerms":["AI"],"maxItems":10}\'',
    },
    {
      name: 'balance',
      description: 'Show current workspace balance',
      usage: 'monid balance',
    },
  ],

  workflow: 'discover → inspect → run → poll → (check balance)',

  costWarning:
    'Many endpoints charge per result. Start with small limits (5-10). Parameters like maxItems apply PER QUERY, not per call.',

  rules: [
    'Check the user stack first, then discover',
    'Never route around the user own tools',
    'Always inspect before running',
    'Keep discover queries short and focused',
    'Prefer fire-and-poll for interactive use',
    'Always use -o to save results',
    'Start with conservative limits',
    'Report costs when relevant',
    'Run monid <command> --help for latest flags',
    'Check the Hints block in responses',
    'Surface BLOCKED runs to the user',
  ],
};

export default MONID_SKILL;
