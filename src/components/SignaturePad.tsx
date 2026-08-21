'use client';
import { useRef } from 'react';
import ReactSignatureCanvas from 'react-signature-canvas';

interface Props {
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
}

export default function SignaturePad({ onConfirm, onCancel }: Props) {
  const sigRef = useRef<ReactSignatureCanvas>(null);

  const handleConfirm = () => {
    if (!sigRef.current || sigRef.current.isEmpty()) return;
    onConfirm(sigRef.current.toDataURL('image/png'));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl">
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Draw Your Signature</h2>
        <p className="text-sm text-gray-400 mb-4">Use your mouse or touch to sign below</p>

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
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
            >
              Confirm Signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
