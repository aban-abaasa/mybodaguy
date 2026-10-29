import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import type { BusinessCategory } from './BusinessRegistrationModal';
import { ClassicField } from './common/classicForm';

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
    <ClassicField label={label}>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        className="classic-input"
        placeholder={placeholder}
        value={pricing[key] ?? ''}
        onChange={(e) => setPricing((p) => ({ ...p, [key]: e.target.value === '' ? null : Number(e.target.value) }))}
      />
    </ClassicField>
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

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <p className="classic-eyebrow">Pricing</p>
        <p className="mt-1 text-xs text-slate-500">Leave a field blank to use the platform rate.</p>
      </div>

      {!isEscort && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {field('base_fare', 'Base fare', '1000')}
          {field('per_km_rate', 'Per km', '1000')}
          {field('min_fare', 'Minimum fare', '2000')}
        </div>
      )}
      {isEscort && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('escort_flat_fee', 'Flat fee per job', '15000')}
          {field('escort_hourly_rate', 'Fallback fee', '10000')}
        </div>
      )}

      <button onClick={save} disabled={saving} className="classic-btn classic-btn-primary">
        {saving ? 'Saving…' : 'Save pricing'}
      </button>
    </div>
  );
}
