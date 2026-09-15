import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import type { BusinessCategory } from './BusinessRegistrationModal';

interface Pricing {
  base_fare: number | null;
  per_km_rate: number | null;
  min_fare: number | null;
  escort_flat_fee: number | null;
  escort_hourly_rate: number | null;
  currency: string;
}

export default function BusinessPricingSettings({ businessProfileId, category }: { businessProfileId: string; category: BusinessCategory }) {
  const [pricing, setPricing] = useState<Pricing>({
    base_fare: null, per_km_rate: null, min_fare: null, escort_flat_fee: null, escort_hourly_rate: null, currency: 'UGX',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isEscort = category === 'security_escort';

  useEffect(() => {
    supabase.rpc('mbg_get_business_pricing', { p_business_profile_id: businessProfileId }).then(({ data }) => {
      if (data) {
        setPricing({
          base_fare: data.base_fare, per_km_rate: data.per_km_rate, min_fare: data.min_fare,
          escort_flat_fee: data.escort_flat_fee, escort_hourly_rate: data.escort_hourly_rate,
          currency: data.currency || 'UGX',
        });
      }
      setLoading(false);
    });
  }, [businessProfileId]);

  const field = (key: keyof Pricing, label: string, placeholder: string) => (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <input
        type="number"
        min={0}
        className="w-full border rounded-lg p-2.5 bg-white text-slate-900 placeholder-slate-400 text-sm"
        placeholder={placeholder}
        value={pricing[key] ?? ''}
        onChange={(e) => setPricing((p) => ({ ...p, [key]: e.target.value === '' ? null : Number(e.target.value) }))}
      />
    </div>
  );

  const save = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('mbg_set_business_pricing', {
        p_business_profile_id: businessProfileId,
        p_base_fare: pricing.base_fare,
        p_per_km_rate: pricing.per_km_rate,
        p_min_fare: pricing.min_fare,
        p_escort_flat_fee: pricing.escort_flat_fee,
        p_escort_hourly_rate: pricing.escort_hourly_rate,
        p_currency: pricing.currency,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not save pricing');
      toast.success('Pricing updated');
    } catch (err: any) {
      toast.error(err.message || 'Could not save pricing');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-slate-800">Pricing</h4>
      <p className="text-xs text-slate-400">
        Leave a field blank to fall back to the platform's default rate. Applies to rides fulfilled by your own {isEscort ? 'escort team' : 'drivers'}.
      </p>

      {!isEscort && (
        <div className="grid grid-cols-3 gap-3">
          {field('base_fare', 'Base fare (UGX)', 'e.g. 1000')}
          {field('per_km_rate', 'Per km (UGX)', 'e.g. 1000')}
          {field('min_fare', 'Minimum fare (UGX)', 'e.g. 2000')}
        </div>
      )}
      {isEscort && (
        <div className="grid grid-cols-2 gap-3">
          {field('escort_flat_fee', 'Flat fee per ride (UGX)', 'e.g. 15000')}
          {field('escort_hourly_rate', 'Fallback fee if no flat fee set (UGX)', 'e.g. 10000')}
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-2.5 text-sm font-semibold"
      >
        {saving ? 'Saving…' : 'Save pricing'}
      </button>
    </div>
  );
}
