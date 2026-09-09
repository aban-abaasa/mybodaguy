import { CheckCircle, X } from 'lucide-react';
import { QRCodeCanvas as QRCode } from 'qrcode.react';

interface DeliveryReceiptCardProps {
  verificationCode: string;
  verifyUrl: string;
  storeName?: string | null;
  onClose: () => void;
}

// Shown to whichever party just triggered a store-delivery wallet charge —
// the rider right after accepting a Bodagoera/Supermarkera delivery, or the
// customer/store after a Dropshipper checkout. All three parties can later
// re-scan the same QR (or open verify_url directly) to prove the receipt is
// real and check whether the order has been picked up from the store yet —
// see icanera_verify_delivery_receipt in
// ICAN/backend/ADD_DELIVERY_RECEIPT_VERIFICATION.sql.
export default function DeliveryReceiptCard({ verificationCode, verifyUrl, storeName, onClose }: DeliveryReceiptCardProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 text-center max-w-sm w-full relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-600"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="text-green-500" size={32} />
        </div>
        <h3 className="text-2xl font-bold text-slate-800 mb-1">Order Paid</h3>
        <p className="text-slate-500 text-sm mb-6">
          {storeName ? `${storeName} — ` : ''}show this QR at pickup so the store can confirm it
        </p>

        <div className="flex justify-center p-4 bg-slate-50 rounded-xl mb-4">
          <QRCode value={verifyUrl} size={200} level="H" includeMargin />
        </div>

        <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Verification code</span>
            <span className="font-mono font-semibold text-slate-900">{verificationCode}</span>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-4 break-all">{verifyUrl}</p>

        <button
          onClick={onClose}
          className="w-full py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all"
        >
          Done
        </button>
      </div>
    </div>
  );
}
