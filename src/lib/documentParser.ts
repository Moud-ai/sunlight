/**
 * Document parser — supports both local and remote (gateway) parsing.
 *
 * Remote parsing (via gateway) uses @firecrawl/anydoc for high-quality conversion.
 * Local parsing is used as a fallback when gateway is unavailable.
 *
 * Format support:
 *   PDF  → pdf-inspector (remote) or binary extraction (local)
 *   DOCX → mammoth.js
 *   XLSX → xlsx SheetJS
 *   CSV  → papaparse
 *   TXT  → RNFS direct read
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import {request} from '../api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedDocument {
  format: string;
  text: string;
  html?: string;
  structuredData?: (string | number)[][];
  metadata?: Record<string, unknown>;
  pageCount?: number;
  /** Whether this was parsed remotely (gateway) or locally */
  remote?: boolean;
}

// ---------------------------------------------------------------------------
// Remote parsing (gateway)
// ---------------------------------------------------------------------------

/**
 * Parse a document remotely via the gateway's anydoc/pdf-inspector service.
 * Returns null if gateway is unavailable or parsing fails.
 */
async function parseDocumentRemote(
  filePath: string,
  gatewayUrl: string,
): Promise<ParsedDocument | null> {
  try {
    // Read file as base64
    const base64 = await RNFS.readFile(filePath, 'base64');
    const filename = filePath.split('/').pop() || 'document';

    // Detect format for PDF-specific endpoint
    const ext = filename.split('.').pop()?.toLowerCase();
    const endpoint = ext === 'pdf'
      ? `${gatewayUrl}/v1/tools/parse_document/pdf`
      : `${gatewayUrl}/v1/tools/parse_document`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        file: base64,
        filename,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const result = await response.json();
    if (!result.success || !result.markdown) {
      return null;
    }

    return {
      format: ext || 'unknown',
      text: result.markdown,
      remote: true,
      metadata: {
        classification: result.classification,
        confidence: result.confidence,
        ...result.metadata,
      },
    };
  } catch {
    // Gateway unavailable or request failed — fall back to local
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// PDF parser — binary text extraction (local fallback)
// ---------------------------------------------------------------------------

async function parsePdf(filePath: string): Promise<ParsedDocument> {
  try {
    const base64 = await RNFS.readFile(filePath, 'base64');
    const arrayBuffer = base64ToArrayBuffer(base64);
    const bytes = new Uint8Array(arrayBuffer);

    const textChunks: string[] = [];
    const decoder = new TextDecoder('latin1');
    const fullContent = decoder.decode(bytes);

    const btEtPattern = /BT\s([\s\S]*?)\sET/g;
    let match;
    while ((match = btEtPattern.exec(fullContent)) !== null) {
      const block = match[1];
      const tjPattern = /\(([^)]*)\)\s*Tj/g;
      const tjArrayPattern = /\[([^\]]*)\]\s*TJ/g;
      let tjMatch;
      while ((tjMatch = tjPattern.exec(block)) !== null) {
        textChunks.push(tjMatch[1]);
      }
      while ((tjMatch = tjArrayPattern.exec(block)) !== null) {
        const arr = tjMatch[1];
        const strParts = arr.match(/\(([^)]*)\)/g);
        if (strParts) {
          textChunks.push(strParts.map((s: string) => s.slice(1, -1)).join(''));
        }
      }
    }

    if (textChunks.length === 0) {
      const parenPattern = /\(([^)]{3,})\)/g;
      while ((match = parenPattern.exec(fullContent)) !== null) {
        const candidate = match[1];
        const readableRatio = (candidate.match(/[\x20-\x7E]/g)?.length ?? 0) / candidate.length;
        if (readableRatio > 0.7) {
          textChunks.push(candidate);
        }
      }
    }

    const text = textChunks.join('\n').trim();
    const pageCountMatch = fullContent.match(/\/Type\s*\/Page[^s]/g);
    const pageCount = pageCountMatch?.length ?? 1;

    if (text.length > 20) {
      return {format: 'pdf', text, pageCount};
    }

    return {
      format: 'pdf',
      text: `PDF file loaded (${pageCount} pages). Text extraction yielded minimal results — this PDF may contain mostly images or use non-standard encoding.`,
      pageCount,
    };
  } catch {
    return {
      format: 'pdf',
      text: 'Could not read this PDF file. The file may be corrupted or use an unsupported format.',
    };
  }
}

// ---------------------------------------------------------------------------
// DOCX parser — mammoth.js
// ---------------------------------------------------------------------------

async function parseDocx(filePath: string): Promise<ParsedDocument> {
  try {
    const mammoth = require('mammoth');
    const base64 = await RNFS.readFile(filePath, 'base64');
    const arrayBuffer = base64ToArrayBuffer(base64);

    const [{value: html}, {value: text}] = await Promise.all([
      mammoth.convertToHtml({arrayBuffer}),
      mammoth.extractRawText({arrayBuffer}),
    ]);

    return {format: 'docx', text, html};
  } catch (e) {
    return {
      format: 'docx',
      text: `Error reading DOCX: ${e instanceof Error ? e.message : 'unknown'}`,
    };
  }
}

// ---------------------------------------------------------------------------
// XLSX parser — SheetJS
// ---------------------------------------------------------------------------

async function parseXlsx(filePath: string): Promise<ParsedDocument> {
  try {
    const XLSX = require('xlsx');
    const b64 = await RNFS.readFile(filePath, 'base64');
    const workbook = XLSX.read(b64, {type: 'base64'});

    const sheets = workbook.SheetNames.map((name: string) => {
      const sheet = workbook.Sheets[name];
      return {
        name,
        data: XLSX.utils.sheet_to_json(sheet, {header: 1}) as (string | number)[][],
      };
    });

    const lines: string[] = [];
    for (const sheet of sheets) {
      lines.push(`[${sheet.name}]`);
      for (const row of sheet.data.slice(0, 100)) {
        lines.push(row.map(String).join('\t'));
      }
      if (sheet.data.length > 100) {
        lines.push(`... (${sheet.data.length - 100} more rows)`);
      }
      lines.push('');
    }

    return {
      format: 'xlsx',
      text: lines.join('\n'),
      structuredData: sheets[0]?.data,
      metadata: {
        sheetCount: sheets.length,
        sheetNames: workbook.SheetNames,
        totalRows: sheets.reduce((acc: number, s: {data: (string | number)[][]}) => acc + s.data.length, 0),
      },
    };
  } catch (e) {
    return {
      format: 'xlsx',
      text: `Error reading XLSX: ${e instanceof Error ? e.message : 'unknown'}`,
    };
  }
}

// ---------------------------------------------------------------------------
// CSV parser — papaparse
// ---------------------------------------------------------------------------

async function parseCsv(filePath: string): Promise<ParsedDocument> {
  try {
    const Papa = require('papaparse');
    const csvString = await RNFS.readFile(filePath, 'utf8');
    const {data} = Papa.parse(csvString);

    return {
      format: 'csv',
      text: csvString,
      structuredData: data,
      metadata: {
        rowCount: data.length - 1,
        columnCount: data[0]?.length ?? 0,
      },
    };
  } catch (e) {
    return {
      format: 'csv',
      text: `Error reading CSV: ${e instanceof Error ? e.message : 'unknown'}`,
    };
  }
}

// ---------------------------------------------------------------------------
// TXT/MD parser — direct read
// ---------------------------------------------------------------------------

async function parseText(filePath: string): Promise<ParsedDocument> {
  const text = await RNFS.readFile(filePath, 'utf8');
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'txt';
  return {format: ext, text};
}

// ---------------------------------------------------------------------------
// Local parsers (fallback)
// ---------------------------------------------------------------------------

const LOCAL_PARSERS: Record<string, (path: string) => Promise<ParsedDocument>> = {
  pdf: parsePdf,
  docx: parseDocx,
  doc: parseDocx,
  xlsx: parseXlsx,
  xls: parseXlsx,
  xlsm: parseXlsx,
  csv: parseCsv,
  tsv: parseCsv,
  txt: parseText,
  md: parseText,
  rtf: parseText,
  json: parseText,
  html: parseText,
  xml: parseText,
  log: parseText,
};

// ---------------------------------------------------------------------------
// Public API — parseDocument with remote-first, local fallback
// ---------------------------------------------------------------------------

/**
 * Parse a document from a local file path.
 * Tries remote parsing via gateway first (using anydoc/pdf-inspector).
 * Falls back to local parsing if gateway is unavailable.
 *
 * Detects format by extension and uses the appropriate parser.
 * Returns structured content for LLM consumption or display.
 */
export async function parseDocument(
  filePath: string,
  gatewayUrl?: string,
): Promise<ParsedDocument> {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'txt';

  // Try remote parsing first (if gateway URL provided)
  if (gatewayUrl) {
    const remoteResult = await parseDocumentRemote(filePath, gatewayUrl);
    if (remoteResult) {
      return remoteResult;
    }
  }

  // Fall back to local parsing
  const parser = LOCAL_PARSERS[ext];

  if (!parser) {
    try {
      return await parseText(filePath);
    } catch {
      return {
        format: ext,
        text: `Unsupported file format: .${ext}`,
      };
    }
  }

  return parser(filePath);
}
