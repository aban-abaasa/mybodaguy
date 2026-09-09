import { useEffect, useState, useCallback, useRef } from 'react';
import { Truck, ShieldCheck, ExternalLink, Users, DollarSign, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import BusinessRegistrationModal, { type BusinessCategory } from './BusinessRegistrationModal';
import BusinessDriverRoster from './BusinessDriverRoster';
import BusinessPricingSettings from './BusinessPricingSettings';
import { businessLogoService } from '../services/businessLogoService';

interface Business {
  id: string;
  business_name: string;
  category_key: BusinessCategory;
  description: string | null;
  avatar_url: string | null;
  status: string;
  verification_status: string | null;
  home_city: string | null;
  home_country: string | null;
  created_at: string;
}

const CATEGORY_LABEL: Record<BusinessCategory, string> = {
  transport_company: 'Transport Company',
  security_escort: 'Security Escort Service',
};

export default function ManageBusinessPanel() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [registerCategory, setRegisterCategory] = useState<BusinessCategory | null>(null);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'roster' | 'pricing'>('roster');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogoFor, setUploadingLogoFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('mbg_my_businesses');
    if (!error) setBusinesses(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleLogoPick = (businessId: string) => {
    setUploadingLogoFor(businessId);
    logoInputRef.current?.click();
  };

  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadingLogoFor) return;
    try {
      await businessLogoService.uploadLogo(uploadingLogoFor, file);
      toast.success('Logo updated');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not upload logo');
    } finally {
      setUploadingLogoFor(null);
    }
  };

  if (loading) return <div className="p-6 text-slate-400 text-sm">Loading…</div>;

  const activeBusiness = businesses.find((b) => b.id === activeBusinessId) || null;

  return (
    <div className="space-y-5">
      <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />

      {businesses.length === 0 && (
        <>
          <div>
            <h3 className="text-lg font-bold text-slate-800">Manage Your Business</h3>
            <p className="text-sm text-slate-500 mt-1">
              Register a transport company or a security escort service. Each gets its own business profile —
              customize it, add your own drivers or escorts, and set your own pricing.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(['transport_company', 'security_escort'] as BusinessCategory[]).map((cat) => {
              const Icon = cat === 'transport_company' ? Truck : ShieldCheck;
              return (
                <button
                  key={cat}
                  onClick={() => setRegisterCategory(cat)}
                  className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 text-left hover:shadow-md hover:border-orange-200 transition-all"
                >
                  <Icon className="text-orange-500 mb-3" size={28} />
                  <p className="font-semibold text-slate-800">Register a {CATEGORY_LABEL[cat]}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {cat === 'transport_company'
                      ? 'Run a fleet, take bulk orders, set your own pricing.'
                      : 'Offer escorts customers can add to a ride or delivery.'}
                  </p>
                </button>
              );
            })}
          </div>
        </>
      )}

      {businesses.length > 0 && !activeBusiness && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-800">Manage Your Business</h3>
            <div className="flex gap-2">
              {(['transport_company', 'security_escort'] as BusinessCategory[])
                .filter((cat) => !businesses.some((b) => b.category_key === cat))
                .map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setRegisterCategory(cat)}
                    className="text-xs font-medium text-orange-600 hover:text-orange-700"
                  >
                    + Register {CATEGORY_LABEL[cat]}
                  </button>
                ))}
            </div>
          </div>
          {businesses.map((b) => (
            <div key={b.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center gap-4">
              <button onClick={() => handleLogoPick(b.id)} className="relative shrink-0">
                {b.avatar_url ? (
                  <img src={b.avatar_url} alt="" className="w-14 h-14 rounded-xl object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-orange-100 flex items-center justify-center text-orange-500">
                    {b.category_key === 'transport_company' ? <Truck size={22} /> : <ShieldCheck size={22} />}
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 bg-white rounded-full p-1 shadow border border-slate-100">
                  <Camera size={10} className="text-slate-500" />
                </span>
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate">{b.business_name}</p>
                <p className="text-xs text-slate-500">{CATEGORY_LABEL[b.category_key]} · {b.status}</p>
              </div>
              <button
                onClick={() => { setActiveBusinessId(b.id); setActiveSection('roster'); }}
                className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-semibold shrink-0"
              >
                Manage
              </button>
            </div>
          ))}
        </div>
      )}

      {activeBusiness && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button onClick={() => setActiveBusinessId(null)} className="text-sm text-slate-500 hover:text-slate-700">
              ← All businesses
            </button>
            {/* TODO: confirm this is ICAN's actual business-management route
                before shipping — best guess, not verified against ICAN's
                live router. */}
            <a
              href={`https://icanera.space/business/${activeBusiness.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-violet-600 hover:text-violet-700 flex items-center gap-1"
            >
              Open full business management on icanera.space <ExternalLink size={12} />
            </a>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => setActiveSection('roster')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                  activeSection === 'roster' ? 'bg-orange-500 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Users size={14} /> {activeBusiness.category_key === 'security_escort' ? 'Escort Team' : 'Drivers'}
              </button>
              <button
                onClick={() => setActiveSection('pricing')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                  activeSection === 'pricing' ? 'bg-orange-500 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <DollarSign size={14} /> Pricing
              </button>
            </div>

            {activeSection === 'roster' && (
              <BusinessDriverRoster businessProfileId={activeBusiness.id} category={activeBusiness.category_key} />
            )}
            {activeSection === 'pricing' && (
              <BusinessPricingSettings businessProfileId={activeBusiness.id} category={activeBusiness.category_key} />
            )}
          </div>
        </div>
      )}

      {registerCategory && (
        <BusinessRegistrationModal
          category={registerCategory}
          onClose={() => setRegisterCategory(null)}
          onCreated={async (businessProfileId) => {
            setRegisterCategory(null);
            await load();
            setActiveBusinessId(businessProfileId);
            toast.success('Business registered! Add your logo, roster, and pricing below.');
          }}
        />
      )}
    </div>
  );
}
