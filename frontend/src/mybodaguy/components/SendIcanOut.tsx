/**
 * 📤 Send ICAN Out Component - My Boda Guy
 * Sell ICAN and disburse UGX directly to mobile money or a bank account via
 * Flutterwave, instead of an offline cashier payout.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { ICAN_TO_UGX, formatICAN, requestIcanPayout } from '../services/icanWalletService';

interface SendIcanOutProps {
  userId: string;
  balance: number;
  onSuccess?: () => void;
}

export default function SendIcanOut({ userId, balance, onSuccess }: SendIcanOutProps) {
  const [icanAmount, setIcanAmount] = useState('');
  const [channel, setChannel] = useState<'mobilemoneyuganda' | 'bank'>('mobilemoneyuganda');
  const [network, setNetwork] = useState<'MTN' | 'AIRTEL'>('MTN');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [processing, setProcessing] = useState(false);

  const amount = parseFloat(icanAmount) || 0;
  const ugxGross = amount * ICAN_TO_UGX;
  const feePercent = 3; // flat 3% cash-out fee, same as any ICAN sell — applied server-side in sell_ican_coins()
  const ugxNet = ugxGross - Math.round((ugxGross * feePercent) / 100);

  const canSubmit =
    amount > 0 &&
    amount <= balance &&
    (channel === 'mobilemoneyuganda' ? !!phoneNumber : !!accountNumber && !!bankCode && !!beneficiaryName);

  const handleSendOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setProcessing(true);
    try {
      const data = await requestIcanPayout({
        icanAmount: amount,
        channel,
        phoneNumber: channel === 'mobilemoneyuganda' ? phoneNumber : undefined,
        network: channel === 'mobilemoneyuganda' ? network : undefined,
        accountNumber: channel === 'bank' ? accountNumber : undefined,
        bankCode: channel === 'bank' ? bankCode : undefined,
        beneficiaryName: channel === 'bank' ? beneficiaryName : undefined,
      });
      toast.success(`${data.message} You'll receive UGX ${Number(data.ugx_net).toLocaleString()}.`);
      setIcanAmount('');
      if (onSuccess) onSuccess();
    } catch (error: any) {
      toast.error(error.message || 'Payout failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="p-4">
      <form onSubmit={handleSendOut} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">Amount (ICAN)</label>
          <input
            type="number"
            min="0.0001"
            step="0.0001"
            max={balance}
            value={icanAmount}
            onChange={(e) => setIcanAmount(e.target.value)}
            placeholder="0.0000"
            disabled={processing}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-rose-400"
          />
          <p className="text-xs text-slate-400 mt-1">Balance: {formatICAN(balance)} ICAN</p>
        </div>

        <div className="flex gap-2">
          {(['mobilemoneyuganda', 'bank'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              disabled={processing}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                channel === c ? 'bg-rose-500 border-rose-500 text-white' : 'bg-white border-slate-200 text-slate-600'
              }`}
            >
              {c === 'mobilemoneyuganda' ? 'Mobile Money' : 'Bank Account'}
            </button>
          ))}
        </div>

        {channel === 'mobilemoneyuganda' ? (
          <>
            <div className="flex gap-2">
              {(['MTN', 'AIRTEL'] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNetwork(n)}
                  disabled={processing}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                    network === n ? 'bg-rose-500 border-rose-500 text-white' : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-2">Mobile Money Number</label>
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="e.g. 0770123456"
                disabled={processing}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-rose-400"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-2">Bank Code</label>
              <input
                value={bankCode}
                onChange={(e) => setBankCode(e.target.value)}
                disabled={processing}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-rose-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-2">Account Number</label>
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                disabled={processing}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-rose-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-2">Account Holder Name</label>
              <input
                value={beneficiaryName}
                onChange={(e) => setBeneficiaryName(e.target.value)}
                disabled={processing}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-rose-400"
              />
            </div>
          </>
        )}

        {amount > 0 && (
          <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-1">
            <div className="flex justify-between text-slate-500"><span>Gross</span><span>UGX {ugxGross.toLocaleString()}</span></div>
            <div className="flex justify-between text-slate-400"><span>Fee ({feePercent}%)</span><span>-UGX {(ugxGross - ugxNet).toLocaleString()}</span></div>
            <div className="flex justify-between text-slate-800 font-semibold pt-1 border-t border-slate-200"><span>You Receive</span><span>UGX {ugxNet.toLocaleString()}</span></div>
          </div>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-700">Sent via Flutterwave. A 3% cash-out fee applies. If the transfer fails, your ICAN is refunded automatically.</p>
        </div>

        <button
          type="submit"
          disabled={!canSubmit || processing}
          className="w-full py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Sending…
            </span>
          ) : (
            '📤 Send Out via Flutterwave'
          )}
        </button>
      </form>
    </div>
  );
}
