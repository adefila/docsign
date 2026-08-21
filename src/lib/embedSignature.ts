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
    const pdfY = pageHeight - (ann.y / ann.renderScale) - pdfFontSize;

    page.drawText(ann.text, {
      x: pdfX,
      y: pdfY,
      size: pdfFontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  return doc.save();
}
