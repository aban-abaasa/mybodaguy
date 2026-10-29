import { useEffect, useState, useCallback, useRef } from 'react';
import { UserPlus, Star, ChevronDown, BadgeCheck, Search, Copy, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import type { BusinessCategory } from '../services/businessService';
import { ClassicField } from './common/classicForm';

interface Driver {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  vehicle_type: string;
  operator_type: string;
  plate_number: string;
  status: string;
  is_available: boolean;
  rating: number | null;
  total_rides: number | null;
  escort_has_own_transport?: boolean | null;
  admin_verified_at?: string | null;
  created_at: string;
}

type RosterFilter = 'all' | 'online' | 'offline';
type Lookup =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'found'; name: string }
  | { state: 'on_team'; name: string }
  | { state: 'missing' }
  | { state: 'unavailable' };

const VEHICLES: { value: string; label: string }[] = [
  { value: 'motorcycle', label: 'Boda' },
  { value: 'bicycle', label: 'Bicycle' },
  { value: 'tuktuk', label: 'Tuk-tuk' },
  { value: 'car', label: 'Car' },
  { value: 'van', label: 'Van' },
  { value: 'truck', label: 'Truck' },
];
const vehicleLabel = (v: string) => VEHICLES.find((x) => x.value === v)?.label ?? v;
const hasRealPlate = (p: string | null | undefined) => !!p && !p.startsWith('PENDING');
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const initials = (name: string) =>
  name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';

export default function BusinessDriverRoster({ businessProfileId, category }: { businessProfileId: string; category: BusinessCategory }) {
  const isEscort = category === 'security_escort';
  const word = isEscort ? 'escort' : 'driver';
  const Word = isEscort ? 'Escort' : 'Driver';

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [email, setEmail] = useState('');
  const [vehicleType, setVehicleType] = useState('motorcycle');
  const [plateNumber, setPlateNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [hasOwnTransport, setHasOwnTransport] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RosterFilter>('all');
  const lookupSeq = useRef(0);

  const needsVehicle = !isEscort || hasOwnTransport;

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('mbg_business_list_drivers', { p_business_profile_id: businessProfileId });
    if (rpcError) setLoadError(rpcError.message);
    else { setDrivers(data || []); setLoadError(null); }
    setLoading(false);
  }, [businessProfileId]);

  useEffect(() => { load(); }, [load]);

  // Check the email while typing so "no account yet" is known before pressing Add.
  useEffect(() => {
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) { setLookup({ state: 'idle' }); return; }
    const seq = ++lookupSeq.current;
    setLookup({ state: 'checking' });
    const timer = setTimeout(async () => {
      const { data, error: rpcError } = await supabase.rpc('mbg_business_lookup_driver', {
        p_business_profile_id: businessProfileId,
        p_email: value,
      });
      if (seq !== lookupSeq.current) return;
      if (rpcError || !data?.success) { setLookup({ state: 'unavailable' }); return; }
      if (!data.found) setLookup({ state: 'missing' });
      else if (data.on_team) setLookup({ state: 'on_team', name: data.display_name });
      else setLookup({ state: 'found', name: data.display_name });
    }, 450);
    return () => clearTimeout(timer);
  }, [email, businessProfileId]);

  const resetForm = () => {
    setEmail(''); setPlateNumber(''); setLicenseNumber(''); setHasOwnTransport(false); setVehicleType('motorcycle');
    setError(null); setLookup({ state: 'idle' });
  };

  const copyInvite = async () => {
    const text = `Join my team on BodaGoEra. Sign up at ${window.location.origin} with ${email.trim()}, then tell me and I will add you.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Share the app link manually.');
    }
  };

  const addDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) { setError('Enter a valid email address'); return; }
    setSubmitting(true);
    try {
      const vehicle = needsVehicle ? vehicleType : 'motorcycle';
      const { data, error: rpcError } = await supabase.rpc('mbg_business_add_driver', {
        p_business_profile_id: businessProfileId,
        p_driver_email: email.trim(),
        p_operator_type: isEscort ? 'escort' : (['van', 'truck'].includes(vehicle) ? 'cargo' : 'passenger'),
        p_vehicle_type: vehicle,
        p_plate_number: needsVehicle ? plateNumber.trim() || null : null,
        p_license_number: licenseNumber.trim() || null,
        p_escort_has_own_transport: isEscort ? hasOwnTransport : false,
      });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error || `Could not add ${word}`);
      toast.success(`${Word} added. Switch them online when they are ready.`);
      setJustAddedId(data.rider_id ?? null);
      setTimeout(() => setJustAddedId(null), 4000);
      resetForm();
      setShowAdd(false);
      await load();
    } catch (err: any) {
      setError(err.message || `Could not add ${word}`);
    } finally {
      setSubmitting(false);
    }
  };

  const run = async (driver: Driver, action: () => PromiseLike<{ error: { message: string } | null; data?: any }>, okMessage?: string) => {
    setBusyId(driver.id);
    const { error: rpcError, data } = await action();
    setBusyId(null);
    if (rpcError) { toast.error(rpcError.message); return false; }
    if (data && data.success === false) { toast.error(data.error || 'Something went wrong'); return false; }
    if (okMessage) toast.success(okMessage);
    await load();
    return true;
  };

  const toggleAvailable = (d: Driver) =>
    run(d, () => supabase.rpc('mbg_business_set_driver_status', { p_rider_id: d.id, p_is_available: !d.is_available }));
  const toggleTransport = (d: Driver) =>
    run(d, () => supabase.rpc('mbg_business_set_escort_transport', { p_rider_id: d.id, p_has_own_transport: !d.escort_has_own_transport }));
  const remove = async (d: Driver) => {
    setBusyId(d.id);
    const { data, error: rpcError } = await supabase.rpc('mbg_business_remove_driver', { p_rider_id: d.id });
    setBusyId(null);
    if (rpcError || !data?.success) { toast.error(rpcError?.message || data?.error || 'Could not remove'); return; }
    toast.success(data.released ? `${d.full_name} left your team and was set offline` : `${d.full_name} removed`);
    setConfirmRemoveId(null);
    setOpenId(null);
    await load();
  };

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const onlineCount = drivers.filter((d) => d.is_available).length;
  const q = query.trim().toLowerCase();
  const visible = drivers.filter((d) => {
    if (filter === 'online' && !d.is_available) return false;
    if (filter === 'offline' && d.is_available) return false;
    if (!q) return true;
    return [d.full_name, d.email, d.plate_number, d.vehicle_type].some((v) => v?.toLowerCase().includes(q));
  });

  const blocked = lookup.state === 'missing' || lookup.state === 'on_team';

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="classic-eyebrow">{isEscort ? 'Escort team' : 'Drivers'}</p>
          <p className="font-classic-display text-lg font-semibold leading-tight text-slate-800">
            {drivers.length === 0 ? `No ${word}s yet` : `${drivers.length} ${word}${drivers.length === 1 ? '' : 's'} · ${onlineCount} online`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className="classic-btn classic-btn-primary !w-auto !min-h-[42px] !px-4 !py-2 !text-sm shrink-0"
        >
          <UserPlus size={16} /> {showAdd ? 'Close' : `Add ${word}`}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addDriver} className="space-y-4 rounded-2xl border border-[#c4a052]/40 bg-[#fffdf8] p-4 dark:bg-slate-800">
          {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          <ClassicField label={`${Word}'s account email`} required>
            <input
              className="classic-input"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoFocus
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </ClassicField>

          {lookup.state !== 'idle' && lookup.state !== 'unavailable' && (
            <div
              aria-live="polite"
              className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                lookup.state === 'found' ? 'bg-emerald-50 text-emerald-800'
                  : lookup.state === 'checking' ? 'bg-slate-50 text-slate-500'
                    : 'bg-amber-50 text-amber-900'
              }`}
            >
              {lookup.state === 'checking' && (<><Loader2 size={14} className="animate-spin" /> Checking…</>)}
              {lookup.state === 'found' && (<><Check size={14} /> {lookup.name} is ready to be added</>)}
              {lookup.state === 'on_team' && <>{lookup.name} is already on your team</>}
              {lookup.state === 'missing' && (
                <>
                  <span>No account with this email yet.</span>
                  <button type="button" onClick={copyInvite} className="ml-auto flex items-center gap-1 font-semibold underline underline-offset-2">
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy invite'}
                  </button>
                </>
              )}
            </div>
          )}

          {isEscort && (
            <button
              type="button"
              role="switch"
              aria-checked={hasOwnTransport}
              onClick={() => setHasOwnTransport((v) => !v)}
              className={`classic-tile flex items-center justify-between gap-3 p-3.5 ${hasOwnTransport ? 'is-active' : ''}`}
            >
              <span>
                <span className="block text-sm font-semibold">Has their own vehicle</span>
                <span className="block text-xs text-slate-500">Can be booked as the whole trip, not only added to another ride.</span>
              </span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${hasOwnTransport ? 'bg-[#c4a052]' : 'bg-slate-300'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${hasOwnTransport ? 'left-[22px]' : 'left-0.5'}`} />
              </span>
            </button>
          )}

          {needsVehicle && (
            <>
              <div>
                <span className="classic-label">Vehicle</span>
                <div className="flex flex-wrap gap-2">
                  {VEHICLES.map((v) => (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => setVehicleType(v.value)}
                      className={`classic-chip ${vehicleType === v.value ? 'is-active' : ''}`}
                      aria-pressed={vehicleType === v.value}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
              <ClassicField label="Plate number">
                <input className="classic-input" autoCapitalize="characters" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} />
              </ClassicField>
            </>
          )}

          <ClassicField label="Licence number">
            <input className="classic-input" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
          </ClassicField>

          <button
            type="submit"
            disabled={submitting || !EMAIL_RE.test(email.trim()) || blocked || lookup.state === 'checking'}
            className="classic-btn classic-btn-primary"
          >
            {submitting ? 'Adding…' : `Add ${word}`}
          </button>
        </form>
      )}

      {loadError && <p className="text-sm text-red-600">Could not load your team: {loadError}</p>}

      {drivers.length > 3 && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="classic-input !min-h-[40px] !pl-9 !text-sm" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex gap-1.5">
            {(['all', 'online', 'offline'] as RosterFilter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`classic-chip capitalize ${filter === f ? 'is-active' : ''}`}>{f}</button>
            ))}
          </div>
        </div>
      )}

      {drivers.length === 0 && !showAdd ? (
        <div className="rounded-2xl border border-dashed border-[#c4a052]/50 py-10 text-center">
          <p className="text-sm text-slate-500">Add your first {word} to start taking jobs.</p>
        </div>
      ) : visible.length === 0 && drivers.length > 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No match.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((d) => {
            const open = openId === d.id;
            const inactive = d.status === 'inactive' || d.status === 'suspended';
            const isEscortRow = d.operator_type === 'escort';
            const ownVehicle = !isEscortRow || !!d.escort_has_own_transport;
            return (
              <li
                key={d.id}
                className={`rounded-2xl border bg-white transition-shadow ${
                  justAddedId === d.id ? 'border-[#c4a052] shadow-[0_0_0_3px_rgba(196,160,82,0.3)]' : 'border-[#c4a052]/30'
                } ${inactive ? 'opacity-70' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => { setOpenId(open ? null : d.id); setConfirmRemoveId(null); }}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 p-3.5 text-left"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 font-classic-display text-sm font-bold text-white">
                    {initials(d.full_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-classic-display text-[15px] font-semibold text-slate-800">{d.full_name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {isEscortRow && !ownVehicle ? 'Escort · on foot' : `${vehicleLabel(d.vehicle_type)}${hasRealPlate(d.plate_number) ? ` · ${d.plate_number}` : ''}`}
                    </span>
                  </span>
                  <span className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${inactive ? 'text-slate-400' : d.is_available ? 'text-emerald-700' : 'text-slate-500'}`}>
                    <span className={`h-2 w-2 rounded-full ${inactive ? 'bg-slate-300' : d.is_available ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    {inactive ? (d.status === 'suspended' ? 'Suspended' : 'Inactive') : d.is_available ? 'Online' : 'Offline'}
                  </span>
                  <ChevronDown size={16} className={`shrink-0 text-[#a17c28] transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                  <div className="space-y-3 border-t border-[#c4a052]/20 px-3.5 pb-3.5 pt-3">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div className="col-span-2 min-w-0"><dt className="classic-label !mb-0">Email</dt><dd className="truncate text-slate-700">{d.email}</dd></div>
                      <div><dt className="classic-label !mb-0">Rides</dt><dd className="text-slate-700">{d.total_rides ?? 0}</dd></div>
                      <div>
                        <dt className="classic-label !mb-0">Rating</dt>
                        <dd className="flex items-center gap-1 text-slate-700">
                          {d.rating ? (<><Star size={12} className="fill-amber-500 text-amber-500" /> {Number(d.rating).toFixed(1)}</>) : '—'}
                        </dd>
                      </div>
                    </dl>
                    {d.admin_verified_at && (
                      <p className="flex items-center gap-1 text-xs font-medium text-emerald-700"><BadgeCheck size={14} /> Verified by BodaGoEra</p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {!inactive && (
                        <button
                          disabled={busyId === d.id}
                          onClick={() => toggleAvailable(d)}
                          className={`classic-btn classic-btn-outline !w-auto !min-h-[38px] !px-3.5 !py-1.5 !text-[13px] ${d.is_available ? '!border-emerald-500 !text-emerald-700' : ''}`}
                        >
                          {d.is_available ? 'Set offline' : 'Set online'}
                        </button>
                      )}
                      {isEscortRow && !inactive && (
                        <button disabled={busyId === d.id} onClick={() => toggleTransport(d)} className="classic-btn classic-btn-outline !w-auto !min-h-[38px] !px-3.5 !py-1.5 !text-[13px]">
                          {d.escort_has_own_transport ? 'Has no vehicle' : 'Has a vehicle'}
                        </button>
                      )}
                      {confirmRemoveId === d.id ? (
                        <span className="flex items-center gap-2">
                          <button disabled={busyId === d.id} onClick={() => remove(d)} className="classic-btn !w-auto !min-h-[38px] !px-3.5 !py-1.5 !text-[13px] bg-red-600 text-white">
                            Yes, remove from team
                          </button>
                          <button onClick={() => setConfirmRemoveId(null)} className="classic-btn-ghost classic-btn">Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmRemoveId(d.id)} className="classic-btn classic-btn-ghost !text-red-600">Remove from team</button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
