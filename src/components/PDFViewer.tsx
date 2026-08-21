'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PlacedSig, TextAnnotation } from '@/lib/embedSignature';

const RENDER_SCALE = 1.5;
const SIG_W = 200;
const SIG_H = 70;
const DEFAULT_FONT_SIZE = 18;

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
  onResizeSig: (index: number, width: number, height: number) => void;
  onDeleteSig: (index: number) => void;
  onPlaceText: (ann: TextAnnotation) => void;
  onUpdateText: (index: number, x: number, y: number) => void;
  onResizeText: (index: number, fontSize: number) => void;
  onDeleteText: (index: number) => void;
}

export default function PDFViewer({
  pdfBytes, placedSigs, textAnnotations,
  isPlacingMode, isTextMode, signatureDataUrl,
  onPlace, onUpdateSig, onResizeSig, onDeleteSig,
  onPlaceText, onUpdateText, onResizeText, onDeleteText,
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
    onPlaceText({ pageIndex: pendingText.pageIndex, x: pendingText.x, y: pendingText.y, text: inputValue.trim(), fontSize: DEFAULT_FONT_SIZE, renderScale: RENDER_SCALE });
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
                  onResize={(w, h) => onResizeSig(sig.idx, w, h)}
                  onDelete={() => onDeleteSig(sig.idx)}
                />
              ))}

              {pageTexts.map(ann => (
                <DraggableText
                  key={ann.idx}
                  ann={ann}
                  onUpdate={(x, y) => onUpdateText(ann.idx, x, y)}
                  onResize={fs => onResizeText(ann.idx, fs)}
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

function DraggableSig({ sig, onUpdate, onResize, onDelete }: {
  sig: PlacedSig & { idx: number };
  onUpdate: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDelete: () => void;
}) {
  const dragging = useRef(false);
  const resizing = useRef(false);
  const origin = useRef({ mx: 0, my: 0, sx: 0, sy: 0 });
  const startSize = useRef({ w: 0, h: 0 });
  const aspectRatio = useRef(sig.width / sig.height);

  const onMoveMouseDown = (e: React.MouseEvent) => {
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

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    resizing.current = true;
    startSize.current = { w: sig.width, h: sig.height };
    aspectRatio.current = sig.width / sig.height;
    const startX = e.clientX;
    const onMove = (me: MouseEvent) => {
      if (!resizing.current) return;
      const dx = me.clientX - startX;
      const newW = Math.max(40, startSize.current.w + dx);
      onResize(newW, newW / aspectRatio.current);
    };
    const onUp = () => { resizing.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="absolute select-none group"
      style={{ left: sig.x, top: sig.y, width: sig.width, height: sig.height }}
      onMouseDown={onMoveMouseDown}
    >
      <img src={sig.dataUrl} alt="signature" className="w-full h-full object-contain cursor-move" draggable={false} />

      {/* Delete */}
      <button
        className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-red-500 text-white rounded-full text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10"
        onClick={e => { e.stopPropagation(); onDelete(); }}
      >×</button>

      {/* Resize handle — bottom-right corner */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 bg-indigo-500 rounded-tl-md opacity-0 group-hover:opacity-100 transition-opacity cursor-se-resize z-10 flex items-center justify-center"
        onMouseDown={onResizeMouseDown}
        title="Drag to resize"
      >
        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="currentColor">
          <path d="M8 2L2 8M5 2L2 5M8 5L5 8" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      </div>

      {/* Size badge */}
      <div className="absolute -bottom-5 left-0 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        {Math.round(sig.width)} × {Math.round(sig.height)} px
      </div>
    </div>
  );
}

function DraggableText({ ann, onUpdate, onResize, onDelete }: {
  ann: TextAnnotation & { idx: number };
  onUpdate: (x: number, y: number) => void;
  onResize: (fontSize: number) => void;
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
      className="absolute select-none group cursor-move"
      style={{ left: ann.x, top: ann.y - ann.fontSize, fontSize: ann.fontSize, lineHeight: 1.2, color: '#111' }}
      onMouseDown={onMouseDown}
    >
      <span className="whitespace-nowrap">{ann.text}</span>

      {/* Controls row — appears on hover */}
      <div className="absolute -top-7 left-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        {/* Font size decrease */}
        <button
          className="w-5 h-5 rounded bg-gray-700 text-white text-[11px] font-bold flex items-center justify-center hover:bg-gray-900 shadow"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onResize(Math.max(8, ann.fontSize - 2)); }}
        >−</button>

        {/* Font size display */}
        <span className="text-[10px] font-medium text-white bg-gray-700 rounded px-1.5 py-0.5 leading-none">{ann.fontSize}px</span>

        {/* Font size increase */}
        <button
          className="w-5 h-5 rounded bg-gray-700 text-white text-[11px] font-bold flex items-center justify-center hover:bg-gray-900 shadow"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onResize(Math.min(120, ann.fontSize + 2)); }}
        >+</button>

        {/* Delete */}
        <button
          className="w-5 h-5 bg-red-500 text-white rounded text-[11px] flex items-center justify-center hover:bg-red-600 shadow ml-1"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDelete(); }}
        >×</button>
      </div>
    </div>
  );
}
