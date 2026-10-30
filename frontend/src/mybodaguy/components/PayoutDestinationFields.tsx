/**
 * One "Mobile Money or Bank" destination for real-money payouts (Send → cash out, and Cash out).
 * Everything goes out through Flutterwave, so there is a single field for the number and the app
 * works out the channel: a Ugandan mobile number pays to mobile money (network read from the
 * prefix), anything else is treated as a bank account and asks for the bank and the holder's name.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  detectUgandaMobileNetwork,
  listUgandaBanks,
  looksLikeUgandaMobileNumber,
  type UgandaBank,
} from '../services/icanWalletService';

type Channel = 'mobilemoneyuganda' | 'bank';
type Network = 'MTN' | 'AIRTEL';

export interface PayoutDestinationState {
  account: string;
  setAccount: (v: string) => void;
  /** What the app worked out (or the user forced): mobile money or bank. */
  channel: Channel;
  /** True once the user overrode the automatic choice. */
  overridden: boolean;
  setOverride: (c: Channel | null) => void;
  network: Network;
  setNetwork: (n: Network) => void;
  /** Network read from the number's prefix, or null when unrecognised (the user then picks). */
  detectedNetwork: Network | null;
  bankCode: string;
  setBankCode: (v: string) => void;
  beneficiaryName: string;
  setBeneficiaryName: (v: string) => void;
  /** Complete enough to send. */
  ready: boolean;
  /** Arguments for requestIcanPayout(). */
  payload: {
    channel: Channel;
    phoneNumber?: string;
    network?: Network;
    accountNumber?: string;
    bankCode?: string;
    beneficiaryName?: string;
  };
  /** One line for the confirm screen. */
  summary: string;
}

export function usePayoutDestination(): PayoutDestinationState {
  const [account, setAccountRaw] = useState('');
  const [override, setOverride] = useState<Channel | null>(null);
  const [network, setNetwork] = useState<Network>('MTN');
  const [bankCode, setBankCode] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');

  const setAccount = (v: string) => {
    setAccountRaw(v);
    if (!v.trim()) setOverride(null); // starting over lets the app work out the channel again
  };

  const trimmed = account.trim();
  const auto: Channel = !trimmed || looksLikeUgandaMobileNumber(trimmed) ? 'mobilemoneyuganda' : 'bank';
  const channel = override ?? auto;
  const detectedNetwork = channel === 'mobilemoneyuganda' ? detectUgandaMobileNetwork(trimmed) : null;
  const payoutNetwork = detectedNetwork ?? network;
  const compact = trimmed.replace(/\s+/g, '');

  const ready = channel === 'mobilemoneyuganda'
    ? looksLikeUgandaMobileNumber(trimmed)
    : /^\d{5,20}$/.test(compact) && !!bankCode && beneficiaryName.trim().length >= 2;

  const payload = channel === 'mobilemoneyuganda'
    ? { channel, phoneNumber: compact, network: payoutNetwork }
    : { channel, accountNumber: compact, bankCode, beneficiaryName: beneficiaryName.trim() };

  const summary = channel === 'mobilemoneyuganda'
    ? `${compact} (${payoutNetwork === 'AIRTEL' ? 'Airtel' : 'MTN'} Mobile Money)`
    : `${beneficiaryName.trim()} · ${compact}`;

  return {
    account, setAccount, channel, overridden: override !== null, setOverride, network, setNetwork, detectedNetwork,
    bankCode, setBankCode, beneficiaryName, setBeneficiaryName, ready, payload, summary,
  };
}

interface FieldsProps {
  state: PayoutDestinationState;
  disabled?: boolean;
  /** 'classic' = the wallet page's gold/ink sheet styling; 'plain' = the stand-alone Cash out form. */
  variant: 'classic' | 'plain';
}

export default function PayoutDestinationFields({ state, disabled, variant }: FieldsProps) {
  const classic = variant === 'classic';
  const labelCls = classic ? 'classic-label' : 'block text-sm font-medium text-slate-600 mb-2';
  const inputCls = classic ? 'classic-input' : 'w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-rose-400';
  const tileCls = (active: boolean) => classic
    ? `classic-tile p-2.5 text-center text-sm font-semibold ${active ? 'is-active' : ''}`
    : `py-2 rounded-lg text-sm font-medium border ${active ? 'bg-rose-500 border-rose-500 text-white' : 'bg-white border-slate-200 text-slate-600'}`;
  const hintCls = classic ? 'mt-1.5 text-[11px] leading-snug text-slate-500' : 'mt-1 text-xs text-slate-400';

  const isBank = state.channel === 'bank';

  // The bank list is only fetched once a bank is actually needed.
  const [banks, setBanks] = useState<UgandaBank[]>([]);
  const [banksError, setBanksError] = useState('');
  const [loadingBanks, setLoadingBanks] = useState(false);
  useEffect(() => {
    if (!isBank || banks.length > 0) return;
    let cancelled = false;
    setLoadingBanks(true);
    setBanksError('');
    listUgandaBanks()
      .then((list) => { if (!cancelled) setBanks(list); })
      .catch((e: Error) => { if (!cancelled) setBanksError(e.message); })
      .finally(() => { if (!cancelled) setLoadingBanks(false); });
    return () => { cancelled = true; };
  }, [isBank, banks.length]);

  const heading = useMemo(() => {
    if (!state.account.trim()) return 'Mobile Money number or bank account';
    return isBank ? 'Bank account number' : 'Mobile Money number';
  }, [state.account, isBank]);

  return (
    <>
      <div>
        <label className={labelCls} htmlFor="payout-account">{heading}</label>
        <input
          id="payout-account"
          value={state.account}
          onChange={(e) => state.setAccount(e.target.value)}
          placeholder="0770123456 or your bank account number"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          className={inputCls}
        />
        {state.account.trim() && (
          <p className={hintCls}>
            {isBank ? 'Paying into a bank account.' : (
              state.detectedNetwork
                ? <>Paying to <span className="font-semibold">{state.detectedNetwork === 'AIRTEL' ? 'Airtel' : 'MTN'} Mobile Money</span>.</>
                : 'Paying to Mobile Money.'
            )}{' '}
            <button
              type="button"
              disabled={disabled}
              onClick={() => state.setOverride(isBank ? 'mobilemoneyuganda' : 'bank')}
              className="font-semibold underline"
            >
              {isBank ? 'Use Mobile Money instead' : 'Use a bank account instead'}
            </button>
          </p>
        )}
      </div>

      {!isBank && state.account.trim() && !state.detectedNetwork && looksLikeUgandaMobileNumber(state.account) && (
        <div>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Network">
            {(['MTN', 'AIRTEL'] as const).map((n) => (
              <button key={n} type="button" aria-pressed={state.network === n} onClick={() => state.setNetwork(n)} disabled={disabled} className={tileCls(state.network === n)}>
                {n === 'AIRTEL' ? 'Airtel' : n}
              </button>
            ))}
          </div>
          <p className={hintCls}>Couldn't tell the network from this number — pick which one it's on.</p>
        </div>
      )}

      {isBank && (
        <>
          <div>
            <label className={labelCls} htmlFor="payout-bank">Bank</label>
            <select
              id="payout-bank"
              value={state.bankCode}
              onChange={(e) => state.setBankCode(e.target.value)}
              disabled={disabled || loadingBanks}
              className={inputCls}
            >
              <option value="">{loadingBanks ? 'Loading banks…' : banks.length ? 'Choose your bank' : 'No banks available'}</option>
              {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
            {banksError && <p className="mt-1.5 text-[12px] text-red-600">{banksError}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="payout-holder">Account holder name</label>
            <input
              id="payout-holder"
              value={state.beneficiaryName}
              onChange={(e) => state.setBeneficiaryName(e.target.value)}
              placeholder="Name on the account"
              autoComplete="off"
              disabled={disabled}
              className={inputCls}
            />
          </div>
        </>
      )}
    </>
  );
}
