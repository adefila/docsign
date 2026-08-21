'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { PlacedSig, TextAnnotation } from '@/lib/embedSignature';

const PDFViewer = dynamic(() => import('@/components/PDFViewer'), { ssr: false });
const SignaturePad = dynamic(() => import('@/components/SignaturePad'), { ssr: false });

type ActiveMode = 'none' | 'placing-sig' | 'placing-text' | 'placing-date';

interface Snapshot {
  placedSigs: PlacedSig[];
  textAnnotations: TextAnnotation[];
}

const MAX_HISTORY = 30;

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function SignPage() {
  const router = useRouter();
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('document.pdf');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [showPad, setShowPad] = useState(false);
  const [activeMode, setActiveMode] = useState<ActiveMode>('none');
  const [isDownloading, setIsDownloading] = useState(false);

  // Live annotation state — updated freely (drag, resize)
  const [placedSigs, setPlacedSigs] = useState<PlacedSig[]>([]);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);

  // Undo/redo — only discrete actions (place, delete) create snapshots
  const [history, setHistory] = useState<Snapshot[]>([{ placedSigs: [], textAnnotations: [] }]);
  const [histIdx, setHistIdx] = useState(0);
  const histIdxRef = useRef(0); // stable ref for snapshot writes

  const canUndo = histIdx > 0;
  const canRedo = histIdx < history.length - 1;

  // Date picker
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateValue, setDateValue] = useState(todayISO);
  const datePickerRef = useRef<HTMLDivElement>(null);

  const pushSnapshot = useCallback((sigs: PlacedSig[], texts: TextAnnotation[]) => {
    setPlacedSigs(sigs);
    setTextAnnotations(texts);
    setHistory(prev => {
      const cut = prev.slice(0, histIdxRef.current + 1);
      return [...cut, { placedSigs: sigs, textAnnotations: texts }].slice(-MAX_HISTORY);
    });
    setHistIdx(prev => {
      const next = Math.min(prev + 1, MAX_HISTORY - 1);
      histIdxRef.current = next;
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    if (!canUndo) return;
    const newIdx = histIdx - 1;
    setHistIdx(newIdx);
    histIdxRef.current = newIdx;
    setHistory(prev => {
      const snap = prev[newIdx];
      if (snap) {
        setPlacedSigs(snap.placedSigs);
        setTextAnnotations(snap.textAnnotations);
      }
      return prev;
    });
  }, [canUndo, histIdx]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    const newIdx = histIdx + 1;
    setHistIdx(newIdx);
    histIdxRef.current = newIdx;
    setHistory(prev => {
      const snap = prev[newIdx];
      if (snap) {
        setPlacedSigs(snap.placedSigs);
        setTextAnnotations(snap.textAnnotations);
      }
      return prev;
    });
  }, [canRedo, histIdx]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setShowDatePicker(false);
      }
    };
    if (showDatePicker) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDatePicker]);

  useEffect(() => {
    const base64 = sessionStorage.getItem('docsign_pdf');
    const name = sessionStorage.getItem('docsign_name');
    if (!base64) { router.push('/'); return; }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    setPdfBytes(bytes);
    if (name) setFileName(name);
  }, [router]);

  const handleConfirmSignature = (dataUrl: string) => {
    setSignatureDataUrl(dataUrl);
    setShowPad(false);
    setActiveMode('placing-sig');
  };

  // Discrete actions → push snapshot for undo history
  const handlePlace = useCallback((sig: PlacedSig) => {
    pushSnapshot([...placedSigs, sig], textAnnotations);
    setActiveMode('none');
  }, [pushSnapshot, placedSigs, textAnnotations]);

  const handleDeleteSig = useCallback((index: number) => {
    pushSnapshot(placedSigs.filter((_, i) => i !== index), textAnnotations);
  }, [pushSnapshot, placedSigs, textAnnotations]);

  const handlePlaceText = useCallback((ann: TextAnnotation) => {
    pushSnapshot(placedSigs, [...textAnnotations, ann]);
  }, [pushSnapshot, placedSigs, textAnnotations]);

  const handleDeleteText = useCallback((index: number) => {
    pushSnapshot(placedSigs, textAnnotations.filter((_, i) => i !== index));
  }, [pushSnapshot, placedSigs, textAnnotations]);

  // Continuous actions → update live state only (no history entry)
  const handleUpdateSig = useCallback((index: number, x: number, y: number) => {
    setPlacedSigs(prev => prev.map((s, i) => (i === index ? { ...s, x, y } : s)));
  }, []);

  const handleResizeSig = useCallback((index: number, width: number, height: number) => {
    setPlacedSigs(prev => prev.map((s, i) => (i === index ? { ...s, width, height } : s)));
  }, []);

  const handleUpdateText = useCallback((index: number, x: number, y: number) => {
    setTextAnnotations(prev => prev.map((t, i) => (i === index ? { ...t, x, y } : t)));
  }, []);

  const handleResizeText = useCallback((index: number, fontSize: number) => {
    setTextAnnotations(prev => prev.map((t, i) => (i === index ? { ...t, fontSize } : t)));
  }, []);

  const handleDownload = async () => {
    if (!pdfBytes || (placedSigs.length === 0 && textAnnotations.length === 0)) return;
    setIsDownloading(true);
    try {
      const { embedAll } = await import('@/lib/embedSignature');
      const signed = await embedAll(pdfBytes, placedSigs, textAnnotations);
      const blob = new Blob([signed], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, '_signed.pdf');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Download failed:', err);
      alert('Download failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsDownloading(false);
    }
  };

  const totalAnnotations = placedSigs.length + textAnnotations.length;
  const isPlacingMode = activeMode === 'placing-sig';
  const isTextMode = activeMode === 'placing-text';
  const isDateMode = activeMode === 'placing-date';

  const modeHint =
    isPlacingMode ? 'Click on the document to place your signature'
    : isTextMode ? 'Click on the document to add text'
    : isDateMode ? 'Click on the document to place the date'
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
      <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0" title="Back">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="font-medium text-gray-900 text-sm truncate max-w-[120px] sm:max-w-xs">{fileName}</span>
            {totalAnnotations > 0 && (
              <span className="flex-shrink-0 text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{totalAnnotations}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {modeHint && <span className="text-sm text-indigo-600 font-medium hidden md:block">{modeHint}</span>}

          {activeMode !== 'none' ? (
            <button onClick={() => setActiveMode('none')} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg transition-colors">
              Cancel
            </button>
          ) : (
            <>
              {/* Undo / Redo */}
              <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
                className="p-2 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-gray-100">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 010 16H3M3 10l5-5M3 10l5 5" />
                </svg>
              </button>
              <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
                className="p-2 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-gray-100 mr-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 000 16h10M21 10l-5-5M21 10l-5 5" />
                </svg>
              </button>

              {/* Signature */}
              <button onClick={() => setShowPad(true)} title="Add Signature"
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                <span className="hidden sm:inline">Signature</span>
              </button>

              {/* Text */}
              <button onClick={() => setActiveMode('placing-text')} title="Add Text"
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span className="hidden sm:inline">Text</span>
              </button>

              {/* Date */}
              <div className="relative" ref={datePickerRef}>
                <button onClick={() => setShowDatePicker(p => !p)} title="Add Date"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="hidden sm:inline">Date</span>
                </button>

                {showDatePicker && (
                  <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-xl p-4 z-50 w-64">
                    <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Select date</p>
                    <input
                      type="date" value={dateValue} onChange={e => setDateValue(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-indigo-300 mb-3"
                    />
                    <p className="text-xs text-gray-400 mb-3">
                      Will appear as: <span className="text-gray-700 font-medium">{formatDate(dateValue)}</span>
                    </p>
                    <button
                      onClick={() => { setShowDatePicker(false); setActiveMode('placing-date'); }}
                      className="w-full py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      Place on Document
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={totalAnnotations === 0 || isDownloading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">{isDownloading ? 'Processing…' : 'Download'}</span>
          </button>
        </div>
      </header>

      {modeHint && (
        <div className="bg-indigo-600 text-white text-sm text-center py-2 px-4 md:hidden">{modeHint}</div>
      )}

      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <PDFViewer
          pdfBytes={pdfBytes}
          placedSigs={placedSigs}
          textAnnotations={textAnnotations}
          isPlacingMode={isPlacingMode}
          isTextMode={isTextMode}
          isDateMode={isDateMode}
          dateText={formatDate(dateValue)}
          signatureDataUrl={signatureDataUrl}
          onPlace={handlePlace}
          onUpdateSig={handleUpdateSig}
          onResizeSig={handleResizeSig}
          onDeleteSig={handleDeleteSig}
          onPlaceText={handlePlaceText}
          onUpdateText={handleUpdateText}
          onResizeText={handleResizeText}
          onDeleteText={handleDeleteText}
        />
      </main>

      {showPad && (
        <SignaturePad onConfirm={handleConfirmSignature} onCancel={() => setShowPad(false)} />
      )}
    </div>
  );
}
