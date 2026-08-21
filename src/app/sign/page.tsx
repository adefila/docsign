'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { PlacedSig, TextAnnotation } from '@/lib/embedSignature';

const PDFViewer = dynamic(() => import('@/components/PDFViewer'), { ssr: false });
const SignaturePad = dynamic(() => import('@/components/SignaturePad'), { ssr: false });

type ActiveMode = 'none' | 'placing-sig' | 'placing-text' | 'placing-date' | 'placing-checkmark';

interface Snapshot { placedSigs: PlacedSig[]; textAnnotations: TextAnnotation[]; }
const MAX_HISTORY = 30;

function todayISO() { return new Date().toISOString().split('T')[0]; }
function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
function storageKey(name: string) { return `docsign_ann_${name}`; }
function saveAnnotations(name: string, sigs: PlacedSig[], texts: TextAnnotation[]) {
  try { localStorage.setItem(storageKey(name), JSON.stringify({ placedSigs: sigs, textAnnotations: texts })); } catch {}
}
function loadAnnotations(name: string): Snapshot | null {
  try { const r = localStorage.getItem(storageKey(name)); return r ? JSON.parse(r) : null; } catch { return null; }
}

export default function SignPage() {
  const router = useRouter();
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('document.pdf');
  const fileNameRef = useRef('document.pdf');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [showPad, setShowPad] = useState(false);
  const [activeMode, setActiveMode] = useState<ActiveMode>('none');
  const [isDownloading, setIsDownloading] = useState(false);

  // Annotation live state
  const [placedSigs, setPlacedSigs] = useState<PlacedSig[]>([]);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);

  // Undo/redo history (discrete actions only)
  const [history, setHistory] = useState<Snapshot[]>([{ placedSigs: [], textAnnotations: [] }]);
  const [histIdx, setHistIdx] = useState(0);
  const histIdxRef = useRef(0);

  // UI state
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [textColor, setTextColor] = useState('#111111');
  const [pageCount, setPageCount] = useState(0);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateValue, setDateValue] = useState(todayISO);
  const datePickerRef = useRef<HTMLDivElement>(null);

  const canUndo = histIdx > 0;
  const canRedo = histIdx < history.length - 1;
  const totalAnnotations = placedSigs.length + textAnnotations.length;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const pushSnapshot = useCallback((sigs: PlacedSig[], texts: TextAnnotation[]) => {
    setPlacedSigs(sigs);
    setTextAnnotations(texts);
    saveAnnotations(fileNameRef.current, sigs, texts);
    setHistory(prev => {
      const cut = prev.slice(0, histIdxRef.current + 1);
      return [...cut, { placedSigs: sigs, textAnnotations: texts }].slice(-MAX_HISTORY);
    });
    setHistIdx(prev => { const n = Math.min(prev + 1, MAX_HISTORY - 1); histIdxRef.current = n; return n; });
  }, []);

  const undo = useCallback(() => {
    if (!canUndo) return;
    const newIdx = histIdx - 1;
    setHistIdx(newIdx); histIdxRef.current = newIdx;
    setHistory(prev => { const s = prev[newIdx]; if (s) { setPlacedSigs(s.placedSigs); setTextAnnotations(s.textAnnotations); } return prev; });
  }, [canUndo, histIdx]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    const newIdx = histIdx + 1;
    setHistIdx(newIdx); histIdxRef.current = newIdx;
    setHistory(prev => { const s = prev[newIdx]; if (s) { setPlacedSigs(s.placedSigs); setTextAnnotations(s.textAnnotations); } return prev; });
  }, [canRedo, histIdx]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.matches('input, textarea, [contenteditable]');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      if (e.key === 'Escape') { setActiveMode('none'); setShowShortcuts(false); setShowClearConfirm(false); setShowDatePicker(false); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput && selectedId) {
        if (selectedId.startsWith('sig-')) handleDeleteSig(parseInt(selectedId.replace('sig-', '')));
        else if (selectedId.startsWith('text-')) handleDeleteText(parseInt(selectedId.replace('text-', '')));
        setSelectedId(null);
      }
      if (!inInput && (e.key === '?' || (e.shiftKey && e.key === '/'))) setShowShortcuts(p => !p);
      if (!inInput && !mod && (e.key === '=' || e.key === '+')) setZoom(z => Math.min(2, Math.round((z + 0.25) * 4) / 4));
      if (!inInput && !mod && e.key === '-') setZoom(z => Math.max(0.5, Math.round((z - 0.25) * 4) / 4));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, selectedId]);

  // Close date picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) setShowDatePicker(false);
    };
    if (showDatePicker) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDatePicker]);

  // Load PDF from sessionStorage
  useEffect(() => {
    const base64 = sessionStorage.getItem('docsign_pdf');
    const name = sessionStorage.getItem('docsign_name');
    if (!base64) { router.push('/'); return; }
    fetch(`data:application/pdf;base64,${base64}`)
      .then(r => r.arrayBuffer())
      .then(buf => setPdfBytes(new Uint8Array(buf)));
    if (name) {
      setFileName(name);
      fileNameRef.current = name;
      const saved = loadAnnotations(name);
      if (saved) {
        setPlacedSigs(saved.placedSigs);
        setTextAnnotations(saved.textAnnotations);
        setHistory([{ placedSigs: [], textAnnotations: [] }, saved]);
        setHistIdx(1); histIdxRef.current = 1;
      }
    }
  }, [router]);

  const handleConfirmSignature = (dataUrl: string) => {
    setSignatureDataUrl(dataUrl);
    setShowPad(false);
    setActiveMode('placing-sig');
  };

  // Discrete actions → push snapshot
  const handlePlace = useCallback((sig: PlacedSig) => {
    pushSnapshot([...placedSigs, sig], textAnnotations);
    setActiveMode('none');
  }, [pushSnapshot, placedSigs, textAnnotations]);

  const handleDeleteSig = useCallback((index: number) => {
    pushSnapshot(placedSigs.filter((_, i) => i !== index), textAnnotations);
  }, [pushSnapshot, placedSigs, textAnnotations]);

  const handlePlaceText = useCallback((ann: TextAnnotation) => {
    pushSnapshot(placedSigs, [...textAnnotations, { ...ann, color: textColor }]);
  }, [pushSnapshot, placedSigs, textAnnotations, textColor]);

  const handleDeleteText = useCallback((index: number) => {
    pushSnapshot(placedSigs, textAnnotations.filter((_, i) => i !== index));
  }, [pushSnapshot, placedSigs, textAnnotations]);

  // Continuous actions → update live state only
  const handleUpdateSig = useCallback((index: number, x: number, y: number) => {
    setPlacedSigs(prev => prev.map((s, i) => i === index ? { ...s, x, y } : s));
  }, []);
  const handleResizeSig = useCallback((index: number, width: number, height: number) => {
    setPlacedSigs(prev => prev.map((s, i) => i === index ? { ...s, width, height } : s));
  }, []);
  const handleUpdateText = useCallback((index: number, x: number, y: number) => {
    setTextAnnotations(prev => prev.map((t, i) => i === index ? { ...t, x, y } : t));
  }, []);
  const handleResizeText = useCallback((index: number, fontSize: number) => {
    setTextAnnotations(prev => prev.map((t, i) => i === index ? { ...t, fontSize } : t));
  }, []);
  const handleColorChange = useCallback((index: number, color: string) => {
    setTextAnnotations(prev => {
      const next = prev.map((t, i) => i === index ? { ...t, color } : t);
      saveAnnotations(fileNameRef.current, placedSigs, next);
      return next;
    });
  }, [placedSigs]);

  const handleClearAll = () => {
    setPlacedSigs([]); setTextAnnotations([]);
    setHistory([{ placedSigs: [], textAnnotations: [] }]);
    setHistIdx(0); histIdxRef.current = 0;
    setSelectedId(null);
    try { localStorage.removeItem(storageKey(fileNameRef.current)); } catch {}
    setShowClearConfirm(false);
    showToast('All annotations cleared');
  };

  const handleDownload = async () => {
    if (totalAnnotations === 0) return;
    setIsDownloading(true);
    try {
      const base64 = sessionStorage.getItem('docsign_pdf');
      if (!base64) throw new Error('PDF data not found — please re-upload the file.');
      const binary = atob(base64);
      const freshBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) freshBytes[i] = binary.charCodeAt(i);
      const { embedAll } = await import('@/lib/embedSignature');
      const signed = await embedAll(freshBytes, placedSigs, textAnnotations);
      const blob = new Blob([signed as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, '_signed.pdf');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('PDF downloaded successfully');
    } catch (err) {
      console.error('Download failed:', err);
      alert('Download failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsDownloading(false);
    }
  };

  const modeHint =
    activeMode === 'placing-sig' ? 'Click on the document to place your signature'
    : activeMode === 'placing-text' ? 'Click on the document to add text'
    : activeMode === 'placing-date' ? 'Click on the document to place the date'
    : activeMode === 'placing-checkmark' ? 'Click on the document to place a checkmark ✓'
    : null;

  if (!pdfBytes) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading document…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-3 sm:px-5 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm gap-2">
        {/* Left: back + filename */}
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="font-medium text-gray-900 text-sm truncate max-w-[100px] sm:max-w-xs">{fileName}</span>
            {totalAnnotations > 0 && (
              <span className="flex-shrink-0 text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{totalAnnotations}</span>
            )}
          </div>
        </div>

        {/* Right: tools */}
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {modeHint && <span className="text-xs text-indigo-600 font-medium hidden lg:block mr-1">{modeHint}</span>}

          {activeMode !== 'none' ? (
            <button onClick={() => setActiveMode('none')} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg">Cancel</button>
          ) : (
            <>
              {/* Clear */}
              {totalAnnotations > 0 && !showClearConfirm && (
                <button onClick={() => setShowClearConfirm(true)} title="Clear all" className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              {showClearConfirm && (
                <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                  <span className="text-xs text-red-600 font-medium">Clear all?</span>
                  <button onClick={handleClearAll} className="text-xs font-semibold text-red-600 hover:text-red-800 px-1">Yes</button>
                  <button onClick={() => setShowClearConfirm(false)} className="text-xs text-gray-500 px-1">No</button>
                </div>
              )}

              {/* Undo / Redo */}
              <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" className="p-2 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-gray-100 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 010 16H3M3 10l5-5M3 10l5 5" /></svg>
              </button>
              <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" className="p-2 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-gray-100 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 000 16h10M21 10l-5-5M21 10l-5 5" /></svg>
              </button>

              {/* Zoom */}
              <div className="hidden sm:flex items-center border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => setZoom(z => Math.max(0.5, Math.round((z - 0.25) * 4) / 4))} className="px-2 py-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 text-sm font-bold">−</button>
                <button onClick={() => setZoom(1)} className="px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 min-w-[44px] text-center border-x border-gray-200" title="Reset zoom">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom(z => Math.min(2, Math.round((z + 0.25) * 4) / 4))} className="px-2 py-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 text-sm font-bold">+</button>
              </div>

              {/* Divider */}
              <div className="w-px h-5 bg-gray-200 hidden sm:block" />

              {/* Text color */}
              <div className="flex items-center gap-1" title="Color for new text/checkmarks">
                <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border border-gray-200 p-0.5" />
              </div>

              {/* Signature */}
              <button onClick={() => setShowPad(true)} title="Add Signature"
                className="flex items-center gap-1.5 px-2.5 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                <span className="hidden sm:inline">Sign</span>
              </button>

              {/* Text */}
              <button onClick={() => setActiveMode('placing-text')} title="Add Text"
                className="flex items-center gap-1.5 px-2.5 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span className="hidden sm:inline">Text</span>
              </button>

              {/* Checkmark */}
              <button onClick={() => setActiveMode('placing-checkmark')} title="Add Checkmark ✓"
                className="flex items-center gap-1.5 px-2.5 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span className="hidden sm:inline">Check</span>
              </button>

              {/* Date */}
              <div className="relative" ref={datePickerRef}>
                <button onClick={() => setShowDatePicker(p => !p)} title="Add Date"
                  className="flex items-center gap-1.5 px-2.5 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="hidden sm:inline">Date</span>
                </button>
                {showDatePicker && (
                  <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-xl p-4 z-50 w-60">
                    <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Select date</p>
                    <input type="date" value={dateValue} onChange={e => setDateValue(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-indigo-300 mb-3" />
                    <p className="text-xs text-gray-400 mb-3">→ <span className="text-gray-700 font-medium">{formatDate(dateValue)}</span></p>
                    <button onClick={() => { setShowDatePicker(false); setActiveMode('placing-date'); }}
                      className="w-full py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                      Place on Document
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Shortcuts */}
          <button onClick={() => setShowShortcuts(p => !p)} title="Keyboard shortcuts (?)"
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors text-xs font-bold hidden sm:flex items-center justify-center w-8 h-8">
            ?
          </button>

          {/* Download */}
          <button onClick={handleDownload} disabled={totalAnnotations === 0 || isDownloading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">{isDownloading ? 'Processing…' : 'Download'}</span>
          </button>
        </div>
      </header>

      {/* Mobile mode hint */}
      {modeHint && (
        <div className="bg-indigo-600 text-white text-sm text-center py-2 px-4 lg:hidden">{modeHint}</div>
      )}

      {/* Main PDF area */}
      <main className="flex-1 overflow-y-auto overflow-x-auto p-4 sm:p-8 pb-20">
        <PDFViewer
          pdfBytes={pdfBytes}
          placedSigs={placedSigs}
          textAnnotations={textAnnotations}
          isPlacingMode={activeMode === 'placing-sig'}
          isTextMode={activeMode === 'placing-text'}
          isDateMode={activeMode === 'placing-date'}
          isCheckmarkMode={activeMode === 'placing-checkmark'}
          dateText={formatDate(dateValue)}
          signatureDataUrl={signatureDataUrl}
          zoom={zoom}
          selectedId={selectedId}
          onPlace={handlePlace}
          onUpdateSig={handleUpdateSig}
          onResizeSig={handleResizeSig}
          onDeleteSig={handleDeleteSig}
          onPlaceText={handlePlaceText}
          onUpdateText={handleUpdateText}
          onResizeText={handleResizeText}
          onDeleteText={handleDeleteText}
          onColorChange={handleColorChange}
          onSelect={setSelectedId}
          onPagesLoaded={setPageCount}
        />
      </main>

      {/* Page navigation bar */}
      {pageCount > 1 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur border-t border-gray-200 flex items-center justify-center gap-1 px-4 py-2">
          <span className="text-xs text-gray-400 mr-2 hidden sm:block">Pages:</span>
          {Array.from({ length: pageCount }, (_, i) => {
            const count = placedSigs.filter(s => s.pageIndex === i).length + textAnnotations.filter(t => t.pageIndex === i).length;
            return (
              <button
                key={i}
                onClick={() => document.getElementById(`pdf-page-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={`relative min-w-[32px] h-8 px-2 rounded-md text-sm font-medium transition-colors ${count > 0 ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {i + 1}
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-indigo-600 text-white text-[9px] rounded-full flex items-center justify-center font-bold">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 animate-fade-in">
          <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          {toast}
        </div>
      )}

      {/* Shortcuts modal */}
      {showShortcuts && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowShortcuts(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Keyboard Shortcuts</h3>
              <button onClick={() => setShowShortcuts(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ['Ctrl+Z', 'Undo'],
                ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
                ['Delete / Backspace', 'Delete selected annotation'],
                ['Escape', 'Cancel current mode'],
                ['+ / =', 'Zoom in'],
                ['−', 'Zoom out'],
                ['?', 'Toggle this panel'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <span className="text-gray-500">{desc}</span>
                  <kbd className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded font-mono flex-shrink-0">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Signature pad */}
      {showPad && (
        <SignaturePad onConfirm={handleConfirmSignature} onCancel={() => setShowPad(false)} />
      )}
    </div>
  );
}
