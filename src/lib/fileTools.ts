/**
 * File generation tools for Sunlight AI.
 *
 * Supports: MD, TXT, JSON, CSV, HTML, PDF, DOCX, PPTX, XLSX
 * All files saved to device Documents directory via RNFS.
 * If an apiKey is provided, files are also uploaded to R2 for sharing.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';
import {uploadFile, type UploadResult} from './cloudStorage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDocumentsDir(): string {
  return RNFS.DocumentDirectoryPath;
}

function timestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

const MIME_MAP: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// ---------------------------------------------------------------------------
// generate_file — MD, TXT, JSON, CSV, HTML (plain text formats)
// ---------------------------------------------------------------------------

export async function executeGenerateFile(
  content: string,
  filename: string,
  format: string,
  apiKey?: string,
): Promise<string> {
  try {
    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fname = `${safeName}_${timestamp()}.${format}`;
    const dir = getDocumentsDir();
    const path = `${dir}/${fname}`;

     await RNFS.writeFile(path, content, 'utf8');

    // Determine if this is an audio file
    const isAudio = format === 'mp3' || format === 'wav' || format === 'm4a' || format === 'ogg';
    const fileTypeLabel = isAudio ? 'audio' : 'file';

    let result = `[${fileTypeLabel}] ${path}`;

    // Upload to R2 for sharing
    if (apiKey) {
      try {
        const upload = await uploadFile(path, apiKey, fname);
        result += `\n\nCloud link: ${upload.url}`;
      } catch {
        // R2 upload failed, local file still available
      }
    }

    return result;
  } catch (e) {
    return `Error generating file: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

// ---------------------------------------------------------------------------
// generate_pdf — HTML → PDF via react-native-html-to-pdf
// ---------------------------------------------------------------------------

export async function executeGeneratePdf(
  html: string,
  filename: string,
  apiKey?: string,
): Promise<string> {
  try {
    const {generatePDF} = require('react-native-html-to-pdf');
    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');

    const options = {
      html,
      fileName: `${safeName}_${timestamp()}`,
      directory: 'Documents',
    };

    const file = await generatePDF(options);

    if (file?.filePath) {
       let result = `[file] ${file.filePath}`;

      if (apiKey) {
        try {
          const upload = await uploadFile(file.filePath, apiKey, `${safeName}_${timestamp()}.pdf`);
          result += `\n\nCloud link: ${upload.url}`;
        } catch {
          // R2 upload failed
        }
      }

      return result;
    }
    return 'Error: PDF generation returned no file path';
  } catch (e) {
    return `Error generating PDF: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

// ---------------------------------------------------------------------------
// generate_docx — JS objects → DOCX via docx npm package
// ---------------------------------------------------------------------------

interface DocxParagraph {
  text: string;
  style?: 'heading1' | 'heading2' | 'heading3' | 'body' | 'bullet';
  bold?: boolean;
  italic?: boolean;
}

interface DocxTable {
  headers: string[];
  rows: string[][];
}

interface DocxSpec {
  title: string;
  paragraphs: DocxParagraph[];
  tables?: DocxTable[];
}

export async function executeGenerateDocx(
  spec: DocxSpec,
  filename: string,
  apiKey?: string,
): Promise<string> {
  try {
    const docx = require('docx');
    const {
      Document,
      Packer,
      Paragraph: DocxParagraphClass,
      TextRun,
      HeadingLevel,
      AlignmentType,
      Table,
      TableRow,
      TableCell,
      WidthType,
      BorderStyle,
      ShadingType,
      convertInchesToTwip,
    } = docx;

    const children: any[] = [];

    // Title
    children.push(
      new DocxParagraphClass({
        text: spec.title,
        heading: HeadingLevel.HEADING_1,
        spacing: {after: convertInchesToTwip(0.3)},
      }),
    );

    // Paragraphs
    for (const p of spec.paragraphs) {
      const headingMap: Record<string, any> = {
        heading1: HeadingLevel.HEADING_1,
        heading2: HeadingLevel.HEADING_2,
        heading3: HeadingLevel.HEADING_3,
      };

      children.push(
        new DocxParagraphClass({
          text: p.text,
          heading: headingMap[p.style] || undefined,
          bullet: p.style === 'bullet' ? {level: 0} : undefined,
          children: [
            new TextRun({
              text: p.text,
              bold: p.bold,
              italics: p.italic,
              size: p.style === 'body' ? 24 : undefined,
            }),
          ],
        }),
      );
    }

    // Tables
    if (spec.tables) {
      for (const t of spec.tables) {
        const headerRow = new TableRow({
          children: t.headers.map(
            h =>
              new TableCell({
                children: [
                  new DocxParagraphClass({
                    children: [new TextRun({text: h, bold: true, size: 22})],
                  }),
                ],
                shading: {type: ShadingType.SOLID, color: 'E5E7EB'},
                width: {size: 100 / t.headers.length, type: WidthType.PERCENTAGE},
              }),
          ),
        });

        const dataRows = t.rows.map(
          row =>
            new TableRow({
              children: row.map(
                cell =>
                  new TableCell({
                    children: [
                      new DocxParagraphClass({
                        children: [new TextRun({text: cell, size: 22})],
                      }),
                    ],
                    width: {size: 100 / t.headers.length, type: WidthType.PERCENTAGE},
                  }),
              ),
            }),
        );

        children.push(
          new Table({
            rows: [headerRow, ...dataRows],
            width: {size: 100, type: WidthType.PERCENTAGE},
          }),
        );
      }
    }

    const doc = new Document({
      sections: [{children}],
    });

    const buffer = await Packer.toBuffer(doc);
    const base64 = buffer.toString('base64');

    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fname = `${safeName}_${timestamp()}.docx`;
    const dir = getDocumentsDir();
    const path = `${dir}/${fname}`;

    await RNFS.writeFile(path, base64, 'base64');

     let result = `[file] ${path}`;

    if (apiKey) {
      try {
        const upload = await uploadFile(path, apiKey, fname);
        result += `\n\nCloud link: ${upload.url}`;
      } catch {
        // R2 upload failed
      }
    }

    return result;
  } catch (e) {
    return `Error generating DOCX: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

// ---------------------------------------------------------------------------
// generate_xlsx — arrays → XLSX via SheetJS
// ---------------------------------------------------------------------------

interface XlsxSheet {
  name: string;
  headers: string[];
  rows: (string | number)[][];
}

export async function executeGenerateXlsx(
  sheets: XlsxSheet[],
  filename: string,
  apiKey?: string,
): Promise<string> {
  try {
    const XLSX = require('xlsx');

    const wb = XLSX.utils.book_new();

    for (const sheet of sheets) {
      const wsData = [sheet.headers, ...sheet.rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Auto-size columns
      const colWidths = sheet.headers.map((h, i) => {
        const maxLen = Math.max(
          h.length,
          ...sheet.rows.map(r => String(r[i] ?? '').length),
        );
        return {wch: Math.min(maxLen + 2, 50)};
      });
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    }

    const xlsxBuffer = XLSX.write(wb, {type: 'base64', bookType: 'xlsx'});

    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fname = `${safeName}_${timestamp()}.xlsx`;
    const dir = getDocumentsDir();
    const path = `${dir}/${fname}`;

    await RNFS.writeFile(path, xlsxBuffer, 'base64');

     let result = `[file] ${path}`;

    if (apiKey) {
      try {
        const upload = await uploadFile(path, apiKey, fname);
        result += `\n\nCloud link: ${upload.url}`;
      } catch {
        // R2 upload failed
      }
    }

    return result;
  } catch (e) {
    return `Error generating XLSX: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

// ---------------------------------------------------------------------------
// generate_presentation — slides → PPTX
// ---------------------------------------------------------------------------

interface Slide {
  title: string;
  content: string;
}

export async function executeGeneratePresentation(
  slides: Slide[],
  filename: string,
  apiKey?: string,
): Promise<string> {
  try {
    const PptxGenJS = require('pptxgenjs');
    const pptx = new PptxGenJS();

    pptx.title = filename;
    pptx.author = 'Sunlight AI';

    for (const slide of slides) {
      const s = pptx.addSlide();
      s.addText(slide.title, {
        x: 0.5,
        y: 0.5,
        w: '90%',
        h: 1.5,
        fontSize: 28,
        bold: true,
        color: '1a1a2e',
      });

      const bullets = slide.content.split('\n').filter(line => line.trim());
      s.addText(
        bullets.map(b => ({text: b.trim(), options: {bullet: true, fontSize: 16, color: '333333'}})),
        {
          x: 0.5,
          y: 2.2,
          w: '90%',
          h: 4.5,
          valign: 'top',
        },
      );
    }

    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fname = `${safeName}_${timestamp()}.pptx`;
    const dir = getDocumentsDir();
    const path = `${dir}/${fname}`;

    const buffer = await pptx.write({outputType: 'nodebuffer'});
    await RNFS.writeFile(path, buffer.toString('base64'), 'base64');

     let result = `[file] ${path}`;

    if (apiKey) {
      try {
        const upload = await uploadFile(path, apiKey, fname);
        result += `\n\nCloud link: ${upload.url}`;
      } catch {
        // R2 upload failed
      }
    }

    return result;
  } catch (e) {
    return `Error generating presentation: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

// ---------------------------------------------------------------------------
// share_file — share any generated file
// ---------------------------------------------------------------------------

export async function executeShareFile(filePath: string): Promise<string> {
  try {
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      return `Error: file not found at ${filePath}`;
    }

    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const mime = MIME_MAP[ext] || 'application/octet-stream';

     await Share.open({
       url: `file://${filePath}`,
       type: mime,
     });

     const isAudio = ['mp3', 'wav', 'm4a', 'ogg', 'aac'].includes(ext);
     const fileTypeLabel = isAudio ? 'audio' : 'file';
     return `[${fileTypeLabel}] ✅ Shared successfully`;
  } catch (e) {
    if (e instanceof Error && e.message.includes('User did not share')) {
      return 'Share cancelled';
    }
    return `Error sharing: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}
