'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PlacedSig, TextAnnotation } from '@/lib/embedSignature';

const RENDER_SCALE = 1.5;
const SIG_W = 200;
const SIG_H = 70;
const DEFAULT_FONT_SIZE = 18;

interface PendingText { pageIndex: number; x: number; y: number; }

interface Props {
  pdfBytes: Uint8Array;
  placedSigs: PlacedSig[];
  textAnnotations: TextAnnotation[];
  isPlacingMode: boolean;
  isTextMode: boolean;
  isDateMode: boolean;
  isCheckmarkMode: boolean;
  dateText: string;
  signatureDataUrl: string | null;
  zoom: number;
  selectedId: string | null;
  onPlace: (sig: PlacedSig) => void;
  onUpdateSig: (index: number, x: number, y: number) => void;
  onResizeSig: (index: number, width: number, height: number) => void;
  onDeleteSig: (index: number) => void;
  onPlaceText: (ann: TextAnnotation) => void;
  onUpdateText: (index: number, x: number, y: number) => void;
  onResizeText: (index: number, fontSize: number) => void;
  onDeleteText: (index: number) => void;
  onColorChange: (index: number, color: string) => void;
  onSelect: (id: string | null) => void;
  onPagesLoaded: (count: number) => void;
}

export default function PDFViewer({
  pdfBytes, placedSigs, textAnnotations,
  isPlacingMode, isTextMode, isDateMode, isCheckmarkMode, dateText, signatureDataUrl,
  zoom, selectedId,
  onPlace, onUpdateSig, onResizeSig, onDeleteSig,
  onPlaceText, onUpdateText, onResizeText, onDeleteText, onColorChange,
  onSelect, onPagesLoaded,
}: Props) {
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [pendingText, setPendingText] = useState<PendingText | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [containerWidth, setContainerWidth] = useState(9999);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      if (cancelled) return;
      const all: PDFPageProxy[] = [];
      for (let i = 1; i <= pdf.numPages; i++) all.push(await pdf.getPage(i));
      if (!cancelled) { setPages(all); onPagesLoaded(all.length); }
    }
    load();
    return () => { cancelled = true; };
  }, [pdfBytes, onPagesLoaded]);

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

  const handleClick = (pageIndex: number, e: React.MouseEvent<HTMLDivElement>, displayScale: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / displayScale;
    const y = (e.clientY - rect.top) / displayScale;

    if (isPlacingMode && signatureDataUrl) {
      onPlace({ pageIndex, x: x - SIG_W / 2, y: y - SIG_H / 2, width: SIG_W, height: SIG_H, dataUrl: signatureDataUrl, renderScale: RENDER_SCALE });
      return;
    }
    if (isDateMode) { onPlaceText({ pageIndex, x, y, text: dateText, fontSize: DEFAULT_FONT_SIZE, renderScale: RENDER_SCALE }); return; }
    if (isCheckmarkMode) { onPlaceText({ pageIndex, x, y, text: '✓', fontSize: DEFAULT_FONT_SIZE * 2, renderScale: RENDER_SCALE }); return; }
    if (isTextMode) { setPendingText({ pageIndex, x, y }); setInputValue(''); return; }
    onSelect(null);
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

  const isActiveMode = isPlacingMode || isTextMode || isDateMode || isCheckmarkMode;

  return (
    <div ref={wrapperRef} className="flex flex-col items-center gap-8 pb-12 w-full">
      {pages.map((page, i) => {
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const baseScale = Math.min(1, (containerWidth - 2) / viewport.width);
        const displayScale = baseScale * zoom;
        const visualW = Math.round(viewport.width * displayScale);
        const visualH = Math.round(viewport.height * displayScale);

        const pageSigs = placedSigs.map((s, idx) => ({ ...s, idx })).filter(s => s.pageIndex === i);
        const pageTexts = textAnnotations.map((t, idx) => ({ ...t, idx })).filter(t => t.pageIndex === i);
        const isPending = pendingText?.pageIndex === i;
        const annCount = pageSigs.length + pageTexts.length;

        return (
          <div key={i} id={`pdf-page-${i}`} className="flex flex-col items-center w-full">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-400 font-medium tracking-widest uppercase">Page {i + 1}</span>
              {annCount > 0 && (
                <span className="text-[10px] bg-indigo-100 text-indigo-600 font-semibold rounded-full px-1.5 py-0.5">
                  {annCount} annotation{annCount > 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div
              className={`relative shadow-xl rounded-sm bg-white overflow-hidden ${isActiveMode ? 'ring-2 ring-indigo-400 ring-offset-2' : ''}`}
              style={{ width: visualW, height: visualH }}
            >
              <div
                style={{
                  width: viewport.width, height: viewport.height,
                  transform: `scale(${displayScale})`, transformOrigin: 'top left',
                  position: 'absolute', top: 0, left: 0,
                }}
                className={isActiveMode ? 'cursor-crosshair' : ''}
                onClick={e => handleClick(i, e, displayScale)}
              >
                <canvas ref={el => { canvasRefs.current[i] = el; }} className="block" />

                {pageSigs.map(sig => (
                  <DraggableSig
                    key={sig.idx}
                    sig={sig}
                    displayScale={displayScale}
                    isSelected={selectedId === `sig-${sig.idx}`}
                    onSelect={() => onSelect(`sig-${sig.idx}`)}
                    onUpdate={(x, y) => onUpdateSig(sig.idx, x, y)}
                    onResize={(w, h) => onResizeSig(sig.idx, w, h)}
                    onDelete={() => onDeleteSig(sig.idx)}
                  />
                ))}

                {pageTexts.map(ann => (
                  <DraggableText
                    key={ann.idx}
                    ann={ann}
                    displayScale={displayScale}
                    isSelected={selectedId === `text-${ann.idx}`}
                    onSelect={() => onSelect(`text-${ann.idx}`)}
                    onUpdate={(x, y) => onUpdateText(ann.idx, x, y)}
                    onResize={fs => onResizeText(ann.idx, fs)}
                    onDelete={() => onDeleteText(ann.idx)}
                    onColorChange={color => onColorChange(ann.idx, color)}
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
          </div>
        );
      })}
    </div>
  );
}

// ─── Draggable Signature ──────────────────────────────────────────────────────

function DraggableSig({ sig, displayScale, isSelected, onSelect, onUpdate, onResize, onDelete }: {
  sig: PlacedSig & { idx: number };
  displayScale: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onDelete: () => void;
}) {
  const dragging = useRef(false);
  const resizing = useRef(false);
  const origin = useRef({ mx: 0, my: 0, sx: 0, sy: 0 });
  const startSize = useRef({ w: 0, h: 0, aspect: 1 });
  const capturedScale = useRef(1);

  const startDrag = (clientX: number, clientY: number) => {
    dragging.current = true;
    capturedScale.current = displayScale;
    origin.current = { mx: clientX, my: clientY, sx: sig.x, sy: sig.y };
  };

  const onMoveMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    startDrag(e.clientX, e.clientY);
    const onMove = (me: MouseEvent) => {
      if (!dragging.current) return;
      const s = capturedScale.current;
      onUpdate(origin.current.sx + (me.clientX - origin.current.mx) / s, origin.current.sy + (me.clientY - origin.current.my) / s);
    };
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onMoveTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    onSelect();
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
    const onMove = (te: TouchEvent) => {
      if (!dragging.current) return;
      te.preventDefault();
      const t = te.touches[0];
      const s = capturedScale.current;
      onUpdate(origin.current.sx + (t.clientX - origin.current.mx) / s, origin.current.sy + (t.clientY - origin.current.my) / s);
    };
    const onEnd = () => { dragging.current = false; window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd); };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    resizing.current = true;
    capturedScale.current = displayScale;
    startSize.current = { w: sig.width, h: sig.height, aspect: sig.width / sig.height };
    const startX = e.clientX;
    const onMove = (me: MouseEvent) => {
      if (!resizing.current) return;
      const dx = (me.clientX - startX) / capturedScale.current;
      const newW = Math.max(40, startSize.current.w + dx);
      onResize(newW, newW / startSize.current.aspect);
    };
    const onUp = () => { resizing.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const controlsVisible = isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';

  return (
    <div
      className={`absolute select-none group ${isSelected ? 'ring-2 ring-indigo-400 ring-offset-1 rounded-sm' : ''}`}
      style={{ left: sig.x, top: sig.y, width: sig.width, height: sig.height }}
      onMouseDown={onMoveMouseDown}
      onTouchStart={onMoveTouchStart}
    >
      <img src={sig.dataUrl} alt="signature" className="w-full h-full object-contain cursor-move" draggable={false} />

      <button
        className={`absolute -top-2.5 -right-2.5 w-5 h-5 bg-red-500 text-white rounded-full text-[11px] flex items-center justify-center ${controlsVisible} transition-opacity shadow-md z-10`}
        onClick={e => { e.stopPropagation(); onDelete(); }}
      >×</button>

      <div
        className={`absolute bottom-0 right-0 w-4 h-4 bg-indigo-500 rounded-tl-md ${controlsVisible} transition-opacity cursor-se-resize z-10 flex items-center justify-center`}
        onMouseDown={onResizeMouseDown}
        title="Drag to resize"
      >
        <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
          <path d="M8 2L2 8M5 2L2 5M8 5L5 8" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>

      <div className={`absolute -bottom-5 left-0 text-[10px] text-gray-400 ${controlsVisible} transition-opacity whitespace-nowrap pointer-events-none`}>
        {Math.round(sig.width)} × {Math.round(sig.height)} px
      </div>
    </div>
  );
}

// ─── Draggable Text ───────────────────────────────────────────────────────────

function DraggableText({ ann, displayScale, isSelected, onSelect, onUpdate, onResize, onDelete, onColorChange }: {
  ann: TextAnnotation & { idx: number };
  displayScale: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (x: number, y: number) => void;
  onResize: (fontSize: number) => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
}) {
  const dragging = useRef(false);
  const origin = useRef({ mx: 0, my: 0, sx: 0, sy: 0 });
  const capturedScale = useRef(1);

  const startDrag = (clientX: number, clientY: number) => {
    dragging.current = true;
    capturedScale.current = displayScale;
    origin.current = { mx: clientX, my: clientY, sx: ann.x, sy: ann.y };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    startDrag(e.clientX, e.clientY);
    const onMove = (me: MouseEvent) => {
      if (!dragging.current) return;
      const s = capturedScale.current;
      onUpdate(origin.current.sx + (me.clientX - origin.current.mx) / s, origin.current.sy + (me.clientY - origin.current.my) / s);
    };
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    onSelect();
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
    const onMove = (te: TouchEvent) => {
      if (!dragging.current) return;
      te.preventDefault();
      const t = te.touches[0];
      const s = capturedScale.current;
      onUpdate(origin.current.sx + (t.clientX - origin.current.mx) / s, origin.current.sy + (t.clientY - origin.current.my) / s);
    };
    const onEnd = () => { dragging.current = false; window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd); };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  };

  const controlsVisible = isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';

  return (
    <div
      className={`absolute select-none group cursor-move ${isSelected ? 'outline outline-2 outline-indigo-400 outline-offset-2 rounded-sm' : ''}`}
      style={{ left: ann.x, top: ann.y - ann.fontSize, fontSize: ann.fontSize, lineHeight: 1.2, color: ann.color ?? '#111111' }}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
    >
      <span className="whitespace-nowrap">{ann.text}</span>

      <div className={`absolute -top-8 left-0 flex items-center gap-1 ${controlsVisible} transition-opacity`} onClick={e => e.stopPropagation()}>
        {/* Font size controls */}
        <button
          className="w-5 h-5 rounded bg-gray-700 text-white text-[11px] font-bold flex items-center justify-center hover:bg-gray-900 shadow"
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onResize(Math.max(8, ann.fontSize - 2)); }}
        >−</button>
        <span className="text-[10px] font-medium text-white bg-gray-700 rounded px-1.5 py-0.5 leading-none">{ann.fontSize}px</span>
        <button
          className="w-5 h-5 rounded bg-gray-700 text-white text-[11px] font-bold flex items-center justify-center hover:bg-gray-900 shadow"
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onResize(Math.min(120, ann.fontSize + 2)); }}
        >+</button>
        {/* Color picker */}
        <input
          type="color"
          value={ann.color ?? '#111111'}
          onChange={e => onColorChange(e.target.value)}
          className="w-5 h-5 rounded cursor-pointer border border-gray-400 p-0 bg-transparent"
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          title="Text color"
        />
        {/* Delete */}
        <button
          className="w-5 h-5 bg-red-500 text-white rounded text-[11px] flex items-center justify-center hover:bg-red-600 shadow ml-0.5"
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDelete(); }}
        >×</button>
      </div>
    </div>
  );
}
