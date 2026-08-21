'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { PlacedSig } from '@/lib/embedSignature';

const PDFViewer = dynamic(() => import('@/components/PDFViewer'), { ssr: false });
const SignaturePad = dynamic(() => import('@/components/SignaturePad'), { ssr: false });

export default function SignPage() {
  const router = useRouter();
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('document.pdf');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [showPad, setShowPad] = useState(false);
  const [isPlacingMode, setIsPlacingMode] = useState(false);
  const [placedSigs, setPlacedSigs] = useState<PlacedSig[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);

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
    setIsPlacingMode(true);
  };

  const handlePlace = useCallback((sig: PlacedSig) => {
    setPlacedSigs(prev => [...prev, sig]);
    setIsPlacingMode(false);
  }, []);

  const handleUpdateSig = useCallback((index: number, x: number, y: number) => {
    setPlacedSigs(prev => prev.map((s, i) => (i === index ? { ...s, x, y } : s)));
  }, []);

  const handleDeleteSig = useCallback((index: number) => {
    setPlacedSigs(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleDownload = async () => {
    if (!pdfBytes || placedSigs.length === 0) return;
    setIsDownloading(true);
    try {
      const { embedSignatures } = await import('@/lib/embedSignature');
      const signed = await embedSignatures(pdfBytes, placedSigs);
      const blob = new Blob([signed.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, '_signed.pdf');
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  };

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
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push('/')}
            className="text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0"
            title="Back to upload"
          >
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
            <span className="font-medium text-gray-900 text-sm truncate">{fileName}</span>
            {placedSigs.length > 0 && (
              <span className="flex-shrink-0 text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                {placedSigs.length} signature{placedSigs.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {isPlacingMode && (
            <span className="text-sm text-indigo-600 font-medium hidden sm:block">
              Click on the document to place your signature
            </span>
          )}

          {isPlacingMode ? (
            <button
              onClick={() => setIsPlacingMode(false)}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => setShowPad(true)}
              className="px-4 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
            >
              + Add Signature
            </button>
          )}

          <button
            onClick={handleDownload}
            disabled={placedSigs.length === 0 || isDownloading}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isDownloading ? 'Processing…' : 'Download Signed PDF'}
          </button>
        </div>
      </header>

      {/* Hint banner when placing */}
      {isPlacingMode && (
        <div className="bg-indigo-600 text-white text-sm text-center py-2 px-4 sm:hidden">
          Click on the document to place your signature
        </div>
      )}

      {/* Document area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <PDFViewer
          pdfBytes={pdfBytes}
          placedSigs={placedSigs}
          isPlacingMode={isPlacingMode}
          signatureDataUrl={signatureDataUrl}
          onPlace={handlePlace}
          onUpdateSig={handleUpdateSig}
          onDeleteSig={handleDeleteSig}
        />
      </main>

      {showPad && (
        <SignaturePad
          onConfirm={handleConfirmSignature}
          onCancel={() => setShowPad(false)}
        />
      )}
    </div>
  );
}
