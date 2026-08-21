'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PlacedSig, TextAnnotation } from '@/lib/embedSignature';

const RENDER_SCALE = 1.5;
const SIG_W = 200;
const SIG_H = 70;
const DEFAULT_FONT_SIZE = 18; // canvas px at RENDER_SCALE

interface PendingText {
  pageIndex: number;
  x: number;
  y: number;
}

interface Props {
  pdfBytes: Uint8Array;
  placedSigs: PlacedSig[];
  textAnnotations: TextAnnotation[];
  isPlacingMode: boolean;
  isTextMode: boolean;
  signatureDataUrl: string | null;
  onPlace: (sig: PlacedSig) => void;
  onUpdateSig: (index: number, x: number, y: number) => void;
  onDeleteSig: (index: number) => void;
  onPlaceText: (ann: TextAnnotation) => void;
  onUpdateText: (index: number, x: number, y: number) => void;
  onDeleteText: (index: number) => void;
}

export default function PDFViewer({
  pdfBytes, placedSigs, textAnnotations,
  isPlacingMode, isTextMode, signatureDataUrl,
  onPlace, onUpdateSig, onDeleteSig,
  onPlaceText, onUpdateText, onDeleteText,
}: Props) {
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [pendingText, setPendingText] = useState<PendingText | null>(null);
  const [inputValue, setInputValue] = useState('');
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (pendingText) inputRef.current?.focus();
  }, [pendingText]);

  const handleClick = (pageIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isPlacingMode && signatureDataUrl) {
      onPlace({ pageIndex, x: x - SIG_W / 2, y: y - SIG_H / 2, width: SIG_W, height: SIG_H, dataUrl: signatureDataUrl, renderScale: RENDER_SCALE });
      return;
    }
    if (isTextMode) {
      setPendingText({ pageIndex, x, y });
      setInputValue('');
    }
  };

  const commitText = () => {
    if (!pendingText || !inputValue.trim()) { setPendingText(null); return; }
    onPlaceText({
      pageIndex: pendingText.pageIndex,
      x: pendingText.x,
      y: pendingText.y,
      text: inputValue.trim(),
      fontSize: DEFAULT_FONT_SIZE,
      renderScale: RENDER_SCALE,
    });
    setPendingText(null);
    setInputValue('');
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

  const isActiveMode = isPlacingMode || isTextMode;

  return (
    <div className="flex flex-col items-center gap-8 pb-12">
      {pages.map((page, i) => {
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const pageSigs = placedSigs.map((s, idx) => ({ ...s, idx })).filter(s => s.pageIndex === i);
        const pageTexts = textAnnotations.map((t, idx) => ({ ...t, idx })).filter(t => t.pageIndex === i);
        const isPending = pendingText?.pageIndex === i;

        return (
          <div key={i} className="flex flex-col items-center">
            <span className="text-xs text-gray-400 mb-2 font-medium tracking-wide uppercase">Page {i + 1}</span>
            <div
              className={`relative shadow-xl rounded-sm bg-white ${isActiveMode ? 'cursor-crosshair ring-2 ring-indigo-400 ring-offset-2' : ''}`}
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

              {pageTexts.map(ann => (
                <DraggableText
                  key={ann.idx}
                  ann={ann}
                  onUpdate={(x, y) => onUpdateText(ann.idx, x, y)}
                  onDelete={() => onDeleteText(ann.idx)}
                />
              ))}

              {isPending && pendingText && (
                <div
                  className="absolute"
                  style={{ left: pendingText.x, top: pendingText.y - DEFAULT_FONT_SIZE }}
                  onClick={e => e.stopPropagation()}
                >
                  <input
                    ref={inputRef}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitText();
                      if (e.key === 'Escape') { setPendingText(null); setInputValue(''); }
                    }}
                    onBlur={commitText}
                    placeholder="Type here…"
                    className="border-b-2 border-indigo-500 bg-transparent outline-none text-gray-900 min-w-[120px] max-w-[300px]"
                    style={{ fontSize: DEFAULT_FONT_SIZE, lineHeight: 1.2 }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DraggableSig({ sig, onUpdate, onDelete }: {
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
      onUpdate(origin.current.sx + me.clientX - origin.current.mx, origin.current.sy + me.clientY - origin.current.my);
    };
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="absolute select-none group" style={{ left: sig.x, top: sig.y, width: sig.width, height: sig.height }} onMouseDown={onMouseDown}>
      <img src={sig.dataUrl} alt="signature" className="w-full h-full object-contain cursor-move" draggable={false} />
      <button
        className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-red-500 text-white rounded-full text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
        onClick={e => { e.stopPropagation(); onDelete(); }}
      >×</button>
    </div>
  );
}

function DraggableText({ ann, onUpdate, onDelete }: {
  ann: TextAnnotation & { idx: number };
  onUpdate: (x: number, y: number) => void;
  onDelete: () => void;
}) {
  const dragging = useRef(false);
  const origin = useRef({ mx: 0, my: 0, sx: 0, sy: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    dragging.current = true;
    origin.current = { mx: e.clientX, my: e.clientY, sx: ann.x, sy: ann.y };
    const onMove = (me: MouseEvent) => {
      if (!dragging.current) return;
      onUpdate(origin.current.sx + me.clientX - origin.current.mx, origin.current.sy + me.clientY - origin.current.my);
    };
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="absolute select-none group cursor-move whitespace-nowrap"
      style={{ left: ann.x, top: ann.y - ann.fontSize, fontSize: ann.fontSize, lineHeight: 1.2, color: '#111' }}
      onMouseDown={onMouseDown}
    >
      {ann.text}
      <button
        className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-red-500 text-white rounded-full text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
        onClick={e => { e.stopPropagation(); onDelete(); }}
      >×</button>
    </div>
  );
}
