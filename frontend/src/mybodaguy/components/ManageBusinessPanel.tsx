import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Truck, ShieldCheck, ExternalLink, Users, DollarSign, Camera, Shield, LayoutDashboard, Building2, KeyRound, Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import BusinessRegistrationModal from './BusinessRegistrationModal';
import BusinessDriverRoster from './BusinessDriverRoster';
import BusinessPricingSettings from './BusinessPricingSettings';
import BusinessCover from './cover/BusinessCover';
import BusinessAccessBanner, { AccessChip } from './BusinessAccessBanner';
import BusinessOverviewTab, { type BusinessTab } from './BusinessOverviewTab';
import BusinessProfileEditor from './BusinessProfileEditor';
import BusinessApiAccess from './BusinessApiAccess';
import { businessLogoService } from '../services/businessLogoService';
import {
  accessStateOf,
  businessService,
  isLive,
  profileCompleteness,
  type BusinessCategory,
  type BusinessRegistration,
} from '../services/businessService';

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

/** Sections that run the business for real (people, money, cover) wait for the developer-panel approval. */
const LOCKED_UNTIL_APPROVED: BusinessTab[] = ['roster', 'cover', 'api'];

export default function ManageBusinessPanel() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [registrations, setRegistrations] = useState<Map<string, BusinessRegistration>>(new Map());
  const [gateSupported, setGateSupported] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [registerCategory, setRegisterCategory] = useState<BusinessCategory | null>(null);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<BusinessTab>('overview');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogoFor, setUploadingLogoFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data, error }, regs] = await Promise.all([
      supabase.rpc('mbg_my_businesses'),
      businessService.listRegistrations(),
    ]);
    if (!error) setBusinesses(data || []);
    setRegistrations(regs.byBusiness);
    setGateSupported(regs.supported);
    setGateError(regs.error);
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
  const stateOf = (b: Business) => accessStateOf(gateSupported, registrations.get(b.id));

  const TABS: { id: BusinessTab; label: string; icon: typeof Users }[] = activeBusiness
    ? [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'profile', label: 'Profile', icon: Building2 },
        { id: 'roster', label: activeBusiness.category_key === 'security_escort' ? 'Escort Team' : 'Drivers', icon: Users },
        { id: 'pricing', label: 'Pricing', icon: DollarSign },
        { id: 'cover', label: 'Insurance', icon: Shield },
        { id: 'api', label: 'API', icon: KeyRound },
      ]
    : [];

  return (
    <div className="space-y-5">
      <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />

      {gateError && (
        <div className="flex items-center justify-between gap-3 bg-red-50 text-red-700 text-sm rounded-lg p-3">
          <span>Could not check your registration status: {gateError}</span>
          <button onClick={load} className="font-semibold underline shrink-0">Retry</button>
        </div>
      )}

      {businesses.length === 0 && (
        <>
          <div>
            <h3 className="text-lg font-bold text-slate-800">Manage Your Business</h3>
            <p className="text-sm text-slate-500 mt-1">
              Register a transport company or a security escort service. Each gets its own business profile —
              customize it, add your own drivers or escorts, and set your own pricing.
            </p>
          </div>
          <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            {[
              ['1. Register', 'Give your registration number and licence.'],
              ['2. Get approved', 'The BodaGoEra team reviews your business.'],
              ['3. Run your team', 'Add drivers or escorts, set rates, track earnings.'],
            ].map(([title, text]) => (
              <li key={title} className="bg-slate-50 rounded-xl p-3">
                <p className="font-semibold text-slate-700">{title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{text}</p>
              </li>
            ))}
          </ol>
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
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-slate-800">Manage Your Business</h3>
            <div className="flex flex-wrap gap-x-3 justify-end">
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
          {businesses.map((b) => {
            const state = stateOf(b);
            const pct = profileCompleteness(b, registrations.get(b.id));
            return (
              <div key={b.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center gap-4">
                <button onClick={() => handleLogoPick(b.id)} className="relative shrink-0" aria-label="Change logo">
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
                  <p className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                    {CATEGORY_LABEL[b.category_key]} {gateSupported ? <AccessChip state={state} /> : <span>· {b.status}</span>}
                  </p>
                  {pct < 100 && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="h-1 flex-1 max-w-[120px] rounded-full bg-slate-100">
                        <div className="h-1 rounded-full bg-orange-400" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-slate-400">Profile {pct}%</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setActiveBusinessId(b.id); setActiveSection(state === 'incomplete' ? 'profile' : 'overview'); }}
                  className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-semibold shrink-0"
                >
                  Manage
                </button>
              </div>
            );
          })}
        </div>
      )}

      {activeBusiness && (() => {
        const registration = registrations.get(activeBusiness.id);
        const state = stateOf(activeBusiness);
        const live = isLive(state);
        const locked = !live && LOCKED_UNTIL_APPROVED.includes(activeSection);
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button onClick={() => setActiveBusinessId(null)} className="text-sm text-slate-500 hover:text-slate-700">
                ← All businesses
              </button>
              {/* icanera.space is a single-page app with no per-business route —
                  CMSSModule.jsx reads ?business_profile_id= off the URL on load
                  to auto-select (and auto-provision, via
                  cmms_ensure_pichin_business_access) that exact business's CMMS
                  tenant. Verified against ICAN's own CMSSModule.jsx, not a
                  guess — same Supabase project, so the signed-in session
                  carries over. */}
              <a
                href={`https://icanera.space/?business_profile_id=${activeBusiness.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-violet-600 hover:text-violet-700 flex items-center gap-1"
              >
                Open full management (CMMS) on icanera.space <ExternalLink size={12} />
              </a>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => handleLogoPick(activeBusiness.id)} className="relative shrink-0" aria-label="Change logo">
                {activeBusiness.avatar_url ? (
                  <img src={activeBusiness.avatar_url} alt="" className="w-12 h-12 rounded-xl object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center text-orange-500">
                    {activeBusiness.category_key === 'transport_company' ? <Truck size={20} /> : <ShieldCheck size={20} />}
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 bg-white rounded-full p-1 shadow border border-slate-100">
                  <Camera size={10} className="text-slate-500" />
                </span>
              </button>
              <div className="min-w-0">
                <h3 className="font-bold text-slate-800 truncate">{activeBusiness.business_name}</h3>
                <p className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                  {CATEGORY_LABEL[activeBusiness.category_key]}
                  {gateSupported && <AccessChip state={state} />}
                </p>
              </div>
            </div>

            <BusinessAccessBanner state={state} registration={registration} onOpenRegistration={() => setActiveSection('profile')} />

            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
              <div className="flex items-center gap-2 mb-4 overflow-x-auto -mx-1 px-1 pb-1" role="tablist">
                {TABS.map(({ id, label, icon: Icon }) => {
                  const tabLocked = !live && LOCKED_UNTIL_APPROVED.includes(id);
                  return (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={activeSection === id}
                      onClick={() => setActiveSection(id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium shrink-0 ${
                        activeSection === id ? 'bg-orange-500 text-white' : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <Icon size={14} /> {label}
                      {tabLocked && <Lock size={11} className="opacity-70" aria-label="Locked until approved" />}
                    </button>
                  );
                })}
              </div>

              {locked && (
                <div className="text-center py-10 px-4">
                  <Lock size={28} className="mx-auto text-slate-300 mb-2" />
                  <p className="font-semibold text-slate-700 text-sm">Available once you are approved</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    {state === 'incomplete'
                      ? 'Add your registration details first, then the BodaGoEra team can approve you.'
                      : state === 'pending'
                        ? 'Your registration is with the BodaGoEra team. This unlocks as soon as they approve it.'
                        : state === 'suspended'
                          ? 'This business is suspended. Contact the BodaGoEra team to be reinstated.'
                          : 'Update your registration details and resubmit to get approved.'}
                  </p>
                  {(state === 'incomplete' || state === 'rejected') && (
                    <button onClick={() => setActiveSection('profile')} className="mt-3 px-4 py-2 bg-orange-500 text-white rounded-lg text-xs font-semibold">
                      {state === 'rejected' ? 'Update and resubmit' : 'Add registration details'}
                    </button>
                  )}
                </div>
              )}

              {!locked && activeSection === 'overview' && (
                <BusinessOverviewTab
                  business={activeBusiness}
                  registration={registration}
                  state={state}
                  onGo={setActiveSection}
                  onPickLogo={() => handleLogoPick(activeBusiness.id)}
                />
              )}
              {!locked && activeSection === 'profile' && (
                <BusinessProfileEditor
                  key={`${activeBusiness.id}:${registration?.access_status ?? 'none'}:${registration?.submitted_at ?? ''}`}
                  business={activeBusiness}
                  registration={registration}
                  state={state}
                  onSaved={load}
                />
              )}
              {!locked && activeSection === 'roster' && (
                <BusinessDriverRoster businessProfileId={activeBusiness.id} category={activeBusiness.category_key} />
              )}
              {!locked && activeSection === 'pricing' && (
                <BusinessPricingSettings businessProfileId={activeBusiness.id} category={activeBusiness.category_key} />
              )}
              {!locked && activeSection === 'cover' && (
                <BusinessCover businessProfileId={activeBusiness.id} category={activeBusiness.category_key} />
              )}
              {!locked && activeSection === 'api' && <BusinessApiAccess businessProfileId={activeBusiness.id} />}
            </div>
          </div>
        );
      })()}

      {registerCategory && (
        <BusinessRegistrationModal
          category={registerCategory}
          onClose={() => setRegisterCategory(null)}
          onCreated={async (businessProfileId, registrationError) => {
            setRegisterCategory(null);
            await load();
            setActiveBusinessId(businessProfileId);
            if (registrationError) {
              setActiveSection('profile');
              toast.error(`Business created, but registration details were not filed: ${registrationError}`);
            } else {
              setActiveSection('overview');
              toast.success(
                gateSupported
                  ? 'Registration submitted! The BodaGoEra team will review it. Finish your profile while you wait.'
                  : 'Business registered! Add your logo, roster, and pricing below.',
              );
            }
          }}
        />
      )}
    </div>
  );
}
