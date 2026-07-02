import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';

const REFRESH_MS = 60_000;

interface WalletDisplay {
  ican_balance:     number;
  currency_code:    string;
  currency_name:    string;
  country_name:     string;
  price_local:      number;
  price_usd:        number;
  balance_local:    number;
  balance_usd:      number;
  appreciation_pct: number;
  fx_lift:          number;
}

interface Props {
  userId?: string;
  onPress?: () => void;
}

export default function IcaneracoinBadge({ userId: propUserId, onPress }: Props) {
  const [wallet,  setWallet]  = useState<WalletDisplay | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let uid = propUserId;
    if (!uid) {
      const { data: { user } } = await supabase.auth.getUser();
      uid = user?.id;
    }
    if (!uid) { setLoading(false); return; }

    try {
      const { data, error } = await supabase.rpc('ican_get_user_wallet_display', {
        p_user_id: uid,
      });
      if (!error && data?.[0]) {
        setWallet(data[0] as WalletDisplay);
      } else {
        // Fallback: read balance only
        const { data: ua } = await supabase
          .from('user_accounts')
          .select('ican_coin_balance')
          .eq('user_id', uid)
          .single();
        setWallet({ ican_balance: ua?.ican_coin_balance ?? 0 } as WalletDisplay);
      }
    } catch (_) {}
    setLoading(false);
  }, [propUserId]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const balance    = Number(wallet?.ican_balance    ?? 0);
  const priceLocal = Number(wallet?.price_local     ?? 0);
  const balLocal   = Number(wallet?.balance_local   ?? 0);
  const balUsd     = Number(wallet?.balance_usd     ?? 0);
  const currency   = wallet?.currency_code          ?? 'UGX';
  const appPct     = Number(wallet?.appreciation_pct ?? 0);
  const fxLift     = Number(wallet?.fx_lift         ?? 0);
  const hasPrice   = priceLocal > 0;

  const handleClick = () => {
    if (onPress) onPress();
  };

  return (
    <div
      onClick={handleClick}
      style={{
        background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
        borderRadius: 16,
        padding: '16px 20px',
        color: '#fff',
        cursor: onPress ? 'pointer' : 'default',
        minWidth: 220,
        userSelect: 'none',
        transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: '0.68rem', opacity: 0.8, margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            icaneracoin
          </p>
          <p style={{ fontSize: '2rem', fontWeight: 700, margin: '4px 0 0', lineHeight: 1 }}>
            {loading ? '…' : balance.toFixed(4)}
          </p>
          <p style={{ fontSize: '0.68rem', opacity: 0.65, margin: '4px 0 0' }}>ERA</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '1.4rem', opacity: 0.6, fontWeight: 700 }}>ERA</span>
          {!loading && appPct > 0 && (
            <p style={{ fontSize: '0.68rem', color: '#86efac', margin: '4px 0 0', fontWeight: 700 }}>
              +{appPct.toFixed(2)}%
            </p>
          )}
        </div>
      </div>

      {/* Values */}
      {hasPrice && !loading && (
        <div
          style={{
            marginTop: 12, paddingTop: 12,
            borderTop: '1px solid rgba(255,255,255,0.2)',
            display: 'flex', justifyContent: 'space-between',
          }}
        >
          <div>
            <p style={{ fontSize: '0.62rem', opacity: 0.7, margin: 0 }}>Balance ({currency})</p>
            <p style={{ fontSize: '0.9rem', fontWeight: 600, margin: '2px 0 0' }}>
              {balLocal > 0
                ? balLocal.toLocaleString(undefined, { maximumFractionDigits: 0 })
                : '—'}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '0.62rem', opacity: 0.7, margin: 0 }}>Balance (USD)</p>
            <p style={{ fontSize: '0.9rem', fontWeight: 600, margin: '2px 0 0' }}>
              ${balUsd > 0 ? balUsd.toFixed(2) : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Price row */}
      {hasPrice && !loading && (
        <div style={{ marginTop: 8, fontSize: '0.62rem', opacity: 0.7 }}>
          1 icaneracoin = {currency} {priceLocal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          {fxLift > 0 && (
            <span style={{ marginLeft: 6, color: '#86efac' }}>
              (+{fxLift.toFixed(2)} FX shield)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
