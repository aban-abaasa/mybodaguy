import { useEffect, useState } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import QRCodeImage from 'qrcode';
import { supabase } from '../../services/supabaseClient';
import { getStoreWebsiteUrl } from '../services/storeWebsite';

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
  const [storeWebsiteUrl, setStoreWebsiteUrl] = useState(typeof window !== 'undefined' ? window.location.origin : 'https://bodagoera.icanera.space');
  useEffect(() => {
    let cancelled = false;
    const resolveStoreWebsite = async () => {
      if (!storeName) return;
      try {
        const { data: business } = await supabase.from('business_profiles')
          .select('id, website').ilike('business_name', storeName).limit(1).maybeSingle();
        if (!business?.id) return;
        const businessSite = await getStoreWebsiteUrl({ businessProfileId: business.id });
        const website = businessSite ?? business.website;
        if (website && !cancelled) setStoreWebsiteUrl(/^https?:\/\//i.test(website) ? website : `https://${website}`);
      } catch (error) {
        console.warn('Could not resolve public store website for delivery receipt:', error);
      }
    };
    resolveStoreWebsite();
    return () => { cancelled = true; };
  }, [storeName]);
  const printReceipt = async () => {
    const verifyQr = await QRCodeImage.toDataURL(verifyUrl, { margin: 1, width: 240 });
    const websiteQr = await QRCodeImage.toDataURL(storeWebsiteUrl, { margin: 1, width: 240 });
    const printWindow = window.open('', '_blank', 'width=720,height=800');
    if (!printWindow) return;
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>BodaGoEra delivery receipt</title><style>body{font:16px Georgia,serif;background:#f5f2e9;color:#25253f;padding:32px}.ticket{max-width:560px;margin:auto;background:#fffdf8;border:1px solid #c4a052;border-radius:16px;padding:28px}.head{margin:-28px -28px 22px;padding:22px;background:#312e81;color:#fff;border-bottom:4px solid #c4a052;border-radius:16px 16px 0 0}.codes{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px}.code{text-align:center;padding:14px;border:1px solid #e5d7b0;border-radius:12px;background:#faf8f1}.code img{width:150px;height:150px;background:#fff;padding:5px}.code small{display:block;overflow-wrap:anywhere;color:#526176}@media print{body{padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.ticket{border:0}}</style></head><body><main class="ticket"><header class="head"><h1>Delivery receipt</h1><p>${storeName || 'BodaGoEra store'}</p><strong>Verification code: ${verificationCode}</strong></header><div class="codes"><section class="code"><strong>Verify this delivery</strong><br><img src="${verifyQr}" alt="Delivery verification QR"><small>${verifyUrl}</small></section><section class="code"><strong>Visit BodaGoEra</strong><br><img src="${websiteQr}" alt="BodaGoEra website QR"><small>${storeWebsiteUrl}</small></section></div></main><script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
  };
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
        <div className="flex flex-col items-center rounded-xl border border-amber-200 bg-amber-50 p-4 mb-4">
          <p className="mb-2 text-sm font-semibold text-indigo-900">Visit the BodaGoEra public website</p>
          <QRCode value={storeWebsiteUrl} size={132} level="M" includeMargin />
          <p className="mt-2 break-all text-xs text-slate-600">{storeWebsiteUrl}</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Verification code</span>
            <span className="font-mono font-semibold text-slate-900">{verificationCode}</span>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-4 break-all">{verifyUrl}</p>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={printReceipt} className="py-3 bg-indigo-900 text-white font-semibold rounded-xl hover:bg-indigo-800 transition-all">Print receipt</button>
          <button onClick={onClose} className="py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all">Done</button>
        </div>
      </div>
    </div>
  );
}
