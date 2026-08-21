'use client';
import { useRef, useState } from 'react';
import ReactSignatureCanvas from 'react-signature-canvas';

interface Props {
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
}

type Tab = 'draw' | 'upload';

export default function SignaturePad({ onConfirm, onCancel }: Props) {
  const sigRef = useRef<ReactSignatureCanvas>(null);
  const [tab, setTab] = useState<Tab>('draw');
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setUploadedUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleConfirm = () => {
    if (tab === 'draw') {
      if (!sigRef.current || sigRef.current.isEmpty()) return;
      onConfirm(sigRef.current.toDataURL('image/png'));
    } else {
      if (!uploadedUrl) return;
      onConfirm(uploadedUrl);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Add Signature</h2>

        {/* Tabs */}
        <div className="flex rounded-lg bg-gray-100 p-1 mb-4">
          <button
            onClick={() => setTab('draw')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${
              tab === 'draw' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Draw
          </button>
          <button
            onClick={() => setTab('upload')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${
              tab === 'upload' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload Image
          </button>
        </div>

        {/* Draw panel */}
        {tab === 'draw' && (
          <>
            <p className="text-sm text-gray-400 mb-3">Use your mouse or touch to sign below</p>
            <div className="border-2 border-gray-200 rounded-xl overflow-hidden bg-gray-50 relative">
              <ReactSignatureCanvas
                ref={sigRef}
                penColor="#1e1e1e"
                canvasProps={{ className: 'block w-full', style: { height: 180 } }}
              />
              <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-gray-300 pointer-events-none select-none">
                Sign here
              </span>
            </div>
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => sigRef.current?.clear()}
                className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
              >
                Clear
              </button>
              <div className="flex gap-2">
                <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button onClick={handleConfirm} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors">
                  Confirm
                </button>
              </div>
            </div>
          </>
        )}

        {/* Upload panel */}
        {tab === 'upload' && (
          <>
            <p className="text-sm text-gray-400 mb-3">Upload a PNG, JPG, or SVG of your signature</p>

            {uploadedUrl ? (
              <div className="border-2 border-gray-200 rounded-xl overflow-hidden bg-gray-50 flex items-center justify-center" style={{ height: 180 }}>
                <img
                  src={uploadedUrl}
                  alt="Uploaded signature"
                  className="max-h-full max-w-full object-contain p-4"
                />
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-3 hover:border-indigo-400 hover:bg-indigo-50 transition-colors cursor-pointer"
                style={{ height: 180 }}
              >
                <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="text-sm text-gray-500">Click to browse</span>
                <span className="text-xs text-gray-400">PNG, JPG, SVG · transparent background works best</span>
              </button>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="flex items-center justify-between mt-4">
              {uploadedUrl ? (
                <button
                  onClick={() => { setUploadedUrl(null); if (fileRef.current) fileRef.current.value = ''; }}
                  className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
                >
                  Change image
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!uploadedUrl}
                  className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
