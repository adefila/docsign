import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface PlacedSig {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  renderScale: number;
}

export interface TextAnnotation {
  pageIndex: number;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  renderScale: number;
  color?: string; // hex e.g. '#111111'
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function embedAll(
  pdfBytes: Uint8Array,
  signatures: PlacedSig[],
  texts: TextAnnotation[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const sig of signatures) {
    const page = doc.getPage(sig.pageIndex);
    const { height: pageHeight } = page.getSize();
    const [mimeHeader, base64] = sig.dataUrl.split(',');
    const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const isJpeg = mimeHeader.includes('jpeg') || mimeHeader.includes('jpg');
    const embeddedImg = isJpeg ? await doc.embedJpg(imgBytes) : await doc.embedPng(imgBytes);
    const pdfX = sig.x / sig.renderScale;
    const sigWidthPdf = sig.width / sig.renderScale;
    const sigHeightPdf = sig.height / sig.renderScale;
    const pdfY = pageHeight - (sig.y / sig.renderScale) - sigHeightPdf;
    page.drawImage(embeddedImg, { x: pdfX, y: pdfY, width: sigWidthPdf, height: sigHeightPdf });
  }

  for (const ann of texts) {
    const page = doc.getPage(ann.pageIndex);
    const { height: pageHeight } = page.getSize();
    const pdfFontSize = ann.fontSize / ann.renderScale;
    const pdfX = ann.x / ann.renderScale;
    const pdfY = pageHeight - (ann.y / ann.renderScale);
    page.drawText(ann.text, {
      x: pdfX,
      y: pdfY,
      size: pdfFontSize,
      font,
      color: ann.color ? hexToRgb(ann.color) : rgb(0, 0, 0),
    });
  }

  return doc.save();
}
