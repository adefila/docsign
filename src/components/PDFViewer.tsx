'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PlacedSig } from '@/lib/embedSignature';

const RENDER_SCALE = 1.5;
const SIG_W = 200;
const SIG_H = 70;

interface Props {
  pdfBytes: Uint8Array;
  placedSigs: PlacedSig[];
  isPlacingMode: boolean;
  signatureDataUrl: string | null;
  onPlace: (sig: PlacedSig) => void;
  onUpdateSig: (index: number, x: number, y: number) => void;
  onDeleteSig: (index: number) => void;
}

export default function PDFViewer({
  pdfBytes, placedSigs, isPlacingMode, signatureDataUrl, onPlace, onUpdateSig, onDeleteSig,
}: Props) {
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      if (cancelled) return;
      const all: PDFPageProxy[] = [];
      for (let i = 1; i <= pdf.numPages; i++) all.push(await pdf.getPage(i));
      if (!cancelled) setPages(all);
    }
    load();
    return () => { cancelled = true; };
  }, [pdfBytes]);

  useEffect(() => {
    pages.forEach(async (page, i) => {
      const canvas = canvasRefs.current[i];
      if (!canvas) return;
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx as CanvasRenderingContext2D, canvas, viewport }).promise;
    });
  }, [pages]);

  const handleClick = (pageIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPlacingMode || !signatureDataUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - SIG_W / 2;
    const y = e.clientY - rect.top - SIG_H / 2;
    onPlace({ pageIndex, x, y, width: SIG_W, height: SIG_H, dataUrl: signatureDataUrl, renderScale: RENDER_SCALE });
  };

  if (pages.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Rendering document…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 pb-12">
      {pages.map((page, i) => {
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const pageSigs = placedSigs
          .map((s, idx) => ({ ...s, idx }))
          .filter(s => s.pageIndex === i);

        return (
          <div key={i} className="flex flex-col items-center">
            <span className="text-xs text-gray-400 mb-2 font-medium tracking-wide uppercase">Page {i + 1}</span>
            <div
              className={`relative shadow-xl rounded-sm bg-white ${isPlacingMode ? 'cursor-crosshair ring-2 ring-indigo-400 ring-offset-2' : ''}`}
              style={{ width: viewport.width, height: viewport.height }}
              onClick={e => handleClick(i, e)}
            >
              <canvas ref={el => { canvasRefs.current[i] = el; }} className="block" />
              {pageSigs.map(sig => (
                <DraggableSig
                  key={sig.idx}
                  sig={sig}
                  onUpdate={(x, y) => onUpdateSig(sig.idx, x, y)}
                  onDelete={() => onDeleteSig(sig.idx)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DraggableSig({
  sig,
  onUpdate,
  onDelete,
}: {
  sig: PlacedSig & { idx: number };
  onUpdate: (x: number, y: number) => void;
  onDelete: () => void;
}) {
  const dragging = useRef(false);
  const origin = useRef({ mx: 0, my: 0, sx: 0, sy: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    dragging.current = true;
    origin.current = { mx: e.clientX, my: e.clientY, sx: sig.x, sy: sig.y };

    const onMove = (me: MouseEvent) => {
      if (!dragging.current) return;
      onUpdate(
        origin.current.sx + me.clientX - origin.current.mx,
        origin.current.sy + me.clientY - origin.current.my,
      );
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="absolute select-none group"
      style={{ left: sig.x, top: sig.y, width: sig.width, height: sig.height }}
      onMouseDown={onMouseDown}
    >
      <img
        src={sig.dataUrl}
        alt="signature"
        className="w-full h-full object-contain cursor-move"
        draggable={false}
      />
      <button
        className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-red-500 text-white rounded-full text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
        onClick={e => { e.stopPropagation(); onDelete(); }}
      >
        ×
      </button>
    </div>
  );
}
