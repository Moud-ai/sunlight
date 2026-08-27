/**
 * File generation tools for Sunlight AI.
 *
 * Provides tools to generate files (MD, TXT, JSON, CSV, HTML, PDF, PPTX)
 * and save them to the device's Documents directory.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';

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
};

// ---------------------------------------------------------------------------
// generate_file — MD, TXT, JSON, CSV, HTML
// ---------------------------------------------------------------------------

/**
 * Generate a text-based file and save to Documents directory.
 * Returns the file path.
 */
export async function executeGenerateFile(
  content: string,
  filename: string,
  format: string,
): Promise<string> {
  try {
    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fname = `${safeName}_${timestamp()}.${format}`;
    const dir = getDocumentsDir();
    const path = `${dir}/${fname}`;

    await RNFS.writeFile(path, content, 'utf8');

    return `✅ File saved: ${path}\n\nShare it? Use the share button below.`;
  } catch (e) {
    return `Error generating file: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

// ---------------------------------------------------------------------------
// generate_pdf — HTML → PDF
// ---------------------------------------------------------------------------

/**
 * Generate a PDF from HTML content.
 * Uses react-native-html-to-pdf.
 */
export async function executeGeneratePdf(
  html: string,
  filename: string,
): Promise<string> {
  try {
    const RNHTMLtoPDF = require('react-native-html-to-pdf').default;
    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');

    const options = {
      html,
      fileName: `${safeName}_${timestamp()}`,
      directory: 'Documents',
    };

    const file = await RNHTMLtoPDF.convert(options);

    if (file?.filePath) {
      return `✅ PDF saved: ${file.filePath}\n\nShare it? Use the share button below.`;
    }
    return 'Error: PDF generation returned no file path';
  } catch (e) {
    return `Error generating PDF: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

// ---------------------------------------------------------------------------
// generate_presentation — slides → PPTX
// ---------------------------------------------------------------------------

interface Slide {
  title: string;
  content: string;
}

/**
 * Generate a PPTX presentation from structured slides.
 * Uses pptxgenjs.
 */
export async function executeGeneratePresentation(
  slides: Slide[],
  filename: string,
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

      // Split content by newlines into bullet points
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

    return `✅ Presentation saved: ${path}\n\nShare it? Use the share button below.`;
  } catch (e) {
    return `Error generating presentation: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

// ---------------------------------------------------------------------------
// share_file — share a generated file
// ---------------------------------------------------------------------------

/**
 * Share a file via the system share sheet.
 */
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

    return '✅ Shared successfully';
  } catch (e) {
    // User cancelled share
    if (e instanceof Error && e.message.includes('User did not share')) {
      return 'Share cancelled';
    }
    return `Error sharing: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}
