import { PDFDocument } from 'pdf-lib';

export interface PlacedSig {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  renderScale: number;
}

export async function embedSignatures(pdfBytes: Uint8Array, signatures: PlacedSig[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);

  for (const sig of signatures) {
    const page = doc.getPage(sig.pageIndex);
    const { height: pageHeight } = page.getSize();

    const base64 = sig.dataUrl.split(',')[1];
    const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const pngImage = await doc.embedPng(imgBytes);

    const pdfX = sig.x / sig.renderScale;
    const sigWidthPdf = sig.width / sig.renderScale;
    const sigHeightPdf = sig.height / sig.renderScale;
    const pdfY = pageHeight - (sig.y / sig.renderScale) - sigHeightPdf;

    page.drawImage(pngImage, {
      x: pdfX,
      y: pdfY,
      width: sigWidthPdf,
      height: sigHeightPdf,
    });
  }

  return doc.save();
}
