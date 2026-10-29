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
          <span>Could not check your status: {gateError}</span>
          <button onClick={load} className="font-semibold underline shrink-0">Retry</button>
        </div>
      )}

      {businesses.length === 0 && (
        <>
          <div>
            <p className="classic-eyebrow">Business</p>
            <h3 className="font-classic-display text-xl font-semibold text-slate-800">Manage Your Business</h3>
            <p className="mt-1 text-sm text-slate-500">Register to run your own team at your own rates.</p>
          </div>
          <p className="classic-eyebrow !tracking-[0.14em] text-slate-500">Register · Get approved · Run your team</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['transport_company', 'security_escort'] as BusinessCategory[]).map((cat) => {
              const Icon = cat === 'transport_company' ? Truck : ShieldCheck;
              return (
                <button key={cat} onClick={() => setRegisterCategory(cat)} className="classic-tile flex items-center gap-3.5 p-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28]">
                    <Icon size={22} />
                  </span>
                  <span className="font-classic-display text-base font-semibold text-slate-800">{CATEGORY_LABEL[cat]}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {businesses.length > 0 && !activeBusiness && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="classic-eyebrow">Business</p>
              <h3 className="font-classic-display text-xl font-semibold text-slate-800">Manage Your Business</h3>
            </div>
            <div className="flex flex-wrap gap-x-3 justify-end">
              {(['transport_company', 'security_escort'] as BusinessCategory[])
                .filter((cat) => !businesses.some((b) => b.category_key === cat))
                .map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setRegisterCategory(cat)}
                    className="text-xs font-semibold text-[#8a6a1f] hover:text-[#6b4f12]"
                  >
                    + {CATEGORY_LABEL[cat]}
                  </button>
                ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {businesses.map((b) => {
            const state = stateOf(b);
            const pct = profileCompleteness(b, registrations.get(b.id));
            return (
              <div key={b.id} className="classic-card p-3.5 flex items-center gap-3.5">
                <button onClick={() => handleLogoPick(b.id)} className="relative shrink-0" aria-label="Change logo">
                  {b.avatar_url ? (
                    <img src={b.avatar_url} alt="" className="w-14 h-14 rounded-xl object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-[#fbf3dc] flex items-center justify-center text-[#a17c28]">
                      {b.category_key === 'transport_company' ? <Truck size={22} /> : <ShieldCheck size={22} />}
                    </div>
                  )}
                  <span className="absolute -bottom-1 -right-1 bg-white rounded-full p-1 shadow border border-slate-100">
                    <Camera size={10} className="text-slate-500" />
                  </span>
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-classic-display text-base font-semibold text-slate-800 truncate">{b.business_name}</p>
                  <p className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                    {CATEGORY_LABEL[b.category_key]} {gateSupported && <AccessChip state={state} />}
                  </p>
                  {pct < 100 && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="h-1 flex-1 max-w-[120px] rounded-full bg-slate-100">
                        <div className="h-1 rounded-full bg-[#c4a052]" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-slate-400">Profile {pct}%</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setActiveBusinessId(b.id); setActiveSection(state === 'incomplete' ? 'profile' : 'overview'); }}
                  className="classic-btn classic-btn-primary !w-auto !min-h-[38px] !px-4 !py-1.5 !text-[13px] shrink-0"
                >
                  Manage
                </button>
              </div>
            );
          })}
          </div>
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
                className="text-xs font-semibold text-[#8a6a1f] hover:text-[#6b4f12] flex items-center gap-1"
              >
                Full management <ExternalLink size={12} />
              </a>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => handleLogoPick(activeBusiness.id)} className="relative shrink-0" aria-label="Change logo">
                {activeBusiness.avatar_url ? (
                  <img src={activeBusiness.avatar_url} alt="" className="w-12 h-12 rounded-xl object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-[#fbf3dc] flex items-center justify-center text-[#a17c28]">
                    {activeBusiness.category_key === 'transport_company' ? <Truck size={20} /> : <ShieldCheck size={20} />}
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 bg-white rounded-full p-1 shadow border border-slate-100">
                  <Camera size={10} className="text-slate-500" />
                </span>
              </button>
              <div className="min-w-0">
                <h3 className="font-classic-display text-lg font-semibold leading-tight text-slate-800 break-words">{activeBusiness.business_name}</h3>
                <p className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                  {CATEGORY_LABEL[activeBusiness.category_key]}
                  {gateSupported && <AccessChip state={state} />}
                </p>
              </div>
            </div>

            <BusinessAccessBanner state={state} registration={registration} onOpenRegistration={() => setActiveSection('profile')} />

            <div>
              <div className="flex items-center gap-2 mb-4 overflow-x-auto -mx-1 px-1 pb-1" role="tablist">
                {TABS.map(({ id, label, icon: Icon }) => {
                  const tabLocked = !live && LOCKED_UNTIL_APPROVED.includes(id);
                  return (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={activeSection === id}
                      onClick={() => setActiveSection(id)}
                      className={`classic-chip ${activeSection === id ? 'is-active' : ''}`}
                    >
                      <Icon size={14} /> {label}
                      {tabLocked && <Lock size={11} className="opacity-70" aria-label="Locked until approved" />}
                    </button>
                  );
                })}
              </div>

              {locked && (
                <div className="text-center py-10 px-4">
                  <Lock size={26} className="mx-auto text-[#c4a052] mb-2" />
                  <p className="font-classic-display text-base font-semibold text-slate-700">Unlocks when you are approved</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {state === 'incomplete' ? 'Add your registration details first.'
                      : state === 'pending' ? 'Your registration is under review.'
                        : state === 'suspended' ? 'This business is suspended.'
                          : 'Update your details and resubmit.'}
                  </p>
                  {(state === 'incomplete' || state === 'rejected') && (
                    <button onClick={() => setActiveSection('profile')} className="classic-btn classic-btn-primary !w-auto !min-h-[40px] !px-5 !py-2 !text-sm mt-3">
                      {state === 'rejected' ? 'Update and resubmit' : 'Add details'}
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
              toast.error(`Business created, but details were not saved: ${registrationError}`);
            } else {
              setActiveSection('overview');
              toast.success(
                gateSupported ? 'Submitted for approval' : 'Business registered',
              );
            }
          }}
        />
      )}
    </div>
  );
}
